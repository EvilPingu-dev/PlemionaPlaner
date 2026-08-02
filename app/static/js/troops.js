/* ── WOJSKA ─────────────────────────────────────────────────────────────── */

// Player name lookup: { "x|y": "PlayerName" } — populated by renderPlayers
let _playerByCoord = {};

// Cached last troop list so players tab can refresh owner column
let _lastTroops = [];

// Whether the troops table is in manual-edit mode
let _troopsEditMode = false;

// Excluded from replacements: Set of "x|y" coords
let _excludedReplacements = new Set();

async function _loadExcluded() {
    try {
        const data = await fetch('/api/excluded-replacements').then(r => r.json());
        _excludedReplacements = new Set(Array.isArray(data) ? data : []);
    } catch {}
}

async function _toggleExcluded(coord) {
    try {
        const res  = await fetch('/api/excluded-replacements/toggle', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ coord }),
        });
        const data = await res.json();
        _excludedReplacements = new Set(data.excluded || []);
        renderTroops(_lastTroops);
    } catch {}
}

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
        await _loadExcluded();
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
    document.querySelector('#troops-table tbody').innerHTML = villages.map(v => {
        const excl = _excludedReplacements.has(v.coord);
        const cell = (val, field) => _troopsEditMode
            ? `<td><input class="troop-edit-input" type="number" min="0" data-coord="${v.coord}" data-field="${field}" value="${val}" style="width:5rem"></td>`
            : `<td class="${val > 0 ? '' : 'dim'}">${fmt(val)}</td>`;
        return `<tr class="${excl ? 'row-excluded' : ''}">
            <td><code>${v.coord}</code></td>
            <td class="dim">${_playerByCoord[v.coord] || ''}</td>
            <td>${fmt(v.pop)}</td>
            ${cell(v.off,    'off')}
            ${cell(v.nobles, 'nobles')}
            ${cell(v.cats,   'cats')}
            ${cell(v.rams,   'rams')}
            <td><button class="toggle-btn ${excl ? 'disabled' : 'enabled'} excl-btn" data-coord="${v.coord}"
                title="${excl ? 'Wykluczona z wymienników – kliknij aby przywrócić' : 'Kliknij aby wykluczyć z wymienników'}">
                ${excl ? '🚫 Wykluczona' : '✔ Aktywna'}</button></td>
        </tr>`;
    }).join('');

    document.querySelectorAll('.excl-btn').forEach(btn => {
        btn.addEventListener('click', () => _toggleExcluded(btn.dataset.coord));
    });

    const editBtn = document.getElementById('troops-edit-btn');
    const saveBtn = document.getElementById('troops-save-btn');
    if (editBtn) editBtn.textContent = _troopsEditMode ? '✕ Anuluj edycję' : '✏ Edytuj ręcznie';
    if (saveBtn) saveBtn.style.display = _troopsEditMode ? '' : 'none';

    show('troops-summary-card');
    show('troops-table-card');
}

function toggleTroopsEdit() {
    _troopsEditMode = !_troopsEditMode;
    renderTroops(_lastTroops);
}

async function saveTroopsEdits() {
    const inputs = document.querySelectorAll('.troop-edit-input');
    const byCoord = {};
    inputs.forEach(inp => {
        const coord = inp.dataset.coord;
        if (!byCoord[coord]) byCoord[coord] = { coord };
        byCoord[coord][inp.dataset.field] = parseInt(inp.value) || 0;
    });
    const patches = Object.values(byCoord);
    const status = document.getElementById('troops-status');
    setStatus(status, 'Zapisywanie…');
    try {
        const res  = await fetch('/api/troops/patch', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ patches }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, '✓ Zapisano.', 'ok');
        _troopsEditMode = false;
        renderTroops(data);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}
