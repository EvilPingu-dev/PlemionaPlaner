/* ── USTAWIENIA ─────────────────────────────────────────────────────────── */

// BBCode toolbar — handles all .bbcode-toolbar buttons
document.addEventListener('click', function (e) {
    const btn = e.target.closest('.bbcode-toolbar button');
    if (!btn) return;
    e.preventDefault();
    const taId  = btn.closest('.bbcode-toolbar').dataset.target;
    const ta    = document.getElementById(taId);
    if (!ta) return;
    let open  = btn.dataset.open  || '';
    const close = btn.dataset.close || '';
    const prompt = btn.dataset.prompt;
    if (prompt) {
        const val = window.prompt(prompt);
        if (val === null) return;
        open = open + val + ']';
    }
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const sel   = ta.value.slice(start, end);
    const replacement = open + sel + close;
    ta.setRangeText(replacement, start, end, 'select');
    // Move cursor after inserted tags if no selection
    if (start === end) {
        const pos = start + open.length;
        ta.setSelectionRange(pos, pos);
    }
    ta.focus();
});

async function loadSettings() {
    try {
        const res = await fetch('/api/settings');
        _settings = await res.json();
        applySettings(_settings);
    } catch {}
}

function applySettings(s) {
    document.getElementById('s-action-name').value    = s.action_name  || '';
    document.getElementById('s-window').value          = s.arrival_window_minutes ?? 1;
    document.getElementById('s-server').value          = s.server       || '';
    document.getElementById('s-leader').value          = s.leader_name  || '';
    document.getElementById('s-off-speed').value       = s.off_speed    ?? 18;
    document.getElementById('s-ram-speed').value       = s.ram_speed    ?? 30;
    document.getElementById('s-noble-speed').value     = s.noble_speed  ?? 35;
    document.getElementById('s-noble-escort').value    = s.noble_escort_min ?? 100;
    _gapMinutesToFields('s', s.off_noble_gap_minutes ?? 1);
    document.getElementById('s-greeting').value        = s.greeting     || '';
    document.getElementById('s-off-sort').value         = s.off_sort          || 'closest';
    document.getElementById('s-off-sort-invert').checked = !!s.off_sort_invert;
    document.getElementById('s-noble-sort').value       = s.noble_sort         || 'closest';
    document.getElementById('s-noble-sort-invert').checked = !!s.noble_sort_invert;
    document.getElementById('s-noble-max-dist').value  = s.noble_max_dist    ?? 60;
    document.getElementById('s-noble-min-dist').value  = s.noble_min_dist    ?? 0;
    document.getElementById('s-max-off-dist').value    = s.max_off_dist      ?? 0;
    document.getElementById('s-min-off-dist').value    = s.min_off_dist      ?? 0;
    document.getElementById('s-min-off').value         = s.min_off           ?? 1500;
    document.getElementById('s-block-night').checked   = !!s.block_night_sends;
    document.getElementById('s-fill-free').checked     = !!s.fill_free_villages;
    document.getElementById('s-min-morale').value      = s.min_morale ?? 100;
    document.getElementById('s-noble-priority').value  = (s.noble_priority_players || []).join('\n');
    let slots = s.arrival_slots || [];
    if (!slots.length && s.arrival_datetime) slots = [{ label: 'Fala 1', datetime: s.arrival_datetime }];
    if (!slots.length) slots = [{ label: 'Fala 1', datetime: '' }];
    renderArrivalSlots(slots);
}

let _arrivalSlots = [{ label: 'Fala 1', datetime: '' }];

function renderArrivalSlots(slots) {
    _arrivalSlots = slots;
    const list = document.getElementById('arrival-slots-list');
    list.innerHTML = '';
    slots.forEach((slot, idx) => {
        const row = document.createElement('div');
        row.className = 'slot-row';
        row.dataset.idx = idx;
        row.innerHTML = `
            <span class="slot-num">${idx + 1}</span>
            <input type="text" class="slot-label" placeholder="np. Fala 1" value="${_esc(slot.label || '')}" style="width:110px">
            <input type="datetime-local" class="slot-datetime" step="1" value="${_esc(slot.datetime || '')}">
            ${idx === 0 ? '<span></span>' : `<button class="btn-remove-slot" data-idx="${idx}">✕</button>`}
        `;
        list.appendChild(row);
    });
    list.querySelectorAll('.btn-remove-slot').forEach(btn => {
        btn.addEventListener('click', () => {
            _arrivalSlots.splice(parseInt(btn.dataset.idx), 1);
            renderArrivalSlots(_arrivalSlots);
        });
    });
}

function _readArrivalSlots() {
    return Array.from(document.querySelectorAll('#arrival-slots-list .slot-row')).map(row => ({
        label:    row.querySelector('.slot-label').value,
        datetime: row.querySelector('.slot-datetime').value,
    }));
}

document.getElementById('btn-add-slot').addEventListener('click', () => {
    _arrivalSlots = _readArrivalSlots();
    _arrivalSlots.push({ label: `Fala ${_arrivalSlots.length + 1}`, datetime: '' });
    renderArrivalSlots(_arrivalSlots);
});

async function saveSettings() {
    const status = document.getElementById('settings-status');
    const slots  = _readArrivalSlots();
    const arrival_datetime = slots.length ? (slots[0].datetime || '') : '';
    const payload = {
        action_name:            document.getElementById('s-action-name').value,
        arrival_datetime,
        arrival_slots:          slots,
        arrival_window_minutes: parseInt(document.getElementById('s-window').value),
        server:                 document.getElementById('s-server').value,
        leader_name:            document.getElementById('s-leader').value,
        off_speed:              parseFloat(document.getElementById('s-off-speed').value),
        ram_speed:              parseFloat(document.getElementById('s-ram-speed').value),
        noble_speed:            parseFloat(document.getElementById('s-noble-speed').value),
        noble_escort_min:       parseInt(document.getElementById('s-noble-escort').value)   || 0,
        off_noble_gap_minutes:  _gapFieldsToMs('s') / 60000,
        greeting:               document.getElementById('s-greeting').value,
        off_sort:               document.getElementById('s-off-sort').value,
        off_sort_invert:        document.getElementById('s-off-sort-invert').checked,
        noble_sort:             document.getElementById('s-noble-sort').value,
        noble_sort_invert:      document.getElementById('s-noble-sort-invert').checked,
        noble_max_dist:         parseFloat(document.getElementById('s-noble-max-dist').value) || 0,
        noble_min_dist:         parseFloat(document.getElementById('s-noble-min-dist').value) || 0,
        max_off_dist:           parseFloat(document.getElementById('s-max-off-dist').value)   || 0,
        min_off_dist:           parseFloat(document.getElementById('s-min-off-dist').value)   || 0,
        min_off:                parseInt(document.getElementById('s-min-off').value)           || 0,
        block_night_sends:      document.getElementById('s-block-night').checked,
        fill_free_villages:     document.getElementById('s-fill-free').checked,
        min_morale:             parseInt(document.getElementById('s-min-morale').value) || 0,
        noble_priority_players: document.getElementById('s-noble-priority').value
                                    .split('\n').map(x => x.trim()).filter(Boolean),
    };
    try {
        const res = await fetch('/api/settings', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload),
        });
        if (res.ok) { _settings = payload; setStatus(status, '✓ Zapisano.', 'ok'); }
        else        { setStatus(status, 'Błąd zapisu.', 'err'); }
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function _esc(str) {
    return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}


/* ── Gap helpers ────────────────────────────────────────────────────────── */

function _gapFieldsToMs(prefix) {
    const m  = parseInt(document.getElementById(`${prefix}-gap-min`)?.value)  || 0;
    const s  = parseInt(document.getElementById(`${prefix}-gap-sec`)?.value)  || 0;
    const ms = parseInt(document.getElementById(`${prefix}-gap-ms`)?.value)   || 0;
    return m * 60000 + s * 1000 + ms;
}

function _gapMinutesToFields(prefix, gapMinutes) {
    const totalMs = Math.round(gapMinutes * 60000);
    const m  = Math.floor(totalMs / 60000);
    const s  = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    document.getElementById(`${prefix}-gap-min`).value = m;
    document.getElementById(`${prefix}-gap-sec`).value = s;
    document.getElementById(`${prefix}-gap-ms`).value  = ms;
}

function _fmtGap(totalMs) {
    if (!totalMs) return '= OFF';
    const m  = Math.floor(totalMs / 60000);
    const s  = Math.floor((totalMs % 60000) / 1000);
    const ms = totalMs % 1000;
    const parts = [];
    if (m)  parts.push(`${m}min`);
    if (s)  parts.push(`${s}s`);
    if (ms) parts.push(`${ms}ms`);
    return '+' + parts.join(' ');
}

function _fmtTimeMs(isoOrDate) {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}.${String(d.getMilliseconds()).padStart(3,'0')}`;
}
