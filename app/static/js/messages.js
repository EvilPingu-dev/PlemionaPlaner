/* ── WIADOMOŚCI ─────────────────────────────────────────────────────────── */

(function () {
    function _setSetupVisible(visible) {
        const guide = document.getElementById('userscript-setup');
        const showBtn = document.getElementById('btn-show-setup');
        if (guide)   guide.style.display   = visible ? '' : 'none';
        if (showBtn) showBtn.style.display  = visible ? 'none' : '';
        localStorage.setItem('tw_setup_hidden', visible ? '0' : '1');
    }

    // Restore saved preference
    if (localStorage.getItem('tw_setup_hidden') === '1') _setSetupVisible(false);

    document.addEventListener('click', function (e) {
        if (!e.target) return;
        if (e.target.id === 'btn-hide-setup')  _setSetupVisible(false);
        if (e.target.id === 'btn-show-setup')  _setSetupVisible(true);

        if (e.target.id === 'btn-show-manual-install') {
            const box = document.getElementById('manual-install-box');
            if (!box) return;
            box.style.display = box.style.display === 'none' ? '' : 'none';
            if (box.style.display !== 'none') {
                // Fetch and display the userscript source
                const ta = document.getElementById('userscript-code-ta');
                if (ta && !ta.value) {
                    fetch('/tw-mail.user.js').then(r => r.text()).then(t => { ta.value = t; });
                }
            }
        }

        if (e.target.id === 'btn-copy-userscript') {
            const ta = document.getElementById('userscript-code-ta');
            if (!ta) return;
            navigator.clipboard.writeText(ta.value).then(() => {
                const orig = e.target.textContent;
                e.target.textContent = '✓ Skopiowano!';
                setTimeout(() => e.target.textContent = orig, 2000);
            });
        }
    });
})();

async function generateMessages() {
    const status = document.getElementById('messages-status');
    setStatus(status, 'Generowanie…');

    const gapMs = _gapFieldsToMs('plan');
    const updatedAssignments = _currentAssignments.map((a, aIdx) => {
        const dtInput = document.querySelector(`.asgn-off-dt[data-aidx="${aIdx}"]`);
        const offDt = dtInput ? dtInput.value : (a.arrival_dt || '');
        let nobleDt = offDt;
        if (offDt && gapMs > 0)
            nobleDt = _toLocalISOString(new Date(new Date(offDt).getTime() + gapMs));
        return { ...a, arrival_dt: offDt || a.arrival_dt, noble_arrival_dt: nobleDt || a.noble_arrival_dt };
    });

    try {
        const res  = await fetch('/api/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignments: updatedAssignments }),
        });
        const data = await res.json();
        if (!res.ok) { setStatus(status, data.error || 'Błąd serwera', 'err'); return; }
        setStatus(status, `✓ Wygenerowano ${data.messages.length} wiadomości.`, 'ok');
        renderMessages(data.messages);
    } catch { setStatus(status, 'Błąd połączenia', 'err'); }
}

function renderMessages(messages) {
    const container = document.getElementById('messages-output');
    const now = Date.now();

    container.innerHTML = messages.map((m, idx) => {
        const attackRows = m.attacks.map(a => {
            const isForeign = !!a.is_foreign;
            const sendDt  = new Date(a.send_dt);
            const diffMs  = sendDt.getTime() - now;
            const diffMin = diffMs / 60000;
            const sendFmt = sendDt.toLocaleString('pl-PL', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
            let cdClass, cdText;
            if (diffMs < 0) {
                cdClass = 'past';
                const ago = Math.abs(diffMin);
                cdText = ago < 60 ? `${Math.round(ago)}min temu` : `${Math.floor(ago/60)}h ${Math.round(ago%60)}min temu`;
            } else if (diffMin < 12 * 60) {
                cdClass = 'warn';
                cdText = diffMin < 60 ? `za ${Math.round(diffMin)}min` : `za ${Math.floor(diffMin/60)}h ${Math.round(diffMin%60)}min`;
            } else {
                cdClass = 'ok';
                cdText = `za ${Math.floor(diffMin/60)}h ${Math.round(diffMin%60)}min`;
            }
            const countdown = `<span class="send-countdown ${cdClass}">${cdText}</span>`;
            let attackBtn;
            if (isForeign) {
                attackBtn = `<span class="dim foreign-player">👤 ${a.player || ''}</span>`;
            } else {
                attackBtn = (a.from_id && a.target_id && _settings.server)
                    ? `<a class="tw-link" href="https://pl${_settings.server}.plemiona.pl/game.php?village=${a.from_id}&screen=place&target=${a.target_id}" target="_blank" rel="noopener">⚔ Wyślij</a>`
                    : `<span class="dim">${a.type}</span>`;
            }
            return `<tr class="${isForeign ? 'attack-foreign' : ''}">
                <td>${attackBtn}</td>
                <td><strong>${a.type}</strong></td>
                <td><code>${a.from_coord}</code></td>
                <td><code>${a.target_coord}</code></td>
                <td>${a.distance} pol</td>
                <td>${fmtMinutes(a.travel_min)}</td>
                <td><strong>${sendFmt}</strong><br>${countdown}</td>
                <td>${fmt(a.off)}</td>
                <td>${a.nobles > 0 ? a.nobles : '-'}</td>
                <td>${a.burzenie || '-'}</td>
            </tr>`;
        }).join('');
        const ownCount = m.attacks.filter(a => !a.is_foreign).length;

        const mailBtn = m.mail_link
            ? `<button class="btn btn-mail" data-idx="${idx}" data-link="${escAttr(m.mail_link)}">✉ Wyślij w TW</button>`
            : '';

        return `<div class="card msg-card">
            <div class="msg-header">
                <span class="msg-player">👤 ${m.player}</span>
                <span class="msg-count">${ownCount} wysyłek</span>
                ${mailBtn}
                <button class="btn btn-copy" data-idx="${idx}" title="Kopiuj BBCode">📋 Kopiuj BBCode</button>
            </div>
            <div class="msg-attacks">
                <table>
                    <thead><tr>
                        <th>Link</th><th>Typ</th><th>Z wioski</th><th>Cel</th>
                        <th>Dystans</th><th>Podróż</th><th>Wysyłka o</th>
                        <th>OFF</th><th>Szlach.</th><th>Burzenie/Katy</th>
                    </tr></thead>
                    <tbody>${attackRows}</tbody>
                </table>
            </div>
            <details class="bbcode-wrap">
                <summary>Pokaż BBCode</summary>
                <textarea class="bbcode-ta" rows="12" readonly>${escHtml(m.message)}</textarea>
            </details>
        </div>`;
    }).join('');

    container.querySelectorAll('.btn-copy').forEach(btn => {
        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(messages[parseInt(btn.dataset.idx)].message).then(() => {
                const orig = btn.textContent;
                btn.textContent = '✓ Skopiowano!';
                setTimeout(() => btn.textContent = orig, 2000);
            });
        });
    });

    container.querySelectorAll('.btn-mail').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.idx);
            // window.open must be called synchronously (in the click handler)
            // to avoid popup blockers — clipboard copy runs after
            window.open(btn.dataset.link, '_blank', 'noopener');
            navigator.clipboard.writeText(messages[idx].message).then(() => {
                const orig = btn.textContent;
                btn.textContent = '✓ Skopiowano treść!';
                setTimeout(() => btn.textContent = orig, 3000);
            });
        });
    });
}
