/* ── STATUS AKCJI ────────────────────────────────────────────────────────── */
// Tracks per-attack status: "unknown" | "sent" | "missed"
// Attack ID format: "fromCoord→target:TYPE"

let _statusMap  = {};   // { id: "sent"|"missed"|"unknown" }
let _statusPlan = [];   // current assignments snapshot

function _statusId(fromCoord, target, type) {
    return `${fromCoord}→${target}:${type}`;
}

async function loadAttackStatus() {
    const msg = document.getElementById('status-tracker-msg');
    setStatus(msg, 'Ładowanie…');
    try {
        _statusMap = await fetch('/api/attack-status').then(r => r.json());

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

    // Group by player
    const byPlayer = {};
    for (const asgn of _statusPlan) {
        const tcoord = asgn.target;
        const addRow = (coord, type) => {
            const player = _playerByCoord[coord] || '?';
            if (!byPlayer[player]) byPlayer[player] = [];
            const id = _statusId(coord, tcoord, type);
            byPlayer[player].push({ id, coord, tcoord, type, st: _statusMap[id] || 'unknown' });
        };
        for (const c of (asgn.offs || []))   addRow(c, 'OFF');
        for (const c of (asgn.nobles || [])) addRow(c, 'SZLACHCIC');
    }

    const playerOrder = Object.keys(byPlayer).sort();
    container.innerHTML = playerOrder.map(player => {
        const rows = byPlayer[player];
        const total  = rows.length;
        const sent   = rows.filter(r => r.st === 'sent').length;
        const missed = rows.filter(r => r.st === 'missed').length;
        const unknown = rows.filter(r => r.st === 'unknown').length;

        const summaryColor = missed > 0 ? '#e06060' : unknown > 0 ? '#e0a030' : '#4ec97a';
        const summaryText  = missed > 0 ? `❌ ${missed} nie wysłano` : unknown > 0 ? `❓ ${unknown} nieznany` : '✅ Wszystko wysłane';

        const rowsHtml = rows.map(r => `
            <tr class="status-row" data-sid="${escHtml(r.id)}" data-status="${r.st}">
                <td class="st-icon" style="font-size:1.1rem;text-align:center">${r.st === 'sent' ? '✅' : r.st === 'missed' ? '❌' : '❓'}</td>
                <td><code>${r.coord}</code></td>
                <td style="color:${r.type === 'OFF' ? '#cc8844' : '#4488cc'};font-weight:600">${r.type}</td>
                <td><code>${r.tcoord}</code></td>
                <td>
                    <button class="st-btn ${r.st === 'sent'    ? 'active' : ''}" data-sid="${escHtml(r.id)}" data-st="sent"    title="Wysłana">✅</button>
                    <button class="st-btn ${r.st === 'missed'  ? 'active' : ''}" data-sid="${escHtml(r.id)}" data-st="missed"  title="Nie wysłana">❌</button>
                    <button class="st-btn ${r.st === 'unknown' ? 'active' : ''}" data-sid="${escHtml(r.id)}" data-st="unknown" title="Nieznany">❓</button>
                </td>
            </tr>`).join('');

        return `<div class="card status-player-card">
            <div class="status-player-header">
                <span class="status-player-name">👤 <strong>${escHtml(player)}</strong></span>
                <span class="status-player-summary" style="color:${summaryColor}">${summaryText}</span>
                <span class="status-counts">${sent}/${total} wysłanych</span>
                <button class="btn btn-sm" data-mark-all="${escHtml(player)}" style="margin-left:auto">✅ Wszystkie wysłane</button>
            </div>
            <div class="table-wrap"><table>
                <thead><tr><th></th><th>Z wioski</th><th>Typ</th><th>Cel</th><th>Status</th></tr></thead>
                <tbody>${rowsHtml}</tbody>
            </table></div>
        </div>`;
    }).join('');

    // Wire status buttons
    container.querySelectorAll('.st-btn').forEach(btn => {
        btn.addEventListener('click', () => _setStatus(btn.dataset.sid, btn.dataset.st));
    });

    // Wire per-player "mark all sent" buttons
    container.querySelectorAll('[data-mark-all]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const player = btn.dataset.markAll;
            const updates = {};
            for (const asgn of _statusPlan) {
                for (const c of (asgn.offs || [])) {
                    if ((_playerByCoord[c] || '?') === player)
                        updates[_statusId(c, asgn.target, 'OFF')] = 'sent';
                }
                for (const c of (asgn.nobles || [])) {
                    if ((_playerByCoord[c] || '?') === player)
                        updates[_statusId(c, asgn.target, 'SZLACHCIC')] = 'sent';
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
        for (const c of (asgn.offs || []))
            updates[_statusId(c, asgn.target, 'OFF')] = 'sent';
        for (const c of (asgn.nobles || []))
            updates[_statusId(c, asgn.target, 'SZLACHCIC')] = 'sent';
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

// Auto-load when switching to status tab
document.querySelectorAll('.tab-btn[data-tab="status"]').forEach(btn => {
    btn.addEventListener('click', () => {
        if (!_statusPlan.length) loadAttackStatus();
    });
});
