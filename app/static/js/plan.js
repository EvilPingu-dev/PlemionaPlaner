/* ── ROZPISKI ───────────────────────────────────────────────────────────── */

let _settings           = {};
let _currentAssignments      = [];
let _currentBurstAssignments = [];
let _currentFakeAssignments  = [];
let _planEditMode       = false;
let _blacklist          = {}; // { targetCoord: { offs: Set, nobles: Set } }
let _candidatesPopup    = null;
let _stackModalAIdx     = null;  // which assignment the modal is targeting
let _dragSrc            = null; // { aIdx, key, cidx } while dragging

// ── Stack nobles modal: make it draggable ────────────────────────────────
(function _initStackModal() {
    document.addEventListener('DOMContentLoaded', () => {
        const modal  = document.getElementById('stack-nobles-modal');
        const header = document.getElementById('stack-modal-header');
        const closeBtn = document.getElementById('stack-modal-close');
        if (!modal || !header) return;

        closeBtn.addEventListener('click', () => modal.classList.remove('open'));

        let ox = 0, oy = 0, mx = 0, my = 0;
        header.addEventListener('mousedown', e => {
            e.preventDefault();
            ox = modal.offsetLeft - e.clientX;
            oy = modal.offsetTop  - e.clientY;
            const onMove = ev => {
                const x = Math.max(0, Math.min(window.innerWidth  - modal.offsetWidth,  ev.clientX + ox));
                const y = Math.max(0, Math.min(window.innerHeight - modal.offsetHeight, ev.clientY + oy));
                modal.style.left = x + 'px';
                modal.style.top  = y + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',  onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    });
})();

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
    _currentAssignments      = JSON.parse(JSON.stringify(assignments));
    _currentBurstAssignments = JSON.parse(JSON.stringify(burst_assignments || []));
    _currentFakeAssignments  = JSON.parse(JSON.stringify(fake_assignments  || []));
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
        summaryItem(summary.nobles_assigned,  'Szlachciców przydzielono') +
        summaryItem(summary.offs_free ?? (summary.offs_available - summary.offs_assigned), 'Wolne wioski off');

    _renderAssignments(assignments, false);
    _renderBurstAssignments(burst_assignments || []);
    _renderFakeAssignments(fake_assignments || []);
    _populateTimingToolbar();

    show('plan-summary-card');
    show('plan-results-card');
    if ((burst_assignments || []).length) show('plan-burst-card'); else hide('plan-burst-card');
    if ((fake_assignments  || []).length) show('plan-fake-card');  else hide('plan-fake-card');
}

function _applySlotToAll(dt) {
    const gapMs = _gapFieldsToMs('plan');
    _currentAssignments.forEach(a => {
        a.arrival_dt = dt;
        a.noble_arrival_dt = (gapMs > 0)
            ? _toLocalISOString(new Date(new Date(dt).getTime() + gapMs))
            : dt;
    });
    _renderAssignments(_currentAssignments, _planEditMode);
    _saveCurrentPlan();
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
        btn.addEventListener('click', () => _applySlotToAll(btn.dataset.dt.slice(0, 19)));
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
            const offVal     = d.off ?? (_lastTroops || []).find(v => v.coord === d.coord)?.off;
            const offSpan    = (key === 'offs' && offVal != null) ? ` <small class="dist-tag" style="color:#cc8844">⚔ ${fmt(offVal)}</small>` : '';
            const removeBtn = editMode
                ? `<button class="remove-coord" data-aidx="${aIdx}" data-key="${key}" data-cidx="${idx}" title="Usuń">✕</button>`
                : '';
            const reloadBtn = `<button class="reload-coord" data-aidx="${aIdx}" data-key="${key}" data-cidx="${idx}" data-coord="${d.coord}" data-target="${a.target}" title="Zamień na następną najlepszą wioskę">↻</button>`;
            const pickBtn  = `<button class="pick-coord"   data-aidx="${aIdx}" data-key="${key}" data-cidx="${idx}" data-coord="${d.coord}" data-target="${a.target}" title="Wybierz z listy">▾</button>`;
            const crownBtn = key === 'nobles'
                ? `<button class="crown-coord${d.is_conqueror ? ' crown-active' : ''}" data-aidx="${aIdx}" data-cidx="${idx}" title="${d.is_conqueror ? 'Zdobywca (kliknij by odznaczać)' : 'Oznacz jako zdobywcę (+5s później)'}">👑</button>`
                : '';
            return `<span class="coord-tag ${cls}${isNight ? ' night-send' : ''}${d.is_conqueror ? ' conqueror-tag' : ''}" draggable="true" data-aidx="${aIdx}" data-key="${key}" data-cidx="${idx}">${removeBtn}${reloadBtn}${pickBtn}${crownBtn}${playerSpan}${d.coord}${offSpan}${distStr}${nightMark}</span>`;
        };

        const offTags   = (a.offs_detail   || a.offs.map(c   => ({coord: c, dist: null}))).map((d, i) => makeTag(d, offSpeed,   '',          'offs',   i, offArrivalStr)).join('');
        const CONQ_OFFSET_MS = 5000;
        const nobleTags = (a.nobles_detail || a.nobles.map(c => ({coord: c, dist: null}))).map((d, i) => {
            const arrStr = (d.is_conqueror && nobleArrivalStr)
                ? _localIsoAdd(nobleArrivalStr, CONQ_OFFSET_MS)
                : nobleArrivalStr;
            return makeTag(d, nobleSpeed, 'noble-tag', 'nobles', i, arrStr);
        }).join('');

        const addOffInput   = editMode ? `<div class="add-coord-row"><input class="add-coord-input" placeholder="x|y" data-aidx="${aIdx}" data-key="offs"><button class="btn btn-sm add-coord-btn" data-aidx="${aIdx}" data-key="offs">+ Dodaj off</button></div>` : '';
        const addNobleInput = editMode ? `<div class="add-coord-row"><input class="add-coord-input" placeholder="x|y" data-aidx="${aIdx}" data-key="nobles"><button class="btn btn-sm add-coord-btn" data-aidx="${aIdx}" data-key="nobles">+ Dodaj szlachcica</button></div>` : '';

        const offDtVal   = offArrivalStr   ? offArrivalStr.slice(0,19)   : '';
        const nobleGapMs = Math.round((_settings.off_noble_gap_minutes ?? 1) * 60000);
        const nobleDtDisplay = (offDtVal && nobleGapMs > 0)
            ? _fmtTimeMs(new Date(new Date(offDtVal).getTime() + nobleGapMs))
            : (offDtVal ? _fmtTimeMs(offDtVal) : '');
        const gapLabel = `<span class="timing-noble-chip">⚔ szlachcice ${_fmtGap(nobleGapMs)} <span class="timing-noble-dt">${nobleDtDisplay}</span></span>`;
        const slotBtns = (_settings.arrival_slots || []).map((slot, si) => {
            const label = slot.label || `Fala ${si + 1}`;
            const dtStr = slot.datetime ? slot.datetime.slice(11, 16) : '??:??';
            return `<button class="btn btn-sm slot-apply-single" data-aidx="${aIdx}" data-dt="${_esc(slot.datetime || '')}">${label}: ${dtStr}</button>`;
        }).join('');

        return `
        <div class="assign-block">
            <div class="assign-header">
                <span class="assign-target">🎯 ${a.target}</span>
                ${offBadge} ${nobleBadge}
                ${editMode ? `<button class="remove-target btn btn-sm" data-aidx="${aIdx}" title="Usuń cel z rozpiski" style="margin-left:auto;color:#e06060">✕ Usuń cel</button>` : ''}
            </div>
            <div class="assign-body">
                <div class="assign-group">
                    <label>Offowe wioski ${offMissing} <button class="btn btn-sm promote-to-off-btn" data-aidx="${aIdx}" data-target="${a.target}" title="Przenieś wioskę z fejków/burzaków do offów">+</button></label>
                    <div class="coord-list">${offTags || '<span class="missing">brak</span>'}</div>
                    ${addOffInput}
                </div>
                <div class="assign-group">
                    <label>Szlachcice ${nobleMissing} <button class="btn btn-sm promote-to-off-btn" data-aidx="${aIdx}" data-target="${a.target}" data-mode="noble" title="Przenieś szlachcica z fejków">+</button>
                        ${a.nobles.length > 1 ? `<button class="btn btn-sm stack-nobles-btn" data-aidx="${aIdx}" data-target="${a.target}" title="Wyślij wszystkie szlachcice z jednej wioski">⊞ Stack</button>` : ''}
                    </label>
                    <div class="coord-list">${nobleTags || '<span class="missing">brak</span>'}</div>
                    ${addNobleInput}
                </div>
            </div>
            <div class="assign-timing">
                <span class="timing-label-sm">Wejście OFF:</span>
                <input type="datetime-local" class="asgn-off-dt" step="1" data-aidx="${aIdx}" value="${_esc(offDtVal)}">
                ${gapLabel}
                ${slotBtns ? `<span class="timing-slot-inline">${slotBtns}</span>` : ''}
            </div>
        </div>`;
    }).join('');

    if (editMode) {
        document.querySelectorAll('.remove-target').forEach(btn => {
            btn.addEventListener('click', () => {
                const aIdx = parseInt(btn.dataset.aidx);
                _currentAssignments.splice(aIdx, 1);
                _renderAssignments(_currentAssignments, true);
                _saveCurrentPlan();
            });
        });
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
                _saveCurrentPlan();
            });
        });
        document.querySelectorAll('.reload-coord').forEach(btn => {
            btn.addEventListener('click', () =>
                reloadCoord(parseInt(btn.dataset.aidx), btn.dataset.key, btn.dataset.coord, btn.dataset.target)
            );
        });
        document.querySelectorAll('.pick-coord').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                showCandidates(btn, parseInt(btn.dataset.aidx), btn.dataset.key, btn.dataset.coord, btn.dataset.target);
            });
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

    // ── Drag-and-drop reordering (always active) ──────────────────────────
    document.querySelectorAll('.coord-tag[draggable]').forEach(tag => {
        tag.addEventListener('dragstart', e => {
            _dragSrc = { aIdx: parseInt(tag.dataset.aidx), key: tag.dataset.key, cidx: parseInt(tag.dataset.cidx) };
            tag.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tag.dataset.cidx);
        });
        tag.addEventListener('dragend', () => {
            tag.classList.remove('dragging');
            document.querySelectorAll('.coord-tag.drag-over').forEach(el => el.classList.remove('drag-over'));
            _dragSrc = null;
        });
        tag.addEventListener('dragover', e => {
            if (!_dragSrc) return;
            const sameList = parseInt(tag.dataset.aidx) === _dragSrc.aIdx && tag.dataset.key === _dragSrc.key;
            if (!sameList) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            document.querySelectorAll('.coord-tag.drag-over').forEach(el => el.classList.remove('drag-over'));
            if (parseInt(tag.dataset.cidx) !== _dragSrc.cidx) tag.classList.add('drag-over');
        });
        tag.addEventListener('dragleave', () => tag.classList.remove('drag-over'));
        tag.addEventListener('drop', e => {
            e.preventDefault();
            tag.classList.remove('drag-over');
            if (!_dragSrc) return;
            const toAIdx = parseInt(tag.dataset.aidx);
            const toKey  = tag.dataset.key;
            const toCidx = parseInt(tag.dataset.cidx);
            if (toAIdx !== _dragSrc.aIdx || toKey !== _dragSrc.key || toCidx === _dragSrc.cidx) return;
            const a      = _currentAssignments[_dragSrc.aIdx];
            const list   = a[_dragSrc.key];
            const detail = a[_dragSrc.key + '_detail'];
            const [movedCoord] = list.splice(_dragSrc.cidx, 1);
            list.splice(toCidx, 0, movedCoord);
            if (detail && detail.length) {
                const [movedDetail] = detail.splice(_dragSrc.cidx, 1);
                detail.splice(toCidx, 0, movedDetail);
            }
            _dragSrc = null;
            _renderAssignments(_currentAssignments, _planEditMode);
            _saveCurrentPlan();
        });
    });

    // ── Per-assignment Fala slot buttons — only update this assignment ───────
    document.querySelectorAll('.slot-apply-single').forEach(btn => {
        btn.addEventListener('click', () => {
            const aIdx = parseInt(btn.dataset.aidx);
            const dt   = btn.dataset.dt.slice(0, 19);
            const gapMs = _gapFieldsToMs('plan');
            const a = _currentAssignments[aIdx];
            a.arrival_dt       = dt;
            a.noble_arrival_dt = (gapMs > 0)
                ? _toLocalISOString(new Date(new Date(dt).getTime() + gapMs))
                : dt;
            _renderAssignments(_currentAssignments, _planEditMode);
            _saveCurrentPlan();
        });
    });

    // ── Promote village from fejki/burzaki to offs or nobles ─────────────
    document.querySelectorAll('.promote-to-off-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (btn.dataset.mode === 'noble')
                _promoteNoble(parseInt(btn.dataset.aidx), btn.dataset.target);
            else
                _promoteToOff(parseInt(btn.dataset.aidx), btn.dataset.target);
        });
    });

    // ── Stack nobles popup ─────────────────────────────────────────────────
    document.querySelectorAll('.stack-nobles-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            showStackNoblesPopup(btn, parseInt(btn.dataset.aidx), btn.dataset.target);
        });
    });

    // ── Crown (conqueror) toggle — always active ──────────────────────────
    document.querySelectorAll('.crown-coord').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const aIdx = parseInt(btn.dataset.aidx);
            const cidx = parseInt(btn.dataset.cidx);
            const a    = _currentAssignments[aIdx];
            if (!a.nobles_detail) a.nobles_detail = (a.nobles || []).map(c => ({ coord: c, dist: null }));
            const wasConq = !!a.nobles_detail[cidx]?.is_conqueror;
            a.nobles_detail.forEach(d => { d.is_conqueror = false; });
            if (!wasConq && a.nobles_detail[cidx]) a.nobles_detail[cidx].is_conqueror = true;
            _renderAssignments(_currentAssignments, _planEditMode);
            _saveCurrentPlan();
        });
    });
}

function _saveCurrentPlan() {
    return fetch('/api/plan/override', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments: _currentAssignments }),
    });
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
            <div class="assign-header"><span class="assign-target">&#x1F4A5; ${a.target}${building}</span>${badge} <button class="btn btn-sm promote-target-btn" data-target="${a.target}" data-source="burst" title="Utwórz cel szlachciców z tego celu">&#x2795; Szlachcice</button></div>
            <div class="assign-body"><div class="assign-group">
                <label>Katapulty</label>
                <div class="coord-list">${tags || '<span class="missing">brak</span>'}</div>
            </div></div>
        </div>`;
    }).join('');
    el.querySelectorAll('.promote-target-btn').forEach(btn => {
        btn.addEventListener('click', () => _promoteTargetToNobles(btn.dataset.target, btn.dataset.source));
    });
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
            <div class="assign-header"><span class="assign-target">&#x1F3AD; ${a.target}</span>${badgeFo} ${badgeFn} <button class="btn btn-sm promote-target-btn" data-target="${a.target}" data-source="fake" title="Utwórz cel szlachciców z tego celu">&#x2795; Szlachcice</button></div>
            <div class="assign-body">
                <div class="assign-group"><label>Fejki offowe</label><div class="coord-list">${foTags || '<span class="missing">brak</span>'}</div></div>
                <div class="assign-group"><label>Fejki szlachcicowe</label><div class="coord-list">${fnTags || '<span class="missing">brak</span>'}</div></div>
            </div>
        </div>`;
    }).join('');
    el.querySelectorAll('.promote-target-btn').forEach(btn => {
        btn.addEventListener('click', () => _promoteTargetToNobles(btn.dataset.target, btn.dataset.source));
    });
}

function calcSendStr(arrivalIso, travelMinutes) {
    const d  = new Date(new Date(arrivalIso).getTime() - travelMinutes * 60000);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

async function _promoteTargetToNobles(targetCoord, source) {
    // Remove from BOTH lists — once it becomes a real target it leaves both
    const fIdx = _currentFakeAssignments.findIndex(fa => fa.target === targetCoord);
    if (fIdx !== -1) _currentFakeAssignments.splice(fIdx, 1);
    const bIdx = _currentBurstAssignments.findIndex(ba => ba.target === targetCoord);
    if (bIdx !== -1) _currentBurstAssignments.splice(bIdx, 1);

    _currentAssignments.push({
        target: targetCoord,
        offs_needed: 0, nobles_needed: 1,
        offs: [], offs_detail: [],
        nobles: [], nobles_detail: [],
        offs_missing: 0, nobles_missing: 1,
        arrival_dt: null, noble_arrival_dt: null,
    });

    // Save to server so add-noble can find the new assignment
    await _saveCurrentPlan();
    _renderBurstAssignments(_currentBurstAssignments);
    _renderFakeAssignments(_currentFakeAssignments);

    // Autofill noble
    try {
        const res  = await fetch('/api/plan/add-noble', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_coord: targetCoord, blacklisted: [] }),
        });
        const data = await res.json();
        if (res.ok) _currentAssignments = data.assignments;
    } catch {}

    _renderAssignments(_currentAssignments, _planEditMode);
}

async function _promoteNoble(aIdx, targetCoord) {
    try {
        const res  = await fetch('/api/plan/add-noble', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_coord: targetCoord, blacklisted: [] }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Brak dost\u0119pnych szlachcic\u00f3w.'); return; }
        _currentAssignments = data.assignments;
        _renderAssignments(_currentAssignments, _planEditMode);
    } catch { alert('B\u0142\u0105d po\u0142\u0105czenia.'); }
}

function _promoteToOff(aIdx, targetCoord) {
    let coord = null;

    // 1. Prefer fake_offs going to the same target coord
    for (const fa of _currentFakeAssignments) {
        if (fa.target === targetCoord && fa.fake_offs.length > 0) {
            coord = fa.fake_offs.shift();
            if (fa.fake_offs_detail) fa.fake_offs_detail.shift();
            fa.fakes = Math.max(0, fa.fakes - 1);
            break;
        }
    }
    // 2. Any fake_offs
    if (!coord) {
        for (const fa of _currentFakeAssignments) {
            if (fa.fake_offs.length > 0) {
                coord = fa.fake_offs.shift();
                if (fa.fake_offs_detail) fa.fake_offs_detail.shift();
                fa.fakes = Math.max(0, fa.fakes - 1);
                break;
            }
        }
    }
    // 3. Catapult as fallback
    if (!coord) {
        for (const ba of _currentBurstAssignments) {
            if (ba.catapults.length > 0) {
                coord = ba.catapults.shift();
                if (ba.catapults_detail) ba.catapults_detail.shift();
                ba.attacks = Math.max(0, ba.attacks - 1);
                break;
            }
        }
    }

    if (!coord) { alert('Brak wolnych wiosek w fejkach/burzakach.'); return; }

    const a = _currentAssignments[aIdx];
    a.offs.push(coord);
    a.offs_detail = a.offs_detail || [];
    a.offs_detail.push({ coord, dist: null, speed: null, is_night: false });
    a.offs_missing = Math.max(0, (a.offs_needed || 0) - a.offs.length);

    _renderAssignments(_currentAssignments, _planEditMode);
    _renderBurstAssignments(_currentBurstAssignments);
    _renderFakeAssignments(_currentFakeAssignments);
    _saveCurrentPlan();
}

/** Add `deltaMs` to a local-time ISO string and return a local-time ISO string.
 *  Avoids toISOString() which would convert to UTC and cause a double-offset bug. */
function _localIsoAdd(localIso, deltaMs) {
    const d   = new Date(new Date(localIso).getTime() + deltaMs);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

    const _doReload = async (bl) => fetch('/api/plan/reload-coord', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_coord: targetCoord, old_coord: oldCoord, type: key,
                               blacklisted: Array.from(bl) }),
    });

    try {
        let res  = await _doReload(_blacklist[targetCoord][key]);
        let data = await res.json();
        if (!res.ok) {
            // Wrap around: clear blacklist and retry from the beginning
            _blacklist[targetCoord][key].clear();
            _blacklist[targetCoord][key].add(oldCoord);
            res  = await _doReload(_blacklist[targetCoord][key]);
            data = await res.json();
        }
        if (!res.ok) { alert(data.error || 'Brak dostępnych wiosek.'); return; }
        _currentAssignments = data.assignments;
        _renderAssignments(_currentAssignments, _planEditMode);
    } catch { alert('Błąd połączenia.'); }
}

function _getCandidatesPopup() {
    if (_candidatesPopup) return _candidatesPopup;
    const el = document.createElement('div');
    el.id = 'candidates-popup';
    document.body.appendChild(el);
    document.addEventListener('click', e => {
        if (_candidatesPopup && !_candidatesPopup.contains(e.target) && !e.target.classList.contains('pick-coord'))
            _candidatesPopup.style.display = 'none';
    });
    _candidatesPopup = el;
    return el;
}

async function showCandidates(btn, aIdx, key, oldCoord, targetCoord) {
    const popup = _getCandidatesPopup();
    const rect  = btn.getBoundingClientRect();
    popup.style.display = 'block';
    popup.innerHTML = '<div class="cand-loading">Ładowanie…</div>';
    const left = Math.min(rect.left, window.innerWidth - 310);
    const top  = rect.bottom + window.scrollY + 4;
    popup.style.left = left + 'px';
    popup.style.top  = top  + 'px';

    // Exclude coords already assigned to this target (except the one being replaced)
    const a = _currentAssignments.find(a => a.target === targetCoord);
    const excl = a ? (a[key] || []).filter(c => c !== oldCoord) : [];

    try {
        const res  = await fetch('/api/plan/candidates', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_coord: targetCoord, old_coord: oldCoord,
                                   type: key, blacklisted: excl, limit: 500,
                                   assignments: _currentAssignments }),
        });
        const data = await res.json();
        const cands = data.candidates || [];
        if (!cands.length) {
            popup.innerHTML = '<div class="cand-loading" style="color:#c06060">Brak dostępnych wiosek.</div>';
            return;
        }
        const renderCands = (filter) => {
            const filtered = filter ? cands.filter(c =>
                c.coord.includes(filter) || c.player.toLowerCase().includes(filter.toLowerCase())
            ) : cands;
            const items = filtered.map(c => {
                const night = c.is_night ? ' 🌙' : '';
                return `<div class="cand-item${c.is_night ? ' cand-night' : ''}"
                    data-aidx="${aIdx}" data-key="${key}" data-old="${oldCoord}"
                    data-new="${c.coord}" data-target="${targetCoord}">
                    <span class="cand-coord">${c.coord}</span>
                    ${c.player ? `<span class="cand-player">${c.player}</span>` : ''}
                    <span class="cand-meta">${c.dist} pol · ${c.travel_min}min${night}</span>
                    <span class="cand-off">OFF: ${fmt(c.off)}${c.rams ? ` · Tar: ${c.rams}` : ''}</span>
                </div>`;
            }).join('');
            const listEl = popup.querySelector('.cand-list');
            if (listEl) listEl.innerHTML = items || '<div class="cand-loading" style="color:#888">Brak wyników.</div>';
            popup.querySelectorAll('.cand-item').forEach(item => {
                item.addEventListener('click', async () => {
                    popup.style.display = 'none';
                    await swapCoord(parseInt(item.dataset.aidx), item.dataset.key,
                                    item.dataset.old, item.dataset.new, item.dataset.target);
                });
            });
        };
        popup.innerHTML = `<div style="padding:.4rem .5rem;border-bottom:1px solid #1a3a6a">
            <input class="cand-filter" placeholder="Filtruj gracz / koord…" style="width:100%;box-sizing:border-box;background:#0a1525;border:1px solid #2a4a7a;border-radius:4px;color:#ccd;padding:.25rem .4rem;font-size:.82rem">
            <span style="font-size:.72rem;color:#556;float:right;margin-top:.2rem">${cands.length} wiosek</span>
        </div><div class="cand-list"></div>`;
        renderCands('');
        popup.querySelector('.cand-filter').addEventListener('input', e => renderCands(e.target.value.trim()));
        popup.querySelector('.cand-filter').focus();
    } catch {
        popup.innerHTML = '<div class="cand-loading" style="color:#c06060">Błąd połączenia.</div>';
    }
}

function showStackNoblesPopup(btn, aIdx, targetCoord) {
    const modal  = document.getElementById('stack-nobles-modal');
    const title  = document.getElementById('stack-modal-title');
    const list   = document.getElementById('stack-modal-list');
    if (!modal) return;

    _stackModalAIdx = aIdx;

    const nobleSpeed = parseFloat(_settings.noble_speed || 35);
    const [tx, ty]   = targetCoord.split('|').map(Number);
    const a          = _currentAssignments[aIdx];
    const needed     = a.nobles_needed || a.nobles.length;

    // Group noble villages by player, sorted by distance to this target
    const byPlayer = {};
    for (const v of (_lastTroops || [])) {
        if (v.nobles <= 0) continue;
        const player = _playerByCoord[v.coord] || '?';
        const [vx, vy] = v.coord.split('|').map(Number);
        const dist = Math.round(Math.sqrt((vx - tx) ** 2 + (vy - ty) ** 2) * 10) / 10;
        if (!byPlayer[player]) byPlayer[player] = { player, total: 0, villages: [] };
        byPlayer[player].total += v.nobles;
        byPlayer[player].villages.push({ coord: v.coord, nobles: v.nobles, dist });
    }

    const groups = Object.values(byPlayer)
        .sort((a, b) => b.total - a.total);

    title.textContent = `Stack szlachcice → ${targetCoord}`;

    list.innerHTML = groups.length
        ? groups.map(g => {
            g.villages.sort((a, b) => a.dist - b.dist);
            const avgDist = (g.villages.reduce((s, v) => s + v.dist, 0) / g.villages.length).toFixed(1);
            const overflow = g.total > needed ? ` <span style="color:#aaa;font-size:.8rem">(+${g.total - needed} → dalej)</span>` : '';
            const coords = g.villages.map(v => `<code style="font-size:.75rem;opacity:.7">${v.coord}×${v.nobles}</code>`).join(' ');
            return `<div class="cand-item stack-noble-item" data-player="${escAttr(g.player)}" data-aidx="${aIdx}" data-target="${targetCoord}">
                <span class="cand-player" style="font-size:.95rem;font-weight:600">${g.player}</span>
                <span class="cand-off">Szl: ${g.total}${overflow}</span>
                <span class="cand-meta">~${avgDist} pol · ${g.villages.length} wioski</span>
                <div style="margin-top:.2rem">${coords}</div>
            </div>`;
        }).join('')
        : '<div class="cand-loading" style="color:#c06060">Brak wiosek ze szlachcicami.</div>';

    list.querySelectorAll('.stack-noble-item').forEach(item => {
        item.addEventListener('click', () => {
            stackNoblesFromPlayer(parseInt(item.dataset.aidx), item.dataset.player, item.dataset.target);
            modal.classList.remove('open');
        });
    });

    if (!modal.style.left) {
        const rect = btn.getBoundingClientRect();
        modal.style.top  = Math.min(rect.bottom + 6, window.innerHeight - 200) + 'px';
        modal.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
    }
    modal.classList.add('open');
}

function stackNoblesFromPlayer(aIdx, playerName, _unused) {
    const a0     = _currentAssignments[aIdx];
    const [tx0, ty0] = a0.target.split('|').map(Number);

    // Collect all noble villages of this player, closest to starting target first
    const playerVills = (_lastTroops || [])
        .filter(v => (_playerByCoord[v.coord] || '?') === playerName && v.nobles > 0)
        .map(v => {
            const [vx, vy] = v.coord.split('|').map(Number);
            return { coord: v.coord, nobles: v.nobles, d0: Math.sqrt((vx - tx0) ** 2 + (vy - ty0) ** 2) };
        })
        .sort((a, b) => a.d0 - b.d0);

    // Flat queue: each village contributes v.nobles slots (one coord per noble)
    const queue = playerVills.flatMap(v => Array(v.nobles).fill(v.coord));

    let qIdx = 0;
    for (let i = aIdx; i < _currentAssignments.length && qIdx < queue.length; i++) {
        const a = _currentAssignments[i];
        const needed = a.nobles_needed || 0;
        if (needed <= 0) continue;
        if (i !== aIdx && a.nobles.length >= needed) continue;

        const [tx, ty] = a.target.split('|').map(Number);
        const slots    = i === aIdx ? needed : Math.min(needed - a.nobles.length, queue.length - qIdx);
        const batch    = queue.slice(qIdx, qIdx + slots);
        const detail   = batch.map((coord, j) => {
            const [vx, vy] = coord.split('|').map(Number);
            const dist = Math.round(Math.sqrt((vx - tx) ** 2 + (vy - ty) ** 2) * 10) / 10;
            const hadConq = i === aIdx && j === 0 && (a.nobles_detail || []).some(d => d.is_conqueror);
            return { coord, dist, is_conqueror: hadConq };
        });

        if (i === aIdx) {
            a.nobles = batch; a.nobles_detail = detail;
        } else {
            a.nobles = [...a.nobles, ...batch];
            a.nobles_detail = [...(a.nobles_detail || []), ...detail];
        }
        a.nobles_missing = Math.max(0, (a.nobles_needed || 0) - a.nobles.length);
        qIdx += slots;
    }

    _renderAssignments(_currentAssignments, _planEditMode);
    _saveCurrentPlan();
}

async function swapCoord(aIdx, key, oldCoord, newCoord, targetCoord) {
    try {
        const res  = await fetch('/api/plan/swap-coord', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_coord: targetCoord, old_coord: oldCoord,
                                   new_coord: newCoord, type: key }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Błąd.'); return; }
        _currentAssignments = data.assignments;
        _renderAssignments(_currentAssignments, _planEditMode);
    } catch { alert('Błąd połączenia.'); }
}
