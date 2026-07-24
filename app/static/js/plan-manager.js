/* ── Plan manager ────────────────────────────────────────────────────────── */

let _activePlanName = null;

async function savePlanSnapshot() {
    const nameInput = document.getElementById('plan-name-input');
    const name = nameInput.value.trim() || (_settings.action_name || 'Akcja');
    try {
        const res  = await fetch('/api/plans/save', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Błąd zapisu.'); return; }
        _activePlanName = data.name;
        document.getElementById('active-plan-name').textContent = data.name;
        nameInput.value = '';
    } catch { alert('Błąd połączenia.'); }
}

async function openPlanModal() {
    show('plan-modal');
    const container = document.getElementById('plan-list-container');
    container.innerHTML = 'Ładowanie…';
    try {
        const plans = await fetch('/api/plans').then(r => r.json());
        if (!plans.length) {
            container.innerHTML = '<p class="hint">Brak zapisanych akcji.</p>';
            return;
        }
        container.innerHTML = '<ul class="plan-list">' +
            plans.map(p => `
                <li class="plan-list-item">
                    <span class="plan-list-name">${p}</span>
                    <button class="btn btn-sm btn-primary" data-load="${p}">📂 Wczytaj</button>
                    <button class="btn btn-sm btn-danger"  data-del="${p}">🗑 Usuń</button>
                </li>`).join('') + '</ul>';

        container.querySelectorAll('[data-load]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await loadPlanSnapshot(btn.dataset.load);
                hide('plan-modal');
            });
        });
        container.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm(`Usuń akcję "${btn.dataset.del}"?`)) return;
                await fetch(`/api/plans/${encodeURIComponent(btn.dataset.del)}`, { method: 'DELETE' });
                openPlanModal();
            });
        });
    } catch { container.innerHTML = '<p class="hint err">Błąd ładowania.</p>'; }
}

async function loadPlanSnapshot(name) {
    try {
        const res  = await fetch('/api/plans/load', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) { alert(data.error || 'Błąd wczytania.'); return; }

        _activePlanName = data.name;
        document.getElementById('active-plan-name').textContent = data.name;
        if (data.troops?.length)     renderTroops(data.troops);
        if (data.targets?.length)    renderTargets(data.targets);
        if (data.player_map?.length) renderPlayers(data.player_map);
        if (data.settings)           { _settings = data.settings; applySettings(data.settings); }
        if (data.plan?.assignments?.length) renderPlan(data.plan);
    } catch { alert('Błąd połączenia.'); }
}
