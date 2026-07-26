/* ── Forum BBCode ────────────────────────────────────────────────────────── */

async function generateForum() {
    const status = document.getElementById('forum-status');
    setStatus(status, 'Generowanie…');
    try {
        const res  = await fetch('/api/forum-overview', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, '✓ Gotowe!', 'ok');
        document.getElementById('forum-bbcode').value = data.bbcode;
        show('forum-preview-card');
        show('btn-copy-forum');
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}


/* ── Timeline ───────────────────────────────────────────────────────────── */

async function generateTimeline() {
    const status = document.getElementById('timeline-status');
    setStatus(status, 'Generowanie…');
    const gapMs  = _gapFieldsToMs('plan');
    const payload = {
        assignments: _currentAssignments.map((a, aIdx) => {
            const dtInput = document.querySelector(`.asgn-off-dt[data-aidx="${aIdx}"]`);
            const offDt = dtInput ? dtInput.value : (a.arrival_dt || '');
            let nobleDt = offDt;
            if (offDt && gapMs > 0)
                nobleDt = _toLocalISOString(new Date(new Date(offDt).getTime() + gapMs));
            return { ...a, arrival_dt: offDt || a.arrival_dt, noble_arrival_dt: nobleDt || a.noble_arrival_dt };
        }),
    };
    try {
        const res  = await fetch('/api/timeline', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ ${data.sends.length} wysyłek.`, 'ok');
        _renderTimeline(data);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function _renderTimeline({ sends, by_player }) {
    const now = Date.now();
    const players = Object.keys(by_player);
    const conflicts = sends.filter(s => s.conflict).length;
    document.getElementById('timeline-summary').innerHTML =
        summaryItem(sends.length,   'Wysyłek łącznie') +
        summaryItem(players.length, 'Graczy') +
        summaryItem(conflicts, conflicts > 0 ? '⚠ Konflikty' : 'Konflikty');
    show('timeline-summary-card');

    document.getElementById('timeline-output').innerHTML = players.map(player => {
        const psends = by_player[player];
        const rows = psends.map(s => {
            const sendDt  = new Date(s.send_dt);
            const diffMs  = sendDt.getTime() - now;
            const diffMin = diffMs / 60000;
            let cdClass, cdText;
            if (diffMs < 0) { cdClass = 'past'; cdText = `${Math.round(Math.abs(diffMin))}min temu`; }
            else if (diffMin < 12*60) { cdClass = 'warn'; cdText = `za ${Math.round(diffMin)}min`; }
            else { cdClass = 'ok'; cdText = `za ${Math.floor(diffMin/60)}h ${Math.round(diffMin%60)}min`; }
            const cd  = `<span class="send-countdown ${cdClass}">${cdText}</span>`;
            const cls = s.conflict ? ' style="background:rgba(120,20,20,.3)"' : '';
            const typeColor = s.type === 'OFF' ? '#cc8844' : s.type === 'SZLACHCIC' ? '#4488cc' : '#888';
            return `<tr${cls}>
                <td><strong>${sendDt.toLocaleString('pl-PL', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</strong> ${cd}</td>
                <td style="color:${typeColor};font-weight:700">${s.type}</td>
                <td><code>${s.from_coord}</code></td>
                <td><code>${s.target}</code></td>
                <td>${s.dist} pol</td>
                <td>${fmtMinutes(s.travel_min)}${s.is_night ? ' 🌙' : ''}</td>
                ${s.conflict ? '<td style="color:#e06060">⚠ KONFLIKT</td>' : '<td></td>'}
            </tr>`;
        }).join('');
        return `<div class="card">
            <h2 style="margin-bottom:8px">👤 ${player} <span style="color:var(--text-dim);font-weight:400;font-size:.85rem">(${psends.length} wysyłek)</span></h2>
            <div class="table-wrap"><table>
                <thead><tr><th>Wysyłka</th><th>Typ</th><th>Z wioski</th><th>Cel</th><th>Odl.</th><th>Podróż</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table></div>
        </div>`;
    }).join('');
}


/* ── Validate plan ──────────────────────────────────────────────────────── */

async function validatePlan() {
    const status = document.getElementById('validate-status');
    setStatus(status, 'Sprawdzanie…');
    const gapMs = _gapFieldsToMs('plan');
    const payload = {
        assignments: _currentAssignments.map((a, aIdx) => {
            const dtInput = document.querySelector(`.asgn-off-dt[data-aidx="${aIdx}"]`);
            const offDt = dtInput ? dtInput.value : (a.arrival_dt || '');
            let nobleDt = offDt;
            if (offDt && gapMs > 0)
                nobleDt = _toLocalISOString(new Date(new Date(offDt).getTime() + gapMs));
            return { ...a, arrival_dt: offDt || a.arrival_dt, noble_arrival_dt: nobleDt || a.noble_arrival_dt };
        }),
    };
    try {
        const res  = await fetch('/api/validate', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd', 'err'); return; }
        const out = document.getElementById('validate-output');
        if (data.ok) {
            setStatus(status, '✓ Brak problemów!', 'ok');
            out.innerHTML = '<p style="color:#4ec97a;font-weight:600">✓ Wszystko OK</p>';
        } else {
            setStatus(status, `⚠ ${data.issues.length} problemów`, 'err');
            out.innerHTML = data.issues.map(i => {
                const col  = i.severity === 'error' ? '#e06060' : '#e0a030';
                const icon = i.severity === 'error' ? '✕' : '⚠';
                return `<div style="padding:6px 10px;margin-bottom:6px;border-left:3px solid ${col};background:rgba(80,20,20,.2)">
                    <span style="color:${col};font-weight:700">${icon} [${i.target}]</span> ${i.message}
                </div>`;
            }).join('');
        }
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}


/* ── Per-player summary ─────────────────────────────────────────────────── */

function generatePlayerSummary() {
    if (!_currentAssignments.length) {
        document.getElementById('player-summary-output').innerHTML = '<p class="hint">Brak rozpiski – rozpisz akcję najpierw.</p>';
        return;
    }
    const counts = {};
    for (const a of _currentAssignments) {
        for (const coord of (a.offs || [])) {
            const p = _playerByCoord[coord] || '?';
            counts[p] = counts[p] || { off: 0, noble: 0, total: 0 };
            counts[p].off++; counts[p].total++;
        }
        for (const coord of (a.nobles || [])) {
            const p = _playerByCoord[coord] || '?';
            counts[p] = counts[p] || { off: 0, noble: 0, total: 0 };
            counts[p].noble++; counts[p].total++;
        }
    }
    const rows = Object.entries(counts)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([player, c]) => `<tr><td><strong>${player}</strong></td><td>${c.off}</td><td>${c.noble}</td><td><strong>${c.total}</strong></td></tr>`)
        .join('');
    document.getElementById('player-summary-output').innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr><th>Gracz</th><th>OFF</th><th>Szlachcice</th><th>Łącznie</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
}


/* ── CSV export ──────────────────────────────────────────────────────────── */

async function exportCsv() {
    const gapMs   = _gapFieldsToMs('plan');
    const payload = {
        assignments: _currentAssignments.map((a, aIdx) => {
            const dtInput = document.querySelector(`.asgn-off-dt[data-aidx="${aIdx}"]`);
            const offDt   = dtInput ? dtInput.value : (a.arrival_dt || '');
            let nobleDt   = offDt;
            if (offDt && gapMs > 0)
                nobleDt = _toLocalISOString(new Date(new Date(offDt).getTime() + gapMs));
            return { ...a, arrival_dt: offDt || a.arrival_dt, noble_arrival_dt: nobleDt || a.noble_arrival_dt };
        }),
    };
    const res = await fetch('/api/export/csv', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!res.ok) { alert('Błąd eksportu'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'plan.csv'; a.click();
    URL.revokeObjectURL(url);
}


/* ── Forum per-player export ─────────────────────────────────────────────── */

async function exportForumPlayers(targetEl, statusEl) {
    if (statusEl) setStatus(statusEl, 'Generowanie…');
    const gapMs   = _gapFieldsToMs('plan');
    const payload = {
        assignments: _currentAssignments.map((a, aIdx) => {
            const dtInput = document.querySelector(`.asgn-off-dt[data-aidx="${aIdx}"]`);
            const offDt   = dtInput ? dtInput.value : (a.arrival_dt || '');
            let nobleDt   = offDt;
            if (offDt && gapMs > 0)
                nobleDt = _toLocalISOString(new Date(new Date(offDt).getTime() + gapMs));
            return { ...a, arrival_dt: offDt || a.arrival_dt, noble_arrival_dt: nobleDt || a.noble_arrival_dt };
        }),
    };
    try {
        const res  = await fetch('/api/export/forum-players', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
        const data = await res.json();
        if (!res.ok) { if (statusEl) setStatus(statusEl, data.error || 'Błąd', 'err'); return; }
        if (statusEl) setStatus(statusEl, `✓ ${data.players.length} graczy`, 'ok');
        targetEl.innerHTML = data.players.map(p => `
            <div style="margin-bottom:14px">
                <div style="font-weight:700;color:var(--gold);margin-bottom:4px">👤 ${p.player}</div>
                <textarea rows="8" readonly style="font-size:.75rem">${p.bbcode.replace(/</g,'&lt;')}</textarea>
            </div>`).join('');
        const fpo = document.getElementById('forum-players-output');
        if (fpo) fpo.innerHTML = targetEl.innerHTML;
        show('forum-players-card');
    } catch { if (statusEl) setStatus(statusEl, 'Błąd połączenia', 'err'); }
}


/* ── World speed auto-detect ─────────────────────────────────────────────── */

async function fetchWorldSpeeds() {
    const status = document.getElementById('speeds-status');
    const out    = document.getElementById('speeds-output');
    setStatus(status, 'Pobieranie…');
    try {
        const res  = await fetch('/api/world-config');
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd', 'err'); return; }
        out.innerHTML = Object.entries(data.speeds).map(([k,v]) =>
            `<span style="background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:2px 8px;font-size:.78rem;margin:2px">${k}: ${v}</span>`
        ).join(' ');
        if (data.off_speed || data.noble_speed) {
            setStatus(status, `Topornik=${data.off_speed} min/pol | Szlachcic=${data.noble_speed} min/pol`, 'ok');
            const applyBtn = document.createElement('button');
            applyBtn.className = 'btn btn-sm btn-primary';
            applyBtn.style.marginLeft = '10px';
            applyBtn.textContent = 'Zastosuj w Ustawieniach';
            applyBtn.onclick = () => {
                document.getElementById('s-off-speed').value   = data.off_speed;
                document.getElementById('s-noble-speed').value = data.noble_speed;
                applyBtn.textContent = '✓ Zastosowano';
            };
            status.appendChild(applyBtn);
        }
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}


/* ── Return calculator ───────────────────────────────────────────────────── */

function calcReturns() {
    const out = document.getElementById('returns-output');
    if (!_currentAssignments.length) { out.innerHTML = '<p class="hint">Brak rozpiski.</p>'; return; }
    const offSpeed   = parseFloat(_settings.off_speed   || 18);
    const nobleSpeed = parseFloat(_settings.noble_speed || 35);
    const gapMs      = _gapFieldsToMs('plan');

    const returns = [];
    _currentAssignments.forEach((a, aIdx) => {
        const dtInput = document.querySelector(`.asgn-off-dt[data-aidx="${aIdx}"]`);
        const offDt   = dtInput ? dtInput.value : (a.arrival_dt || '');
        let nobleDt   = offDt;
        if (offDt && gapMs > 0)
            nobleDt = _toLocalISOString(new Date(new Date(offDt).getTime() + gapMs));

        for (const d of (a.offs_detail || [])) {
            if (!d.dist || !offDt) continue;
            const sendMs   = new Date(offDt).getTime() - d.dist * offSpeed * 60000;
            returns.push({ coord: d.coord, target: a.target, type: 'OFF', return_dt: new Date(sendMs + 2 * d.dist * offSpeed * 60000).toISOString() });
        }
        for (const d of (a.nobles_detail || [])) {
            if (!d.dist || !nobleDt) continue;
            const sendMs   = new Date(nobleDt).getTime() - d.dist * nobleSpeed * 60000;
            returns.push({ coord: d.coord, target: a.target, type: 'SZL', return_dt: new Date(sendMs + 2 * d.dist * nobleSpeed * 60000).toISOString() });
        }
    });

    returns.sort((a, b) => a.return_dt.localeCompare(b.return_dt));
    const rows = returns.map(r => {
        const dt      = new Date(r.return_dt);
        const diffMs  = dt.getTime() - Date.now();
        const diffMin = diffMs / 60000;
        const cdClass = diffMs < 0 ? 'past' : diffMin < 12*60 ? 'warn' : 'ok';
        const cdText  = diffMs < 0 ? `${Math.round(Math.abs(diffMin))}min temu`
                      : diffMin < 60 ? `za ${Math.round(diffMin)}min`
                      : `za ${Math.floor(diffMin/60)}h ${Math.round(diffMin%60)}min`;
        const typeColor = r.type === 'OFF' ? '#cc8844' : '#4488cc';
        return `<tr>
            <td><code>${r.coord}</code></td>
            <td style="color:${typeColor}">${r.type}</td>
            <td><code>${r.target}</code></td>
            <td>${dt.toLocaleString('pl-PL',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})} <span class="send-countdown ${cdClass}">${cdText}</span></td>
        </tr>`;
    }).join('');
    out.innerHTML = `<div class="table-wrap"><table>
        <thead><tr><th>Wioska</th><th>Typ</th><th>Cel</th><th>Powrót</th></tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
}


/* ── Backup / Restore ────────────────────────────────────────────────────── */

document.getElementById('restore-file').addEventListener('change', async function() {
    const status = document.getElementById('restore-status');
    const file = this.files[0];
    if (!file) return;
    setStatus(status, 'Przywracanie…');
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res  = await fetch('/api/restore', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd', 'err'); return; }
        setStatus(status, `✓ Przywrócono ${data.restored} plików. Odśwież stronę.`, 'ok');
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
    this.value = '';
});
