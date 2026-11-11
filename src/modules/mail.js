/* Pico RamOS mail card: aggregated inbox across the user's IMAP accounts.
   Channels are shown in the order configured in the unified setup (drag to
   reorder there). Each account is fetched independently by the main process, so
   a wrong password / timeout on one account only flags that account. */
(function () {
  'use strict';
  const api = window.card;
  if (!api) return;
  const pane = document.getElementById('mPane');
  const refreshBtn = document.getElementById('mRefresh');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  const badge = document.getElementById('mUnread');
  function updateBadge(results) {
    let n = 0;
    (results || []).forEach((r) => { (r.messages || []).forEach((m) => { if (m.unread) n++; }); });
    if (!badge) return;
    if (n > 0) { badge.textContent = n > 99 ? '99+' : String(n); badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }

  function render(results) {
    updateBadge(results);
    if (!results || !results.length) {
      pane.innerHTML = '<div class="empty">还没配置邮件账户。<br>打开「首次设置向导」或管理面板添加 Gmail / QQ / 163 邮箱。</div>';
      return;
    }
    let html = '';
    let hasAny = false;
    results.forEach((r) => {
      const accName = esc(r.account || '');
      if (r.error) {
        /* show the SERVER's own error text, not just "连接失败": an IMAP auth
           failure is usually a wrong auth code / IMAP not enabled on the
           account, and the raw message is the only way to tell which */
        const reason = r.error === 'incomplete' ? '未配置完整'
          : String(r.error).slice(0, 120);
        html += '<div class="macc"><div class="macc-h"><span class="adot err"></span>' +
          '<span class="an">' + accName + '</span><span class="aerr">· ' +
          esc(reason) + '</span></div></div>';
        return;
      }
      const msgs = (r.messages || []).slice().sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return tb - ta;
      });
      if (!msgs.length) return;
      hasAny = true;
      html += '<div class="macc"><div class="macc-h"><span class="adot"></span>' +
        '<span class="an">' + accName + '</span></div>';
      msgs.forEach((m) => {
        const un = m.unread ? ' unread' : '';
        html += '<div class="mitem' + un + '" title="' + esc(m.subject) + '">' +
          '<div class="mf">' + esc(m.from) + '</div>' +
          '<div class="ms">' + esc(m.subject) + '</div>' +
          (m.preview ? '<div class="mp">' + esc(m.preview) + '</div>' : '') +
          '<div class="md">' + fmtDate(m.date) + '</div>' +
          '</div>';
      });
      html += '</div>';
    });
    if (!hasAny && !/<span class="aerr">/.test(html)) {
      pane.innerHTML = '<div class="empty">收件箱是空的。</div>';
      return;
    }
    pane.innerHTML = html;
  }

  let loading = false;
  async function load(keepScroll) {
    if (loading) return;
    const sc = keepScroll ? pane.scrollTop : 0;
    loading = true;
    refreshBtn.textContent = '…';
    try {
      const data = await api.mailFetch();
      render(data);
      if (keepScroll) pane.scrollTop = sc;      // polling must not yank the list
    } catch (e) {
      pane.innerHTML = '<div class="empty">读取邮件失败：' + esc(e.message || e) + '</div>';
    } finally {
      refreshBtn.textContent = '↻ 刷新';
      loading = false;
    }
  }

  refreshBtn.addEventListener('click', () => load(false));
  // initial load once the card knows its state (chrome injection needs it too)
  api.getState().then(() => load(false));
  // background poll: new mail should surface without opening the card. Kept
  // conservative (2 min, skipped while hidden or a fetch is already live).
  setInterval(() => { if (!document.hidden) load(true); }, 120000);
})();
