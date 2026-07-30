/* ── STATUS AKCJI ────────────────────────────────────────────────────────── */
// Tracks per-attack status: "unknown" | "sent" | "missed"
// Attack ID format: "fromCoord→target:TYPE"

let _statusMap    = {};   // { id: "sent"|"missed"|"unknown" }
let _statusPlan   = [];   // current assignments snapshot
let _statusPollId = null; // setInterval handle for live polling
let _villageIds   = {};   // { coord: gameId }
let _cancelledTargets = new Set(); // coords of cancelled targets
let _poolData   = {};   // { attackId: poolEntry } fetched from /api/attack-status/pool
let _poolServer = '';   // server string for game links in pool UI

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
        const addRow = (coord, type, arrivalDt) => {
            const key = `${coord}:${type}`;
            const idx = (countPerCoord[key] = (countPerCoord[key] ?? -1) + 1);
            const player = _playerByCoord[coord] || '?';
            const id = _statusId(coord, tcoord, type, idx);
            byTarget[tcoord].push({ id, coord, tcoord, type, player, st: _statusMap[id] || 'unknown', arrivalDt: arrivalDt || '' });
        };
        for (const c of (asgn.offs || []))   addRow(c, 'OFF', asgn.arrival_dt);
        for (const c of (asgn.nobles || [])) addRow(c, 'SZLACHCIC', asgn.noble_arrival_dt || asgn.arrival_dt);
    }

    const targetOrder = Object.keys(byTarget).sort();

    const makeRow = (r) => {
        const fromId = _villageIds[r.coord];
        const tgtId  = _villageIds[r.tcoord];
        const server = (_settings && _settings.server) ? _settings.server : '';
        const gameLink = (fromId && tgtId && server)
            ? ` <a href="https://pl${server}.plemiona.pl/game.php?village=${fromId}&screen=place&target=${tgtId}" target="_blank" title="Wyślij w grze" style="font-size:.8rem;opacity:.55;text-decoration:none">🔗</a>`
            : '';
        const poolBtn = r.st === 'missed'
            ? `<button class="btn btn-sm pool-pick-btn" data-sid="${escHtml(r.id)}" title="Pokaż dostępną pulę zastępców" style="margin-left:.4rem">🔄 Pula</button>`
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
            <td>${poolBtn}</td>
        </tr>`;
    };

    const makeSide = (rows, title, color) => {
        if (!rows.length) return `<div style="color:#555;font-size:.85rem;padding:.4rem 0">${title}: brak</div>`;
        return `<div style="color:${color};font-weight:600;font-size:.85rem;margin-bottom:.3rem">${title}</div>
            <div class="table-wrap"><table>
                <thead><tr><th></th><th>Z wioski</th><th>Typ</th><th>Gracz</th><th>Status</th><th></th></tr></thead>
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

    // Wire pool-pick buttons (missed attacks → show replacement pool)
    container.querySelectorAll('.pool-pick-btn').forEach(btn => {
        btn.addEventListener('click', () => _togglePoolExpansion(btn.dataset.sid));
    });

    _updateCoverage();
}

async function _fetchPoolData() {
    try {
        const payload = _currentAssignments.length ? { assignments: _currentAssignments } : {};
        const res = await fetch('/api/attack-status/pool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) return;
        _poolData   = {};
        _poolServer = data.server || '';
        for (const ma of (data.missed_attacks || [])) {
            _poolData[ma.id] = ma;
        }
    } catch {}
}

function _togglePoolExpansion(sid) {
    const row = document.querySelector(`.status-row[data-sid="${CSS.escape(sid)}"]`);
    if (!row) return;
    const next = row.nextElementSibling;
    if (next && next.classList.contains('pool-expand-row')) {
        next.remove();
        return;
    }
    const ma = _poolData[sid];
    if (!ma) {
        // Data not yet loaded – show placeholder then fill in
        const tr = document.createElement('tr');
        tr.className = 'pool-expand-row';
        tr.innerHTML = `<td colspan="6" style="padding:.4rem .8rem;color:#888"><em>Pobieranie puli…</em></td>`;
        row.after(tr);
        _fetchPoolData().then(() => {
            tr.remove();
            const ma2 = _poolData[sid];
            if (ma2) _insertPoolRow(row, ma2);
        });
        return;
    }
    _insertPoolRow(row, ma);
}

function _insertPoolRow(afterRow, ma) {
    const server     = _poolServer || (_settings && _settings.server) || '';
    const candidates = ma.candidates || [];
    const tr         = document.createElement('tr');
    tr.className = 'pool-expand-row';

    if (!candidates.length) {
        tr.innerHTML = `<td colspan="6" style="padding:.4rem .8rem;color:#e06060;font-style:italic">Brak wolnych wiosek w puli.</td>`;
        afterRow.after(tr);
        return;
    }

    const rows = candidates.map(c => {
        const gameLink = (c.from_id && c.target_id && server)
            ? `<a href="https://pl${server}.plemiona.pl/game.php?village=${escHtml(c.from_id)}&screen=place&target=${escHtml(c.target_id)}" target="_blank" style="font-size:.75rem;opacity:.6;margin-left:.3rem">🔗</a>`
            : '';
        const resource = ma.type === 'SZLACHCIC'
            ? `🏛 ${c.nobles} szlach.`
            : `⚔ ${c.off.toLocaleString()} OFF`;
        return `<tr class="pool-candidate-row">
            <td style="padding:.25rem .4rem"><code>${escHtml(c.coord)}</code>${gameLink}</td>
            <td style="padding:.25rem .4rem;color:#aaa;font-size:.82rem">${escHtml(c.player)}</td>
            <td style="padding:.25rem .4rem;color:#888;font-size:.8rem">${resource}</td>
            <td style="padding:.25rem .4rem;color:#888;font-size:.8rem">${c.dist} pol</td>
            <td style="padding:.25rem .4rem">
                <button class="btn btn-sm btn-success candidate-pick-btn"
                    data-coord="${escHtml(c.coord)}"
                    data-target="${escHtml(ma.target)}"
                    data-type="${escHtml(ma.type)}"
                    data-arrival-dt="${escHtml(ma.arrival_dt || '')}">Wybierz</button>
            </td>
        </tr>`;
    }).join('');

    tr.innerHTML = `<td colspan="6" style="padding:.4rem .6rem;background:rgba(0,0,0,.25)">
        <div style="font-size:.78rem;color:#aaa;margin-bottom:.3rem;font-weight:600">
            Dostępna pula – ${candidates.length} wiosek (typ: ${escHtml(ma.type)}):
        </div>
        <table style="width:100%;font-size:.82rem;border-collapse:collapse">
            <thead><tr>
                <th style="text-align:left;padding:.2rem .4rem;color:#666">Wioska</th>
                <th style="text-align:left;padding:.2rem .4rem;color:#666">Gracz</th>
                <th style="text-align:left;padding:.2rem .4rem;color:#666">Siły</th>
                <th style="text-align:left;padding:.2rem .4rem;color:#666">Odległość</th>
                <th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </td>`;
    afterRow.after(tr);

    tr.querySelectorAll('.candidate-pick-btn').forEach(btn => {
        btn.addEventListener('click', () =>
            _pickReplacement(btn.dataset.coord, btn.dataset.target, btn.dataset.type, btn.dataset.arrivalDt)
        );
    });
}

async function _pickReplacement(coord, target, type, arrivalDt) {
    const modal    = document.getElementById('replacement-msg-modal');
    const playerEl = document.getElementById('replacement-msg-player');
    const bbcodeEl = document.getElementById('replacement-msg-bbcode');
    const mailBtn  = document.getElementById('btn-replacement-msg-mail');
    const saveBtn  = document.getElementById('btn-save-replacement-to-plan');

    playerEl.textContent = '…';
    bbcodeEl.value = '';
    mailBtn.style.display = 'none';
    saveBtn.style.display = 'none';
    // store context on button for the save handler
    saveBtn.dataset.coord     = coord;
    saveBtn.dataset.target    = target;
    saveBtn.dataset.type      = type;
    saveBtn.dataset.arrivalDt = arrivalDt || '';
    saveBtn.dataset.saved     = '';
    show('replacement-msg-modal');

    try {
        const payload = { replacement_coord: coord, target, type, arrival_dt: arrivalDt };
        if (_currentAssignments.length) payload.assignments = _currentAssignments;
        const res  = await fetch('/api/attack-status/replacement-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
            playerEl.textContent = 'Błąd';
            bbcodeEl.value = data.error || 'Nieznany błąd';
            return;
        }
        playerEl.textContent = data.player;
        bbcodeEl.value       = data.message;
        if (data.mail_link) {
            mailBtn.dataset.link    = data.mail_link;
            mailBtn.dataset.message = data.message;
            mailBtn.style.display   = '';
        }
        saveBtn.style.display = '';
    } catch (err) {
        playerEl.textContent = 'Błąd';
        bbcodeEl.value = err.message;
    }
}

function _updateCoverage() {
    const missedCount = Object.values(_statusMap).filter(v => v === 'missed').length;
    if (missedCount > 0) {
        show('coverage-card');
        _generateCoveragePost();
        _fetchPoolData();
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

// ── Replacement message modal ─────────────────────────────────────────────────
document.getElementById('btn-close-replacement-modal').addEventListener('click', () => hide('replacement-msg-modal'));
document.getElementById('replacement-msg-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hide('replacement-msg-modal');
});
document.getElementById('btn-copy-replacement-msg').addEventListener('click', () => {
    const text = document.getElementById('replacement-msg-bbcode').value;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('btn-copy-replacement-msg');
        const orig = btn.textContent;
        btn.textContent = '✓ Skopiowano!';
        setTimeout(() => btn.textContent = orig, 2000);
    });
});
document.getElementById('btn-replacement-msg-mail').addEventListener('click', function () {
    window.open(this.dataset.link, '_blank', 'noopener');
    navigator.clipboard.writeText(this.dataset.message || '').then(() => {
        const orig = this.textContent;
        this.textContent = '✓ Skopiowano treść!';
        setTimeout(() => this.textContent = orig, 3000);
    });
});
document.getElementById('btn-save-replacement-to-plan').addEventListener('click', async function () {
    if (this.dataset.saved) return;
    const payload = {
        replacement_coord: this.dataset.coord,
        target:            this.dataset.target,
        type:              this.dataset.type,
        arrival_dt:        this.dataset.arrivalDt || '',
    };
    try {
        const res = await fetch('/api/attack-status/save-replacement', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (res.ok) {
            this.textContent = '✓ Zapisano!';
            this.disabled    = true;
            this.dataset.saved = '1';
            // Reload the status tracker so the new send appears
            await loadAttackStatus();
        } else {
            this.textContent = data.error || 'Błąd zapisu';
        }
    } catch {
        this.textContent = 'Błąd połączenia';
    }
});
