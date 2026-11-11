/* Pico RamOS shell page logic: app cards (launch + running status), web cards
   (embedded webview + open-in-browser fallback), bili cards (Bilibili with a
   persistent login session), folder cards (decorative desktop-shortcut
   folders - order lives in the card config, never in the OS). */
(function () {
  'use strict';
  const api = window.card;
  if (!api) return;
  const body = document.getElementById('bodySlot');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  api.getState().then((cfg) => {
    if (!cfg) return;
    if (cfg.kind === 'app') renderApp(cfg);
    else if (cfg.kind === 'web') renderWeb(cfg);
    else if (cfg.kind === 'bili') renderBili(cfg);
    else if (cfg.kind === 'folder') renderFolder(cfg);
  });

  function renderApp(cfg) {
    const has = !!cfg.target;
    body.innerHTML =
      '<div class="appbox">' +
      '  <div class="appicon">▶</div>' +
      '  <div class="appname"></div>' +
      '  <div class="appstatus" id="stBox"><span class="dot"></span><span class="st-text">检测中…</span></div>' +
      '  <button class="launch" id="btnLaunch">启动</button>' +
      (has ? '' : '<button class="ghost" id="btnSetPath">还没设路径 · 去管理面板导入</button>') +
      '  <div class="apperr hidden" id="errBox"></div>' +
      '</div>';
    body.querySelector('.appname').textContent = cfg.title || '未命名';

    const btn = document.getElementById('btnLaunch');
    const err = document.getElementById('errBox');
    if (!has) btn.disabled = true;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      api.launch().then((r) => {
        btn.disabled = false;
        if (!r || !r.ok) {
          err.textContent = '启动失败：' + ((r && r.err) || '目标不存在，去管理面板重新导入路径');
          err.classList.remove('hidden');
        }
      });
    });
    const sp = document.getElementById('btnSetPath');
    if (sp) sp.addEventListener('click', () => api.openManager());

    api.onAppStatus((s) => {
      const box = document.getElementById('stBox');
      const txt = box.querySelector('.st-text');
      if (!has) { txt.textContent = '未设置路径'; return; }
      box.classList.toggle('running', !!s.running);
      txt.textContent = s.running ? '运行中' : '未运行';
    });
  }

  /* Webview failure handling: did-fail-load fires for EVERY failed subresource
     (images, XHR, even ERR_ABORTED when the page cancels its own navigation).
     Bilibili and the mail sites load dozens of those on a perfectly healthy
     page, so a naive listener pops the fallback on pages that loaded fine.
     Only a MAIN-FRAME failure with a real network error (not an abort) counts,
     and a later successful load clears it. */
  const IGNORED_ERROR_CODES = [-3];                    // ERR_ABORTED: self-cancelled nav
  function wireWebviewFail(wv, fb, label) {
    wv.addEventListener('did-fail-load', (e) => {
      if (e.isMainFrame === false) return;             // subresource noise
      if (IGNORED_ERROR_CODES.indexOf(Number(e.errorCode)) !== -1) return;
      fb.querySelector('div').textContent = (label || '这个页面') + '没能在卡片里加载';
      fb.classList.remove('hidden');
    });
    wv.addEventListener('load-stop', () => fb.classList.add('hidden'));   // recovered
  }

  function renderWeb(cfg) {
    body.classList.add('web');
    body.innerHTML =
      '<webview id="wv" src="' + String(cfg.target).replace(/"/g, '&quot;') + '" allowpopups useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"></webview>' +
      '<div class="webfallback hidden" id="wvFb"><div>这个页面没能在卡片里加载</div>' +
      '<div class="fbacts"><button class="launch" id="wvRetry">↻ 重试</button>' +
      '<button class="launch ghost" id="wvOpen">在浏览器打开</button></div></div>';
    const wv = document.getElementById('wv');
    const fb = document.getElementById('wvFb');
    wireWebviewFail(wv, fb, '这个页面');
    document.getElementById('wvRetry').addEventListener('click', () => { fb.classList.add('hidden'); wv.reload(); });
    document.getElementById('wvOpen').addEventListener('click', () => api.openExternal(cfg.target));
  }

  /* ---------- bili card: danmaku player widget ----------
   * Default view is the EMBEDDED PLAYER (player.bilibili.com iframe, danmaku
   * ON by default) driven by a BV id or video link. The full site is one click
   * away for browsing (login there once - the session persists). */
  function bvidOf(u) {
    const m = String(u || '').match(/BV[0-9A-Za-z]{10}/);
    return m ? m[0] : '';
  }
  function playerUrl(bvid, page) {
    return 'https://player.bilibili.com/player.html?bvid=' + encodeURIComponent(bvid) +
      '&page=' + (Number(page) || 1) + '&high_quality=1&danmaku=1&autoplay=0';
  }
  function renderBili(cfg) {
    body.classList.add('web');
    const startBv = bvidOf(cfg.target);
    body.innerHTML =
      '<div class="bbar">' +
      '  <input class="burl" id="bUrl" placeholder="BV 号或视频链接，回车播放">' +
      '  <button class="bq" id="bGo" title="播放">▶</button>' +
      '  <button class="bq" id="bSite" title="浏览 B 站">全页</button>' +
      '  <button class="bopen" id="bOpen" title="在浏览器打开">↗</button>' +
      '</div>' +
      '<div class="bstart" id="bStart">' +
      '  <div class="bstart-box">' +
      '    <div class="bstart-t">B 站小窗</div>' +
      '    <div class="bstart-s">粘贴 BV 号或视频链接到上方地址栏，回车播放<br>弹幕默认开启 · 点「全页」登录一次后保持登录</div>' +
      '  </div>' +
      '</div>' +
      '<webview id="bWv" partition="persist:bili" allowpopups ' +
      'useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"></webview>' +
      '<div class="webfallback hidden" id="bFb"><div>B 站没能在卡片里加载</div>' +
      '<div class="fbacts"><button class="launch" id="bRetry">↻ 重试</button>' +
      '<button class="launch ghost" id="bFbOpen">在浏览器打开</button></div></div>';
    const wv = document.getElementById('bWv');
    const url = document.getElementById('bUrl');
    const startBox = document.getElementById('bStart');
    const fb = document.getElementById('bFb');
    const showWv = (on) => { wv.style.display = on ? '' : 'none'; startBox.classList.toggle('hidden', on); };
    const openUrl = (u) => { if (!u) return; wv.src = u; showWv(true); };
    const play = () => {
      let u = url.value.trim();
      if (!u) return;
      if (!/^https?:\/\//.test(u) && !/^BV[0-9A-Za-z]{10}$/.test(u)) u = 'https://www.bilibili.com/video/' + u;
      const bv = bvidOf(u);
      if (bv) openUrl(playerUrl(bv));
      else { if (!/^https?:\/\//.test(u)) u = 'https://' + u; openUrl(u); }
    };
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
    document.getElementById('bGo').addEventListener('click', play);
    document.getElementById('bSite').addEventListener('click', () => openUrl('https://www.bilibili.com'));
    document.getElementById('bOpen').addEventListener('click', () => api.openExternal(wv.src || 'https://www.bilibili.com'));
    document.getElementById('bFbOpen').addEventListener('click', () => api.openExternal(wv.src || 'https://www.bilibili.com'));
    wireWebviewFail(wv, fb, 'B 站');
    document.getElementById('bRetry').addEventListener('click', () => { fb.classList.add('hidden'); wv.reload(); });
    if (startBv) { url.value = startBv; openUrl(playerUrl(startBv)); }
    else showWv(false);
  }

  /* ---------- folder card: phone-desktop-folder style shortcut organizer ----------
   * DECORATIVE ONLY: items are {name, target} references stored in the card's
   * own config. No file is ever moved; the desktop's own sort order is
   * untouched because nothing here touches the real desktop. */
  function renderFolder(cfg) {
    body.classList.add('folder');
    let items = Array.isArray(cfg.items) ? cfg.items.slice() : [];
    // no explanatory caption: a folder card should read like a phone folder
    body.innerHTML = '<div class="fgrid" id="fgrid"></div>';
    const grid = document.getElementById('fgrid');

    function hue(name) {
      let h = 0;
      const s = String(name || '');
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
      return h;
    }
    function persist() { api.save({ items: items }); }

    function tile(it, i) {
      const el = document.createElement('div');
      el.className = 'ftile';
      el.dataset.i = String(i);
      const ico = document.createElement('div');
      ico.className = 'fico';
      ico.style.background = 'hsl(' + hue(it.name) + ',42%,27%)';
      ico.textContent = (String(it.name || '?').trim()[0] || '?').toUpperCase();
      const nm = document.createElement('div');
      nm.className = 'fname';
      nm.textContent = it.name || '未命名';
      const del = document.createElement('span');
      del.className = 'fdel';
      del.title = '移出卡片（不删文件）';
      del.textContent = '✕';
      const hd = document.createElement('span');
      hd.className = 'fhandle';
      hd.title = '拖动排序';
      hd.textContent = '⠿';
      el.appendChild(ico);
      el.appendChild(nm);
      el.appendChild(del);
      el.appendChild(hd);

      let pressMoved = false;
      el.addEventListener('pointerdown', () => { pressMoved = false; });
      el.addEventListener('pointermove', () => { pressMoved = true; });
      el.addEventListener('click', (e) => {
        if (e.target === del || e.target === hd || pressMoved) return;
        api.launchApp(it.target).then((r) => {
          if (!r || !r.ok) nm.textContent = '启动失败';
        });
      });
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        items.splice(i, 1);
        persist();
        render();
      });
      hd.addEventListener('pointerdown', (e) => startReorder(e, i));
      return el;
    }

    function render() {
      grid.innerHTML = '';
      items.forEach((it, i) => grid.appendChild(tile(it, i)));
      const add = document.createElement('div');
      add.className = 'ftile fadd';
      const aico = document.createElement('div');
      aico.className = 'fico';
      aico.textContent = '＋';
      const anm = document.createElement('div');
      anm.className = 'fname';
      anm.textContent = '添加快捷方式';
      add.appendChild(aico);
      add.appendChild(anm);
      add.addEventListener('click', () => {
        api.pickFile().then((p) => {
          if (!p) return;
          const name = p.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
          items.push({ name: name, target: p });
          persist();
          render();
        });
      });
      grid.appendChild(add);
    }

    // reorder: document-level capture listeners so re-rendering mid-drag is safe
    function startReorder(e, from) {
      e.preventDefault();
      e.stopPropagation();
      const move = (ev) => {
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        const target = under && under.closest ? under.closest('.ftile:not(.fadd)') : null;
        if (!target) return;
        const to = Number(target.dataset.i);
        if (isNaN(to) || to === from) return;
        const it = items.splice(from, 1)[0];
        items.splice(to, 0, it);
        from = to;
        render();
      };
      const up = () => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        persist();
        render();
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
    }

    // drop desktop shortcuts straight onto the card
    body.addEventListener('dragover', (e) => { e.preventDefault(); body.classList.add('fdropping'); });
    body.addEventListener('dragleave', () => body.classList.remove('fdropping'));
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      body.classList.remove('fdropping');
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      let added = 0;
      for (let i = 0; i < files.length; i++) {
        const p = files[i].path || files[i].name;
        if (!/\.(lnk|exe|bat|cmd|url)$/i.test(p)) continue;
        items.push({ name: p.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''), target: p });
        added++;
      }
      if (added) { persist(); render(); }
    });

    render();
  }
})();
