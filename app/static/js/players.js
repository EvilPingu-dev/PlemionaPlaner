/* ── GRACZE ─────────────────────────────────────────────────────────────── */

let _playerNames = [];

async function fetchPlayersFromTW() {
    const status = document.getElementById('fetch-players-status');
    setStatus(status, '🌐 Pobieranie z TW…');
    try {
        const res  = await fetch('/api/fetch-player-map', { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ Pobrano ${data.count} graczy z TW.`, 'ok');
        renderPlayers(data.player_map);
        document.getElementById('players-input').value = buildPlayersText(data.player_map);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

async function savePlayers() {
    const raw    = document.getElementById('players-input').value.trim();
    const status = document.getElementById('players-status');
    if (!raw) { setStatus(status, 'Brak danych!', 'err'); return; }
    setStatus(status, 'Zapisywanie…');
    try {
        const res  = await fetch('/api/player-map', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ raw }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ Zapisano ${data.count} graczy.`, 'ok');
        renderPlayers(data.player_map);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function renderPlayers(playerMap) {
    document.getElementById('players-count').textContent = playerMap.length;
    document.querySelector('#players-table tbody').innerHTML = playerMap.map(pm => {
        const enabled  = pm.enabled !== false;
        const showAll  = !!pm.show_all_attacks;
        const toggleBtn = `<button class="toggle-btn ${enabled ? 'enabled' : 'disabled'}" data-player="${escHtml(pm.player)}"
            title="${enabled ? 'Kliknij aby wyłączyć' : 'Kliknij aby włączyć'}">
            ${enabled ? '🟢 Włączony' : '🔴 Wyłączony'}</button>`;
        const showAllChk = `<label class="show-all-label" title="Gracz widzi ataki innych na te same cele">
            <input type="checkbox" class="show-all-chk" data-player="${escHtml(pm.player)}" ${showAll ? 'checked' : ''}>
            ${showAll ? '👁 Widzi' : 'Nie'}
        </label>`;
        return `<tr class="${enabled ? '' : 'row-disabled'}">
            <td>${toggleBtn}</td>
            <td><strong>${pm.player}</strong></td>
            <td>${showAllChk}</td>
            <td>${pm.villages.length}</td>
            <td class="coords-cell">${pm.villages.map(c => `<span class="coord-tag">${c}</span>`).join(' ')}</td>
        </tr>`;
    }).join('');

    _playerByCoord = {};
    _playerNames   = playerMap.map(pm => pm.player);
    for (const pm of playerMap) {
        for (const coord of pm.villages) {
            _playerByCoord[coord.trim()] = pm.player;
        }
    }
    _populateConflictSelects();

    if (_lastTroops.length) renderTroops(_lastTroops);

    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => togglePlayer(btn.dataset.player));
    });
    document.querySelectorAll('.show-all-chk').forEach(chk => {
        chk.addEventListener('change', () => toggleShowAll(chk.dataset.player));
    });

    show('players-table-card');
}

async function toggleShowAll(playerName) {
    try {
        const res  = await fetch('/api/player-map/toggle-show-all', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player: playerName }),
        });
        if (res.ok) renderPlayers((await res.json()).player_map);
    } catch {}
}

async function togglePlayer(playerName) {
    try {
        const res  = await fetch('/api/player-map/toggle', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ player: playerName }),
        });
        const data = await res.json();
        if (res.ok) renderPlayers(data.player_map);
    } catch {}
}

function buildPlayersText(playerMap) {
    return playerMap.map(pm => `${pm.player}: ${pm.villages.join(', ')}`).join('\n');
}


/* ── KONFLIKTY ──────────────────────────────────────────────────────────── */

let _conflicts = [];

async function loadConflicts() {
    try {
        const res  = await fetch('/api/conflicts');
        _conflicts = await res.json();
        renderConflicts();
    } catch {}
}

function _populateConflictSelects() {
    ['conflict-player-a', 'conflict-player-b'].forEach(id => {
        const sel = document.getElementById(id);
        const cur = sel.value;
        sel.innerHTML = _playerNames.map(n => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
        if (_playerNames.includes(cur)) sel.value = cur;
    });
}

function renderConflicts() {
    const container = document.getElementById('conflicts-list');
    if (!_conflicts.length) {
        container.innerHTML = '<p class="hint" style="margin:0 0 6px">Brak par – użyj listy poniżej, aby dodać.</p>';
    } else {
        container.innerHTML = '<ul class="conflict-list">' +
            _conflicts.map((pair, i) => `
                <li class="conflict-item">
                    <span class="conflict-names"><strong>${escHtml(pair[0])}</strong> ↔ <strong>${escHtml(pair[1])}</strong></span>
                    <button class="btn btn-sm btn-danger" data-cidx="${i}" title="Usuń parę">✕ Usuń</button>
                </li>`).join('') +
            '</ul>';
        container.querySelectorAll('[data-cidx]').forEach(btn => {
            btn.addEventListener('click', async () => {
                _conflicts.splice(parseInt(btn.dataset.cidx), 1);
                await saveConflicts();
            });
        });
    }
}

async function saveConflicts() {
    try {
        const res  = await fetch('/api/conflicts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(_conflicts),
        });
        _conflicts = await res.json();
        renderConflicts();
        setStatus(document.getElementById('conflicts-status'), `✓ Zapisano ${_conflicts.length} par.`, 'ok');
    } catch {
        setStatus(document.getElementById('conflicts-status'), 'Błąd połączenia', 'err');
    }
}

document.getElementById('btn-add-conflict').addEventListener('click', async () => {
    const a = document.getElementById('conflict-player-a').value.trim();
    const b = document.getElementById('conflict-player-b').value.trim();
    const status = document.getElementById('conflicts-status');
    if (!a || !b) { setStatus(status, 'Wybierz obu graczy.', 'err'); return; }
    if (a === b)  { setStatus(status, 'Gracze muszą być różni.', 'err'); return; }
    if (_conflicts.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a))) {
        setStatus(status, 'Ta para już istnieje.', 'err'); return;
    }
    _conflicts.push([a, b]);
    await saveConflicts();
});
