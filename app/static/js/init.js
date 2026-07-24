/* ── Init ───────────────────────────────────────────────────────────────── */

// Subtab switching (Cele tab)
document.querySelectorAll('.subtab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const key = btn.dataset.subtab;
        document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.subtab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('subtab-' + key).classList.add('active');
    });
});

(async () => {
    const [troops, targets, playerMap, settings, conflicts, fejki, burzaki] = await Promise.all([
        fetch('/api/troops').then(r => r.json()).catch(() => []),
        fetch('/api/targets').then(r => r.json()).catch(() => []),
        fetch('/api/player-map').then(r => r.json()).catch(() => []),
        fetch('/api/settings').then(r => r.json()).catch(() => ({})),
        fetch('/api/conflicts').then(r => r.json()).catch(() => []),
        fetch('/api/fake-targets').then(r => r.json()).catch(() => []),
        fetch('/api/burst-targets').then(r => r.json()).catch(() => []),
    ]);

    _settings = settings;
    applySettings(settings);

    document.getElementById('targets-input').value = '';
    document.getElementById('fejki-input').value   = '';
    document.getElementById('burzaki-input').value = '';

    if (playerMap.length) {
        renderPlayers(playerMap);
        document.getElementById('players-input').value = buildPlayersText(playerMap);
    }
    if (troops.length) renderTroops(troops);
    if (fejki.length) {
        renderFejki(fejki);
        document.getElementById('fejki-input').value = fejki
            .map(it => `${it.coord}:${it.fakes}:${it.fake_nobles}`).join('\n');
    }
    if (burzaki.length) {
        renderBurzaki(burzaki);
        document.getElementById('burzaki-input').value = burzaki
            .map(it => `${it.coord}:${it.attacks ?? 0}:${it.building_type ?? ''}`).join('\n');
    }

    _conflicts = Array.isArray(conflicts) ? conflicts : [];
    renderConflicts();
})();


/* ── Wire buttons ───────────────────────────────────────────────────────── */

document.getElementById('btn-import-troops').addEventListener('click', importTroops);
document.getElementById('btn-save-targets').addEventListener('click', saveTargets);
document.getElementById('btn-save-fejki').addEventListener('click', saveFejki);
document.getElementById('btn-save-burzaki').addEventListener('click', saveBurzaki);
document.getElementById('btn-fetch-players').addEventListener('click', fetchPlayersFromTW);
document.getElementById('btn-save-players').addEventListener('click', savePlayers);
document.getElementById('btn-run-plan').addEventListener('click', runPlan);
document.getElementById('btn-gen-messages').addEventListener('click', generateMessages);
document.querySelectorAll('.btn-save-all').forEach(btn => btn.addEventListener('click', saveSettings));
document.getElementById('btn-gen-forum').addEventListener('click', generateForum);

document.getElementById('btn-gen-timeline').addEventListener('click', generateTimeline);
document.getElementById('btn-validate').addEventListener('click', validatePlan);
document.getElementById('btn-player-summary').addEventListener('click', generatePlayerSummary);
document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
document.getElementById('btn-forum-players').addEventListener('click', () =>
    exportForumPlayers(
        document.getElementById('tools-forum-players-output'),
        document.getElementById('forum-players-status')
    )
);
document.getElementById('btn-fetch-speeds').addEventListener('click', fetchWorldSpeeds);
document.getElementById('btn-calc-returns').addEventListener('click', calcReturns);

// Timing toolbar
document.getElementById('btn-timing-apply-all').addEventListener('click', () => {
    const dt = document.getElementById('timing-bulk-dt').value;
    if (!dt) return;
    document.querySelectorAll('.asgn-off-dt').forEach(inp => { inp.value = dt.slice(0, 19); });
    _updateNobleChips();
});
document.getElementById('plan-gap-min').addEventListener('input', _updateNobleChips);
document.getElementById('plan-gap-sec').addEventListener('input', _updateNobleChips);
document.getElementById('plan-gap-ms').addEventListener('input',  _updateNobleChips);
document.getElementById('btn-apply-gap').addEventListener('click', () => {
    const gapMs = _gapFieldsToMs('plan');
    _currentAssignments.forEach((a, aIdx) => {
        const dtInput = document.querySelector(`.asgn-off-dt[data-aidx="${aIdx}"]`);
        const offDt   = dtInput ? dtInput.value : (a.arrival_dt || '');
        if (offDt && gapMs > 0)
            a.noble_arrival_dt = new Date(new Date(offDt).getTime() + gapMs).toISOString().slice(0, 23);
        else
            a.noble_arrival_dt = offDt || a.arrival_dt;
        a.arrival_dt = offDt || a.arrival_dt;
    });
    _updateNobleChips();
});
document.getElementById('btn-copy-forum').addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('forum-bbcode').value).then(() => {
        const btn = document.getElementById('btn-copy-forum');
        const orig = btn.textContent;
        btn.textContent = '✓ Skopiowano!';
        setTimeout(() => btn.textContent = orig, 2000);
    });
});

// Delegate: update noble chip when individual OFF datetime changes
document.getElementById('plan-assignments').addEventListener('change', e => {
    if (e.target.classList.contains('asgn-off-dt')) _updateNobleChips();
});

// Plan edit mode
document.getElementById('btn-edit-plan').addEventListener('click', () => {
    _planEditMode = true;
    _renderAssignments(_currentAssignments, true);
    hide('btn-edit-plan');
    show('btn-save-plan-edits');
    show('btn-cancel-plan-edits');
});
document.getElementById('btn-save-plan-edits').addEventListener('click', async () => {
    await fetch('/api/plan/override', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ assignments: _currentAssignments }),
    });
    _planEditMode = false;
    _renderAssignments(_currentAssignments, false);
    hide('btn-save-plan-edits');
    hide('btn-cancel-plan-edits');
    show('btn-edit-plan');
});
document.getElementById('btn-cancel-plan-edits').addEventListener('click', () => {
    _planEditMode = false;
    _renderAssignments(_currentAssignments, false);
    hide('btn-save-plan-edits');
    hide('btn-cancel-plan-edits');
    show('btn-edit-plan');
});

// Plan manager
document.getElementById('btn-plan-save').addEventListener('click', savePlanSnapshot);
document.getElementById('btn-plan-list').addEventListener('click', openPlanModal);
document.getElementById('btn-plan-modal-close').addEventListener('click', () => hide('plan-modal'));

// Script copy buttons
document.querySelectorAll('.btn-copy-script').forEach(btn => {
    btn.addEventListener('click', () => {
        const pre = document.getElementById(btn.dataset.target);
        navigator.clipboard.writeText(pre.textContent).then(() => {
            const orig = btn.textContent;
            btn.textContent = '✓ Skopiowano!';
            setTimeout(() => btn.textContent = orig, 2000);
        });
    });
});

// ── Discord bot ────────────────────────────────────────────────────────────
document.getElementById('btn-dc-save').addEventListener('click',  saveDiscordConfig);
document.getElementById('btn-dc-start').addEventListener('click', startDiscordBot);
document.getElementById('btn-dc-stop').addEventListener('click',  stopDiscordBot);
document.getElementById('btn-dc-test').addEventListener('click',  testDiscordBot);
