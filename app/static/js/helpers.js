/* ── Tab switching ──────────────────────────────────────────────────────── */

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'status')  loadAttackStatus();
        if (btn.dataset.tab === 'discord') loadDiscordConfig();
    });
});


/* ── Shared helpers ─────────────────────────────────────────────────────── */

function setStatus(el, msg, type = '') {
    el.textContent = msg;
    el.className = 'status-msg ' + type;
    if (type === 'ok') _showToast(msg);
}

let _toastTimer = null;
function _showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function fmt(n) { return Number(n).toLocaleString('pl-PL'); }

function summaryItem(val, lbl) {
    return `<div class="summary-item">
        <div class="val">${fmt(val)}</div>
        <div class="lbl">${lbl}</div>
    </div>`;
}

function show(id)  { document.getElementById(id).style.display = ''; }
function hide(id)  { document.getElementById(id).style.display = 'none'; }

function badgeHtml(text, warn = false) {
    return `<span class="badge${warn ? ' warn' : ''}">${text}</span>`;
}

/** Minutes → "Xh Ymin" or "Ymin" */
function fmtMinutes(min) {
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escAttr(str) {
    return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Format a Date as a local-time ISO string (YYYY-MM-DDTHH:mm:ss.mmm).
 *  Unlike toISOString() this does NOT convert to UTC, preventing the
 *  noble arrival time from being shifted by the user's UTC offset. */
function _toLocalISOString(d) {
    const pad = n => String(n).padStart(2, '0');
    const ms  = String(d.getMilliseconds()).padStart(3, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` +
           `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
}
