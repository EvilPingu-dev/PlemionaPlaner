/* ── DISCORD BOT ─────────────────────────────────────────────────────────── */

let _dcPollingId = null;

async function loadDiscordConfig() {
    try {
        const cfg = await fetch('/api/discord/config').then(r => r.json());
        if (cfg.channel_id)    document.getElementById('dc-channel-id').value    = cfg.channel_id;
        if (cfg.reminder_mins) document.getElementById('dc-reminder-mins').value = cfg.reminder_mins;
        _updateBotStatusBadge(cfg.running);
    } catch {}
}

async function saveDiscordConfig() {
    const msg        = document.getElementById('dc-status-msg');
    const token      = document.getElementById('dc-token').value.trim();
    const channelId  = document.getElementById('dc-channel-id').value.trim();
    const remindMins = document.getElementById('dc-reminder-mins').value;

    if (!channelId) { setStatus(msg, 'Wpisz ID kanału.', 'err'); return; }

    const body = { channel_id: channelId, reminder_mins: Number(remindMins) };
    if (token) body.token = token;

    const res = await fetch('/api/discord/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (res.ok) {
        setStatus(msg, '✓ Zapisano.', 'ok');
        document.getElementById('dc-token').value = '';  // clear token field after saving
    } else {
        setStatus(msg, 'Błąd zapisu.', 'err');
    }
}

async function startDiscordBot() {
    const msg = document.getElementById('dc-status-msg');
    setStatus(msg, 'Uruchamianie…');
    const res  = await fetch('/api/discord/start', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
        setStatus(msg, '✓ Bot uruchomiony.', 'ok');
        _updateBotStatusBadge(true);
        _startBotPolling();
    } else {
        setStatus(msg, data.error || 'Błąd uruchomienia.', 'err');
    }
}

async function stopDiscordBot() {
    const msg = document.getElementById('dc-status-msg');
    await fetch('/api/discord/stop', { method: 'POST' });
    setStatus(msg, 'Bot zatrzymany.', 'ok');
    _updateBotStatusBadge(false);
    _stopBotPolling();
}

function _updateBotStatusBadge(running) {
    const el = document.getElementById('dc-bot-status');
    if (!el) return;
    if (running) {
        el.innerHTML = '<span style="color:#4ec97a;font-weight:600">🟢 Bot aktywny – przypomnienia zaplanowane</span>';
    } else {
        el.innerHTML = '<span style="color:#888">⚫ Bot zatrzymany</span>';
    }
}

async function _pollBotStatus() {
    try {
        const d = await fetch('/api/discord/status').then(r => r.json());
        _updateBotStatusBadge(d.running);
        if (!d.running) _stopBotPolling();
    } catch {}
}

function _startBotPolling() {
    if (_dcPollingId) return;
    _dcPollingId = setInterval(_pollBotStatus, 10_000);
}

function _stopBotPolling() {
    if (_dcPollingId) { clearInterval(_dcPollingId); _dcPollingId = null; }
}

async function testDiscordBot() {
    const msg = document.getElementById('dc-status-msg');
    setStatus(msg, 'Wysylanie testu...');
    const res  = await fetch('/api/discord/test', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
        setStatus(msg, '✓ Wiadomosc testowa wyslana na kanal!', 'ok');
    } else {
        setStatus(msg, data.error || 'Blad wysylania testu.', 'err');
    }
}
