/* ── STATUS AKCJI ────────────────────────────────────────────────────────── */
// Tracks per-attack status: "unknown" | "sent" | "missed"
// Attack ID format: "fromCoord→target:TYPE"

let _statusMap    = {};   // { id: "sent"|"missed"|"unknown" }
let _statusPlan   = [];   // current assignments snapshot
let _statusPollId = null; // setInterval handle for live polling
let _villageIds   = {};   // { coord: gameId }
let _cancelledTargets = new Set(); // coords of cancelled targets

const STATUS_POLL_MS = 30_000; // refresh every 30 s

function _statusId(fromCoord, target, type, idx = 0) {
    return `${fromCoord}→${target}:${type}#${idx}`;
}

async function _silentRefreshStatus() {
    // Only poll if plan is loaded; avoid overwriting mid-click edits
    if (!_statusPlan.length) return;
    try {
        const fresh = await fetch('/api/attack-status').then(r => r.json());
        // Only re-render if something actually changed
        const prev = JSON.stringify(_statusMap);
        if (JSON.stringify(fresh) === prev) return;
        _statusMap = fresh;
        _renderStatusList();
        _updateLiveBar();
    } catch {}
}

function _updateLiveBar() {
    const total   = Object.keys(_statusMap).length;
    const sent    = Object.values(_statusMap).filter(v => v === 'sent').length;
    const missed  = Object.values(_statusMap).filter(v => v === 'missed').length;
    const unknown = total - sent - missed;
    const bar = document.getElementById('status-live-bar');
    if (!bar) return;
    const pSent    = total ? Math.round(sent    / total * 100) : 0;
    const pMissed  = total ? Math.round(missed  / total * 100) : 0;
    const pUnknown = 100 - pSent - pMissed;
    bar.innerHTML = `
        <div class="live-bar-track" title="${sent} wysłanych / ${missed} nie wysłanych / ${unknown} nieznanych">
            <div class="live-bar-sent"    style="width:${pSent}%"   ></div>
            <div class="live-bar-missed"  style="width:${pMissed}%" ></div>
            <div class="live-bar-unknown" style="width:${pUnknown}%"></div>
        </div>
        <span class="live-bar-label">
            <span style="color:#4ec97a">✅ ${sent}</span>
            <span style="color:#e06060">❌ ${missed}</span>
            <span style="color:#888">❓ ${unknown}</span>
            <span class="live-dot" title="Live – odświeża co 30 s">●</span>
        </span>`;
}

function _startStatusPolling() {
    if (_statusPollId) return;
    _statusPollId = setInterval(_silentRefreshStatus, STATUS_POLL_MS);
}

function _stopStatusPolling() {
    if (_statusPollId) { clearInterval(_statusPollId); _statusPollId = null; }
}

async function loadAttackStatus() {
    const msg = document.getElementById('status-tracker-msg');
    setStatus(msg, 'Ładowanie…');
    try {
        [_statusMap, _villageIds] = await Promise.all([
            fetch('/api/attack-status').then(r => r.json()),
            fetch('/api/village-ids').then(r => r.json()).catch(() => ({})),
        ]);
        const cancelled = await fetch('/api/cancelled-targets').then(r => r.json()).catch(() => []);
        _cancelledTargets = new Set(Array.isArray(cancelled) ? cancelled : []);

        // Use the already-computed plan from the Rozpiski tab if available,
        // otherwise fall back to the timeline endpoint which reconstructs it.
        if (_currentAssignments.length) {
            _statusPlan = _currentAssignments;
        } else {
            const tl = await fetch('/api/timeline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            }).then(r => r.ok ? r.json() : null).catch(() => null);

            if (tl) {
                // Rebuild minimal assignment list from sends
                const byTarget = {};
                for (const s of tl.sends) {
                    if (!byTarget[s.target]) byTarget[s.target] = { target: s.target, offs: [], nobles: [] };
                    if (s.type === 'OFF')       byTarget[s.target].offs.push(s.from_coord);
                    if (s.type === 'SZLACHCIC') byTarget[s.target].nobles.push(s.from_coord);
                }
                _statusPlan = Object.values(byTarget);
            }
        }

        _renderStatusList();
        _updateLiveBar();
        _startStatusPolling();
        setStatus(msg, `✓ Załadowano ${_statusPlan.length} celów.`, 'ok');
    } catch (e) {
        setStatus(msg, 'Błąd ładowania: ' + e.message, 'err');
    }
}

async function _setStatus(id, st) {
    _statusMap[id] = st;
    await fetch('/api/attack-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: { [id]: st } }),
    });
    _updateStatusRow(id);
    _updateCoverage();
}

function _updateStatusRow(id) {
    const row = document.querySelector(`.status-row[data-sid="${CSS.escape(id)}"]`);
    if (!row) return;
    const st = _statusMap[id] || 'unknown';
    row.dataset.status = st;
    row.querySelectorAll('.st-btn').forEach(b => b.classList.toggle('active', b.dataset.st === st));
    const icon = row.querySelector('.st-icon');
    if (icon) icon.textContent = st === 'sent' ? '✅' : st === 'missed' ? '❌' : '❓';
}

function _renderStatusList() {
    const container = document.getElementById('status-player-list');
    if (!_statusPlan.length) {
        container.innerHTML = '<div class="card"><p class="hint">Brak rozpiski. Uruchom planowanie w zakładce 📋 Rozpiski, potem wróć tutaj.</p></div>';
        return;
    }

    // Group by target
    const byTarget = {};
    for (const asgn of _statusPlan) {
        const tcoord = asgn.target;
        if (!byTarget[tcoord]) byTarget[tcoord] = [];
        const countPerCoord = {};
        const addRow = (coord, type) => {
            const key = `${coord}:${type}`;
            const idx = (countPerCoord[key] = (countPerCoord[key] ?? -1) + 1);
            const player = _playerByCoord[coord] || '?';
            const id = _statusId(coord, tcoord, type, idx);
            byTarget[tcoord].push({ id, coord, tcoord, type, player, st: _statusMap[id] || 'unknown' });
        };
        for (const c of (asgn.offs || []))   addRow(c, 'OFF');
        for (const c of (asgn.nobles || [])) addRow(c, 'SZLACHCIC');
    }

    const targetOrder = Object.keys(byTarget).sort();

    const makeRow = (r) => {
        const fromId = _villageIds[r.coord];
        const tgtId  = _villageIds[r.tcoord];
        const server = (_settings && _settings.server) ? _settings.server : '';
        const gameLink = (fromId && tgtId && server)
            ? ` <a href="https://pl${server}.plemiona.pl/game.php?village=${fromId}&screen=place&target=${tgtId}" target="_blank" title="Wyślij w grze" style="font-size:.8rem;opacity:.55;text-decoration:none">🔗</a>`
            : '';
        return `
        <tr class="status-row" data-sid="${escHtml(r.id)}" data-status="${r.st}">
            <td class="st-icon" style="font-size:1.1rem;text-align:center">${r.st === 'sent' ? '✅' : r.st === 'missed' ? '❌' : '❓'}</td>
            <td><code>${r.coord}</code>${gameLink}</td>
            <td style="color:${r.type === 'OFF' ? '#cc8844' : '#4488cc'};font-weight:600">${r.type}</td>
            <td style="color:#aaa;font-size:.85rem">${escHtml(r.player)}</td>
            <td>
                <button class="st-btn ${r.st === 'sent'    ? 'active' : ''}" data-sid="${escHtml(r.id)}" data-st="sent"    title="Wysłana">✅</button>
                <button class="st-btn ${r.st === 'missed'  ? 'active' : ''}" data-sid="${escHtml(r.id)}" data-st="missed"  title="Nie wysłana">❌</button>
                <button class="st-btn ${r.st === 'unknown' ? 'active' : ''}" data-sid="${escHtml(r.id)}" data-st="unknown" title="Nieznany">❓</button>
            </td>
        </tr>`;
    };

    const makeSide = (rows, title, color) => {
        if (!rows.length) return `<div style="color:#555;font-size:.85rem;padding:.4rem 0">${title}: brak</div>`;
        return `<div style="color:${color};font-weight:600;font-size:.85rem;margin-bottom:.3rem">${title}</div>
            <div class="table-wrap"><table>
                <thead><tr><th></th><th>Z wioski</th><th>Typ</th><th>Gracz</th><th>Status</th></tr></thead>
                <tbody>${rows.map(makeRow).join('')}</tbody>
            </table></div>`;
    };

    container.innerHTML = targetOrder.map(tcoord => {
        const rows    = byTarget[tcoord];
        const total   = rows.length;
        const sent    = rows.filter(r => r.st === 'sent').length;
        const missed  = rows.filter(r => r.st === 'missed').length;
        const unknown = rows.filter(r => r.st === 'unknown').length;

        const cancelled = _cancelledTargets.has(tcoord);
        const summaryColor = cancelled ? '#888' : missed > 0 ? '#e06060' : unknown > 0 ? '#e0a030' : '#4ec97a';
        const summaryText  = cancelled ? '🚫 Odwołany' : missed > 0 ? `❌ ${missed} nie wysłano` : unknown > 0 ? `❓ ${unknown} nieznany` : '✅ Wszystko wysłane';

        const needRows = rows.filter(r => r.st !== 'sent');
        const sentRows = rows.filter(r => r.st === 'sent');

        return `<div class="card status-player-card${cancelled ? ' target-cancelled' : ''}">
            <div class="status-player-header">
                <span class="status-player-name">🎯 Cel: <strong><code>${escHtml(tcoord)}</code></strong></span>
                <span class="status-player-summary" style="color:${summaryColor}">${summaryText}</span>
                <span class="status-counts">${sent}/${total} wysłanych</span>
                <button class="btn btn-sm cancel-target-btn${cancelled ? ' btn-danger' : ''}" data-tcoord="${escHtml(tcoord)}" style="margin-left:auto"
                    title="${cancelled ? 'Przywróć cel' : 'Odwołaj cel (gracze dostaną komunikat)'}">${cancelled ? '↩ Przywróć' : '🚫 Odwołaj'}</button>
                <button class="btn btn-sm" data-mark-all-target="${escHtml(tcoord)}">✅ Wszystkie wysłane</button>
            </div>
            <div class="status-split">
                <div>${makeSide(needRows, '❌❓ Brakujące / Nieznane', '#e06060')}</div>
                <div>${makeSide(sentRows, '✅ Wysłane', '#4ec97a')}</div>
            </div>
        </div>`;
    }).join('');

    // Wire status buttons
    container.querySelectorAll('.st-btn').forEach(btn => {
        btn.addEventListener('click', () => _setStatus(btn.dataset.sid, btn.dataset.st));
    });

    // Wire cancel-target buttons
    container.querySelectorAll('.cancel-target-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tcoord = btn.dataset.tcoord;
            const res  = await fetch('/api/cancelled-targets/toggle', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ coord: tcoord }),
            });
            const data = await res.json();
            _cancelledTargets = new Set(data.cancelled || []);
            _renderStatusList();
            _showCancelledMessage();
        });
    });

    // Wire per-target "mark all sent" buttons
    container.querySelectorAll('[data-mark-all-target]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const tcoord = btn.dataset.markAllTarget;
            const updates = {};
            for (const asgn of _statusPlan) {
                if (asgn.target !== tcoord) continue;
                const cnt = {};
                for (const c of (asgn.offs || [])) {
                    const k = `${c}:OFF`;
                    const i = (cnt[k] = (cnt[k] ?? -1) + 1);
                    updates[_statusId(c, tcoord, 'OFF', i)] = 'sent';
                }
                for (const c of (asgn.nobles || [])) {
                    const k = `${c}:SZLACHCIC`;
                    const i = (cnt[k] = (cnt[k] ?? -1) + 1);
                    updates[_statusId(c, tcoord, 'SZLACHCIC', i)] = 'sent';
                }
            }
            Object.assign(_statusMap, updates);
            await fetch('/api/attack-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates }),
            });
            _renderStatusList();
            _updateCoverage();
        });
    });

    _updateCoverage();
}

function _updateCoverage() {
    const missedCount = Object.values(_statusMap).filter(v => v === 'missed').length;
    if (missedCount > 0) {
        show('coverage-card');
        _generateCoveragePost();
    } else {
        hide('coverage-card');
    }
}

async function _generateCoveragePost() {
    try {
        const payload = _currentAssignments.length ? { assignments: _currentAssignments } : {};
        const res  = await fetch('/api/attack-status/coverage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.bbcode) {
            document.getElementById('coverage-bbcode').value = data.bbcode;
        }
    } catch {}
}

async function _markAllSent() {
    const updates = {};
    for (const asgn of _statusPlan) {
        const cnt = {};
        for (const c of (asgn.offs || [])) {
            const k = `${c}:OFF`;
            const i = (cnt[k] = (cnt[k] ?? -1) + 1);
            updates[_statusId(c, asgn.target, 'OFF', i)] = 'sent';
        }
        for (const c of (asgn.nobles || [])) {
            const k = `${c}:SZLACHCIC`;
            const i = (cnt[k] = (cnt[k] ?? -1) + 1);
            updates[_statusId(c, asgn.target, 'SZLACHCIC', i)] = 'sent';
        }
    }
    Object.assign(_statusMap, updates);
    await fetch('/api/attack-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
    });
    _renderStatusList();
    setStatus(document.getElementById('status-tracker-msg'), '✅ Wszystkie oznaczone jako wysłane.', 'ok');
}

async function _resetStatus() {
    if (!confirm('Zresetować wszystkie statusy do "nieznany"?')) return;
    _statusMap = {};
    await fetch('/api/attack-status', { method: 'DELETE' });
    _renderStatusList();
    setStatus(document.getElementById('status-tracker-msg'), '✓ Zresetowano.', 'ok');
}

async function _showCancelledMessage() {
    if (_cancelledTargets.size === 0) {
        hide('cancelled-msg-card');
        return;
    }
    try {
        const payload = _currentAssignments.length ? { assignments: _currentAssignments } : {};
        payload.cancelled = [..._cancelledTargets];
        const res  = await fetch('/api/cancelled-targets/message', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok && data.bbcode) {
            document.getElementById('cancelled-msg-bbcode').value = data.bbcode;
            show('cancelled-msg-card');
        }
    } catch {}
}

// Wire buttons
document.getElementById('btn-load-status').addEventListener('click', loadAttackStatus);
document.getElementById('btn-mark-all-sent').addEventListener('click', _markAllSent);
document.getElementById('btn-reset-status').addEventListener('click', _resetStatus);
document.getElementById('btn-copy-coverage').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('coverage-bbcode').value).then(() => {
        const btn = document.getElementById('btn-copy-coverage');
        const orig = btn.textContent;
        btn.textContent = '✓ Skopiowano!';
        setTimeout(() => btn.textContent = orig, 2000);
    });
});
document.getElementById('btn-copy-cancelled').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('cancelled-msg-bbcode').value).then(() => {
        const btn = document.getElementById('btn-copy-cancelled');
        const orig = btn.textContent;
        btn.textContent = '✓ Skopiowano!';
        setTimeout(() => btn.textContent = orig, 2000);
    });
});

// Auto-load when switching to status tab
document.querySelectorAll('.tab-btn[data-tab="status"]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!_statusPlan.length) loadAttackStatus();
    });
});
