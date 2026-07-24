/* ── WOJSKA ─────────────────────────────────────────────────────────────── */

// Player name lookup: { "x|y": "PlayerName" } — populated by renderPlayers
let _playerByCoord = {};

// Cached last troop list so players tab can refresh owner column
let _lastTroops = [];

async function importTroops() {
    const raw    = document.getElementById('troops-input').value.trim();
    const status = document.getElementById('troops-status');
    if (!raw) { setStatus(status, 'Brak danych!', 'err'); return; }
    setStatus(status, 'Importowanie…');
    try {
        const res  = await fetch('/api/troops', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ raw }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ Importowano ${data.count} wiosek.`, 'ok');
        renderTroops(data.villages);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function renderTroops(villages) {
    _lastTroops = villages;
    const offVills   = villages.filter(v => v.off > 0).length;
    const totalOff   = villages.reduce((s, v) => s + v.off,    0);
    const totalNoble = villages.reduce((s, v) => s + v.nobles, 0);
    const totalCats  = villages.reduce((s, v) => s + v.cats,   0);

    document.getElementById('troops-summary').innerHTML =
        summaryItem(villages.length, 'Wioski')       +
        summaryItem(offVills,        'Wioski offowe') +
        summaryItem(totalOff,        'Offy razem')    +
        summaryItem(totalNoble,      'Szlachcice')    +
        summaryItem(totalCats,       'Katapulty');

    document.getElementById('troops-count').textContent = villages.length;
    document.querySelector('#troops-table tbody').innerHTML = villages.map(v => `
        <tr>
            <td><code>${v.coord}</code></td>
            <td class="dim">${_playerByCoord[v.coord] || ''}</td>
            <td>${fmt(v.pop)}</td>
            <td class="${v.off    > 0 ? '' : 'dim'}">${fmt(v.off)}</td>
            <td class="${v.nobles > 0 ? '' : 'dim'}">${v.nobles}</td>
            <td>${v.cats}</td>
            <td>${v.rams}</td>
        </tr>`).join('');

    show('troops-summary-card');
    show('troops-table-card');
}
