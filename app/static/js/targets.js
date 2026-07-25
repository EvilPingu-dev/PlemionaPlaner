/* ── CELE ───────────────────────────────────────────────────────────────── */

async function saveTargets() {
    const raw    = document.getElementById('targets-input').value.trim();
    const status = document.getElementById('targets-status');
    if (!raw) { setStatus(status, 'Brak danych!', 'err'); return; }
    setStatus(status, 'Zapisywanie…');
    try {
        const res  = await fetch('/api/targets', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ raw }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ Zapisano ${data.count} celów.`, 'ok');
        renderTargets(data.targets);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function renderTargets(targets) {
    document.getElementById('targets-count').textContent = targets.length;
    document.querySelector('#targets-table tbody').innerHTML = targets.map(t => `
        <tr>
            <td><code>${t.coord}</code></td>
            <td>${t.offs_needed}</td>
            <td>${t.nobles_needed}</td>
            <td>${t.arrival_slot ?? 1}</td>
        </tr>`).join('');
    show('targets-table-card');
}


/* ── Fejki ──────────────────────────────────────────────────────────────── */

async function saveFejki() {
    const raw    = document.getElementById('fejki-input').value.trim();
    const status = document.getElementById('fejki-status');
    if (!raw) { setStatus(status, 'Brak danych!', 'err'); return; }
    setStatus(status, 'Zapisywanie…');
    try {
        const res  = await fetch('/api/fake-targets', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ raw }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ Zapisano ${data.count} fejków.`, 'ok');
        renderFejki(data.items);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function renderFejki(items) {
    document.getElementById('fejki-count').textContent = items.length;
    document.querySelector('#fejki-table tbody').innerHTML = items.map(it => `
        <tr>
            <td><code>${it.coord}</code></td>
            <td>${it.fakes}</td>
            <td>${it.fake_nobles}</td>
        </tr>`).join('');
    show('fejki-table-card');
}


/* ── Burzaki ────────────────────────────────────────────────────────────── */

async function saveBurzaki() {
    const raw    = document.getElementById('burzaki-input').value.trim();
    const status = document.getElementById('burzaki-status');
    if (!raw) { setStatus(status, 'Brak danych!', 'err'); return; }
    setStatus(status, 'Zapisywanie…');
    try {
        const res  = await fetch('/api/burst-targets', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ raw }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ Zapisano ${data.count} burzaków.`, 'ok');
        renderBurzaki(data.items);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function renderBurzaki(items) {
    const BUILDINGS = {
        '0': 'dowolny',
        '1': 'Ratusz', '2': 'Kuźnia', '3': 'Zagroda',
        '4': 'Tartak', '5': 'Cegielnia', '6': 'Huta Żelaza',
    };
    document.getElementById('burzaki-count').textContent = items.length;
    document.querySelector('#burzaki-table tbody').innerHTML = items.map(it => {
        const btype = String(it.building_type ?? '');
        const bname = it.building || BUILDINGS[btype] || btype || '';
        return `<tr>
            <td><code>${it.coord}</code></td>
            <td>${it.attacks ?? '<span class="dim">–</span>'}</td>
            <td>${bname || '<span class="dim">–</span>'}</td>
        </tr>`;
    }).join('');
    show('burzaki-table-card');
}
