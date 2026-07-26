/* ── ROZPISKI ───────────────────────────────────────────────────────────── */

let _settings           = {};
let _currentAssignments = [];
let _planEditMode       = false;
let _blacklist          = {}; // { targetCoord: { offs: Set, nobles: Set } }

async function runPlan() {
    const status = document.getElementById('plan-status');
    setStatus(status, 'Rozpisuję…');
    try {
        const res  = await fetch('/api/plan', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, '✓ Gotowe!', 'ok');
        renderPlan(data);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function renderPlan({ summary, assignments, burst_assignments, fake_assignments }) {
    _currentAssignments = JSON.parse(JSON.stringify(assignments));
    _planEditMode = false;
    hide('btn-save-plan-edits');
    hide('btn-cancel-plan-edits');
    show('btn-edit-plan');

    document.getElementById('plan-summary').innerHTML =
        summaryItem(summary.offs_available,   'Wioski offowe')           +
        summaryItem(summary.offs_total,       'Offy razem')              +
        summaryItem(summary.nobles_available, 'Szlachcice dostępni')     +
        summaryItem(summary.cats_available,   'Katapulty')               +
        summaryItem(summary.offs_assigned,    'Offów przydzielono')      +
        summaryItem(summary.nobles_assigned,  'Szlachciców przydzielono');

    _renderAssignments(assignments, false);
    _renderBurstAssignments(burst_assignments || []);
    _renderFakeAssignments(fake_assignments || []);
    _populateTimingToolbar();

    show('plan-summary-card');
    show('plan-results-card');
    if ((burst_assignments || []).length) show('plan-burst-card'); else hide('plan-burst-card');
    if ((fake_assignments  || []).length) show('plan-fake-card');  else hide('plan-fake-card');
}

function _populateTimingToolbar() {
    _gapMinutesToFields('plan', _settings.off_noble_gap_minutes ?? 1);
    const slots = _settings.arrival_slots || [];
    const btnContainer = document.getElementById('timing-slot-btns');
    btnContainer.innerHTML = slots.map((slot, idx) => {
        const label = slot.label || `Fala ${idx + 1}`;
        const dtStr = slot.datetime ? slot.datetime.slice(11, 16) : '??:??';
        return `<button class="btn slot-apply-btn" data-slot="${idx + 1}" data-dt="${_esc(slot.datetime || '')}">${label}: ${dtStr}</button>`;
    }).join('');
    btnContainer.querySelectorAll('.slot-apply-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const dt = btn.dataset.dt;
            document.querySelectorAll('.asgn-off-dt').forEach(inp => { inp.value = dt.slice(0, 19); });
            _updateNobleChips();
        });
    });
}

function _updateNobleChips() {
    const gapMs = _gapFieldsToMs('plan');
    document.querySelectorAll('.asgn-off-dt').forEach(inp => {
        const chip = inp.closest('.assign-timing').querySelector('.timing-noble-dt');
        if (!chip) return;
        const offVal = inp.value;
        if (!offVal) { chip.textContent = ''; return; }
        if (!gapMs) { chip.textContent = _fmtTimeMs(offVal); return; }
        chip.textContent = _fmtTimeMs(new Date(new Date(offVal).getTime() + gapMs));
    });
}

function _renderAssignments(assignments, editMode) {
    const offSpeed   = parseFloat(_settings.off_speed   || 18);
    const nobleSpeed = parseFloat(_settings.noble_speed || 35);

    document.getElementById('plan-assignments').innerHTML = assignments.map((a, aIdx) => {
        const offArrivalStr   = a.arrival_dt       || _settings.arrival_datetime || '';
        const nobleArrivalStr = a.noble_arrival_dt || offArrivalStr;
        const offBadge   = badgeHtml(`Offy: ${a.offs.length}/${a.offs_needed}`,          a.offs_missing    > 0);
        const nobleBadge = badgeHtml(`Szlachcice: ${a.nobles.length}/${a.nobles_needed}`, a.nobles_missing > 0);
        const offMissing   = a.offs_missing   > 0 ? `<span class="missing">(brakuje ${a.offs_missing})</span>`   : '';
        const nobleMissing = a.nobles_missing > 0 ? `<span class="missing">(brakuje ${a.nobles_missing})</span>` : '';

        const makeTag = (d, fallbackSpeed, cls, key, idx, arrStr) => {
            const speed     = d.speed != null ? d.speed : fallbackSpeed;
            const travelMin = d.dist != null ? (d.dist * speed) : null;
            const sendStr   = (travelMin != null && arrStr) ? ` → ${calcSendStr(arrStr, travelMin)}` : '';
            const distStr   = d.dist != null ? ` <small class="dist-tag">${d.dist} pol, ${fmtMinutes(travelMin)}${sendStr}</small>` : '';
            const isNight   = d.is_night || (travelMin != null && arrStr && _isSendNight(arrStr, travelMin));
            const nightMark = isNight ? ' <span class="night-mark" title="Nocna wysyłka!">🌙</span>' : '';
            const playerName = _playerByCoord[d.coord] || '';
            const playerSpan = playerName ? `<span class="tag-player">${playerName}</span> ` : '';
            const removeBtn = editMode
                ? `<button class="remove-coord" data-aidx="${aIdx}" data-key="${key}" data-cidx="${idx}" title="Usuń">✕</button>`
                : '';
            const reloadBtn = `<button class="reload-coord" data-aidx="${aIdx}" data-key="${key}" data-cidx="${idx}" data-coord="${d.coord}" data-target="${a.target}" title="Zamień na następną najlepszą wioskę">↻</button>`;
            return `<span class="coord-tag ${cls}${isNight ? ' night-send' : ''}">${removeBtn}${reloadBtn}${playerSpan}${d.coord}${distStr}${nightMark}</span>`;
        };

        const offTags   = (a.offs_detail   || a.offs.map(c   => ({coord: c, dist: null}))).map((d, i) => makeTag(d, offSpeed,   '',          'offs',   i, offArrivalStr)).join('');
        const nobleTags = (a.nobles_detail || a.nobles.map(c => ({coord: c, dist: null}))).map((d, i) => makeTag(d, nobleSpeed, 'noble-tag', 'nobles', i, nobleArrivalStr)).join('');

        const addOffInput   = editMode ? `<div class="add-coord-row"><input class="add-coord-input" placeholder="x|y" data-aidx="${aIdx}" data-key="offs"><button class="btn btn-sm add-coord-btn" data-aidx="${aIdx}" data-key="offs">+ Dodaj off</button></div>` : '';
        const addNobleInput = editMode ? `<div class="add-coord-row"><input class="add-coord-input" placeholder="x|y" data-aidx="${aIdx}" data-key="nobles"><button class="btn btn-sm add-coord-btn" data-aidx="${aIdx}" data-key="nobles">+ Dodaj szlachcica</button></div>` : '';

        const offDtVal   = offArrivalStr   ? offArrivalStr.slice(0,19)   : '';
        const nobleGapMs = Math.round((_settings.off_noble_gap_minutes ?? 1) * 60000);
        const nobleDtDisplay = (offDtVal && nobleGapMs > 0)
            ? _fmtTimeMs(new Date(new Date(offDtVal).getTime() + nobleGapMs))
            : (offDtVal ? _fmtTimeMs(offDtVal) : '');
        const gapLabel = `<span class="timing-noble-chip">⚔ szlachcice ${_fmtGap(nobleGapMs)} <span class="timing-noble-dt">${nobleDtDisplay}</span></span>`;

        return `
        <div class="assign-block">
            <div class="assign-header">
                <span class="assign-target">🎯 ${a.target}</span>
                ${offBadge} ${nobleBadge}
            </div>
            <div class="assign-body">
                <div class="assign-group">
                    <label>Offowe wioski ${offMissing}</label>
                    <div class="coord-list">${offTags || '<span class="missing">brak</span>'}</div>
                    ${addOffInput}
                </div>
                <div class="assign-group">
                    <label>Szlachcice ${nobleMissing}</label>
                    <div class="coord-list">${nobleTags || '<span class="missing">brak</span>'}</div>
                    ${addNobleInput}
                </div>
            </div>
            <div class="assign-timing">
                <span class="timing-label-sm">Wejście OFF:</span>
                <input type="datetime-local" class="asgn-off-dt" step="1" data-aidx="${aIdx}" value="${_esc(offDtVal)}">
                ${gapLabel}
            </div>
        </div>`;
    }).join('');

    if (editMode) {
        document.querySelectorAll('.remove-coord').forEach(btn => {
            btn.addEventListener('click', () => {
                const aIdx = parseInt(btn.dataset.aidx);
                const key  = btn.dataset.key;
                const cIdx = parseInt(btn.dataset.cidx);
                const a    = _currentAssignments[aIdx];
                a[key].splice(cIdx, 1);
                if (a[key + '_detail']) a[key + '_detail'].splice(cIdx, 1);
                a[key + '_missing'] = Math.max(0, a[key + '_needed'] - a[key].length);
                _renderAssignments(_currentAssignments, true);
            });
        });
        document.querySelectorAll('.reload-coord').forEach(btn => {
            btn.addEventListener('click', () =>
                reloadCoord(parseInt(btn.dataset.aidx), btn.dataset.key, btn.dataset.coord, btn.dataset.target)
            );
        });
        document.querySelectorAll('.add-coord-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const aIdx  = parseInt(btn.dataset.aidx);
                const key   = btn.dataset.key;
                const input = document.querySelector(`.add-coord-input[data-aidx="${aIdx}"][data-key="${key}"]`);
                const coord = input.value.trim();
                if (!coord || !coord.includes('|')) return;
                const a = _currentAssignments[aIdx];
                a[key].push(coord);
                if (!a[key + '_detail']) a[key + '_detail'] = [];
                a[key + '_detail'].push({ coord, dist: null });
                a[key + '_missing'] = Math.max(0, a[key + '_needed'] - a[key].length);
                input.value = '';
                _renderAssignments(_currentAssignments, true);
            });
        });
    }
}

function _renderBurstAssignments(burstAssignments) {
    const el = document.getElementById('plan-burst-assignments');
    if (!el) return;
    if (!burstAssignments.length) { el.innerHTML = ''; return; }
    const arrivalStr = _settings.arrival_datetime || '';
    const CAT_SPEED  = 30;
    el.innerHTML = burstAssignments.map(a => {
        const badge = badgeHtml(`Katapulty: ${a.catapults.length}/${a.attacks}`, a.catapults_missing > 0);
        const tags  = (a.catapults_detail || a.catapults.map(c => ({coord: c, dist: null}))).map(d => {
            const travelMin = d.dist != null ? d.dist * CAT_SPEED : null;
            const sendStr   = (travelMin != null && arrivalStr) ? ` → ${calcSendStr(arrivalStr, travelMin)}` : '';
            const distStr   = d.dist != null ? ` <small class="dist-tag">${d.dist} pol${sendStr}</small>` : '';
            const player    = _playerByCoord[d.coord] || '';
            return `<span class="coord-tag">${player ? `<span class="tag-player">${player}</span> ` : ''}${d.coord}${distStr}</span>`;
        }).join('');
        const building = a.building ? ` <span class="dim">→ ${a.building}</span>` : '';
        return `<div class="assign-block">
            <div class="assign-header"><span class="assign-target">💥 ${a.target}${building}</span>${badge}</div>
            <div class="assign-body"><div class="assign-group">
                <label>Katapulty</label>
                <div class="coord-list">${tags || '<span class="missing">brak</span>'}</div>
            </div></div>
        </div>`;
    }).join('');
}

function _renderFakeAssignments(fakeAssignments) {
    const el = document.getElementById('plan-fake-assignments');
    if (!el) return;
    if (!fakeAssignments.length) { el.innerHTML = ''; return; }
    const offSpeed   = parseFloat(_settings.off_speed   || 18);
    const nobleSpeed = parseFloat(_settings.noble_speed || 35);
    const arrivalStr = _settings.arrival_datetime || '';
    el.innerHTML = fakeAssignments.map(a => {
        const badgeFo = badgeHtml(`Fejki: ${a.fake_offs.length}/${a.fakes}`, a.fake_offs_missing > 0);
        const badgeFn = badgeHtml(`Fejki szl.: ${a.fake_nobles_list.length}/${a.fake_nobles}`, a.fake_nobles_missing > 0);
        const makeTag = (d, speed) => {
            const travelMin = d.dist != null ? d.dist * speed : null;
            const sendStr   = (travelMin != null && arrivalStr) ? ` → ${calcSendStr(arrivalStr, travelMin)}` : '';
            const distStr   = d.dist != null ? ` <small class="dist-tag">${d.dist} pol${sendStr}</small>` : '';
            const player    = _playerByCoord[d.coord] || '';
            return `<span class="coord-tag">${player ? `<span class="tag-player">${player}</span> ` : ''}${d.coord}${distStr}</span>`;
        };
        const foTags = (a.fake_offs_detail   || a.fake_offs.map(c        => ({coord:c,dist:null}))).map(d => makeTag(d, offSpeed)).join('');
        const fnTags = (a.fake_nobles_detail || a.fake_nobles_list.map(c => ({coord:c,dist:null}))).map(d => makeTag(d, nobleSpeed)).join('');
        return `<div class="assign-block">
            <div class="assign-header"><span class="assign-target">🎭 ${a.target}</span>${badgeFo} ${badgeFn}</div>
            <div class="assign-body">
                <div class="assign-group"><label>Fejki offowe</label><div class="coord-list">${foTags || '<span class="missing">brak</span>'}</div></div>
                <div class="assign-group"><label>Fejki szlachcicowe</label><div class="coord-list">${fnTags || '<span class="missing">brak</span>'}</div></div>
            </div>
        </div>`;
    }).join('');
}

function calcSendStr(arrivalIso, travelMinutes) {
    const d  = new Date(new Date(arrivalIso).getTime() - travelMinutes * 60000);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function _isSendNight(arrivalIso, travelMinutes) {
    const sd = new Date(new Date(arrivalIso).getTime() - travelMinutes * 60000);
    const t  = sd.getHours() * 60 + sd.getMinutes();
    return t >= 23 * 60 + 30 || t <= 7 * 60 + 30;
}

async function reloadCoord(aIdx, key, oldCoord, targetCoord) {
    if (!_blacklist[targetCoord])      _blacklist[targetCoord] = { offs: new Set(), nobles: new Set() };
    if (!_blacklist[targetCoord][key]) _blacklist[targetCoord][key] = new Set();
    _blacklist[targetCoord][key].add(oldCoord);

    const btn = document.querySelector(`.reload-coord[data-aidx="${aIdx}"][data-key="${key}"][data-coord="${oldCoord}"]`);
    if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

    try {
        const res  = await fetch('/api/plan/reload-coord', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                target_coord: targetCoord, old_coord: oldCoord, type: key,
                blacklisted: Array.from(_blacklist[targetCoord][key]),
            }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Brak dostępnych wiosek.'); return; }
        _currentAssignments = data.assignments;
        _renderAssignments(_currentAssignments, _planEditMode);
    } catch { alert('Błąd połączenia.'); }
}
