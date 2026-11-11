/* Pico RamOS - single-window shell runtime.
 *
 * Layers inside ONE window:
 *   #wallpaper (0) - #pages (1) - #statusbar (2) - #dock (3) - .sheet (20)
 * Widgets are DOM nodes here, NOT BrowserWindows. That is the only way
 * backdrop-filter can sample the wallpaper and give real frosted glass.
 */
(function () {
  'use strict';

  const API = window.os || {};

  /* ---- desktop takeover -------------------------------------------------
   * Ctrl+Alt+Shift+D hands the real desktop over to the shell: the Windows taskbar
   * and the explorer-drawn desktop icons both step aside, so the widgets sit
   * on bare wallpaper. The same shortcut gives them back.
   *
   * This is a Win32 ShowWindow call made from the main process
   * (desktop-shell.ps1 -> os-desktop-shell IPC), NOT a Windhawk hook. So
   * explorer can bring the taskbar and icons back on its own after a refresh
   * or a Win-key press; the shortcut is an escape hatch, not a lock.
   */
  let desktopTaken = false;

  /* Ctrl+Alt+Shift+D is kept as a fallback; the main process owns the real
     state (Win+Shift+D), so the renderer must not mutate it directly. */
  window.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || !e.altKey || !e.shiftKey) return;
    if (String(e.key).toLowerCase() !== 'd') return;
    e.preventDefault();
    if (API.desktopToggle) API.desktopToggle().catch(() => {});
  });
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const DUR = 200;
  let pagingTimer = null;
  let pageVisTimer = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const state = {
    pages: [],
    cards: new Map(),
    dock: [],
    cols: 4,
    rows: 3,
    wallpaper: { type: 'none', src: '', blur: 0, dim: 0.25 },
    current: 0,
  };

  const dom = {
    os: document.getElementById('os'),
    wallpaper: document.getElementById('wallpaper'),
    pages: document.getElementById('pages'),
    dots: document.getElementById('dots'),
    dock: document.getElementById('dock'),
    sceneName: document.getElementById('sceneName'),
    clock: document.getElementById('clock'),
    drawer: document.getElementById('drawer'),
    drawerGrid: document.getElementById('drawer-grid'),
    drawerSearch: document.getElementById('drawer-search'),
    sheet: document.getElementById('sheet'),
    sheetTitle: document.getElementById('sheetTitle'),
    sheetBody: document.getElementById('sheetBody'),
    hint: document.getElementById('gridHint'),
    lyric: document.getElementById('lyric'),
    lyricMeta: document.getElementById('lyricMeta'),
    lyricLines: document.getElementById('lyricLines'),
    lyricBar: document.getElementById('lyricBar')
  };

  /* ---------------- wallpaper ---------------- */

  /* The shell BrowserWindow is transparent and parented above the desktop's
   * wallpaper layer (workerw.ps1). Nothing may be painted here by default:
   * Wallpaper Engine's live scene has to show straight through. The desktop
   * snapshot is used only for colour sampling, never as a visible background.
   * A custom image/video wallpaper is still supported when explicitly set. */
  function renderWallpaper() {
    const w = state.wallpaper || {};
    dom.wallpaper.innerHTML = '';
    dom.wallpaper.style.filter = '';
    dom.wallpaper.style.setProperty('--wall-dim', String(w.dim != null ? w.dim : 0));
    if (!w.src || w.type === 'none') {
      dom.wallpaper.style.backgroundImage = 'none';
      dom.wallpaper.classList.remove('has-image');
      return;
    }
    dom.wallpaper.classList.add('has-image');
    if (w.type === 'video') {
      const v = document.createElement('video');
      v.src = w.src;
      v.muted = true;
      v.loop = true;
      v.autoplay = true;
      v.playsInline = true;
      dom.wallpaper.appendChild(v);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) v.pause();
        else v.play().catch(() => {});
      });
    } else if (w.type === 'image') {
      const img = document.createElement('img');
      img.src = w.src;
      dom.wallpaper.appendChild(img);
    }
    if (w.blur) dom.wallpaper.style.filter = 'blur(' + w.blur + 'px)';
  }

  /* ---------------- cards ---------------- */

  function iconNode(card) {
    const glyph = el('div', 'glyph', '\u25B6');
    if (card.icon) {
      const img = document.createElement('img');
      img.src = card.icon;
      glyph.textContent = '';
      glyph.appendChild(img);
    }
    return glyph;
  }


  /* ---------- compact page CSS for embedded sites ----------
   * A 1x1 widget is ~300px wide. Desktop sites are built for 1400px, so every
   * embedded page gets a stylesheet that hides the chrome nobody can use at
   * this size and shrinks the gutters. Injected per webview on load; harmless
   * on sites that ignore it. */
  const COMPACT_CSS = `
    /* --- generic: reclaim margin, hide fixed banners/chat bubbles --- */
    html, body { max-width: 100% !important; overflow: hidden !important; }
    ::-webkit-scrollbar { width: 0 !important; height: 0 !important; }
    body { margin: 0 !important; }

    /* --- bilibili --- */
    .bili-header, #biliMainHeader, .bili-header__bar,
    .bili-header-large, .header-banner, .animated-banner,
    .palette-button, .bili-feed4-layout .recommended-swipe {
      display: none !important;
    }
    .bili-feed4, .bili-feed4-layout, .bili-grid { padding: 4px !important; }
    .bili-video-card { margin: 0 0 6px 0 !important; }
    .bili-video-card__wrap { border-radius: 8px !important; }
    .bili-video-card__info--tit { font-size: 12.5px !important; line-height: 1.35 !important; }
    .bili-video-card__info--author,
    .bili-video-card__info--date { font-size: 11px !important; }
    .bili-video-card__stats { font-size: 11px !important; }
    /* the fixed left/top navigation rails */
    .left-entry, .mini-header, .nav-channel, .bili-header__channel { display: none !important; }

    /* --- mail.qq.com / mail.163.com --- */
    #header, .header, .mail-navigator .tabs { display: none !important; }
  `;

  function applyCompactCss(wv, kind) {
    if (!wv || typeof wv.insertCSS !== 'function') return;
    try {
      wv.insertCSS(COMPACT_CSS);
      /* insertCSS alone leaves the guest's own scrollbars alone on some sites,
         so clamp the document directly once it has actually finished loading */
      if (typeof wv.executeJavaScript === 'function') {
        wv.executeJavaScript(
          'document.documentElement.style.overflow="hidden";' +
          'document.body && (document.body.style.overflow="hidden");' +
          'void 0'
        ).catch(function () {});
      }
      if (kind === 'bili') {
        /* the mobile site is a better fit for a 300px tile; the desktop one
           keeps rendering a two-column feed no matter what we hide */
        const cur = wv.getAttribute('src') || '';
        if (cur.indexOf('bilibili.com') >= 0 && cur.indexOf('m.bilibili.com') < 0) {
          wv.setAttribute('src', 'https://m.bilibili.com/');
        }
      }
    } catch (e) { /* the guest may have navigated already */ }
  }

  function buildFolderCard(card) {
    const n = el('div', 'widget folder-widget');
    n.dataset.cardId = card.id;
    const items = (card.items || []);
    /* A 29-game library used to look like an empty 9-icon folder: put the
       real count in the header so the contents are discoverable at a glance. */
    n.append(el('div', 'widget-head',
      (card.title || '文件夹') + (items.length > 9 ? ' · ' + items.length : '')));
    const grid = el('div', 'folder-grid');
    /* Nine thumbnails is enough to recognise a folder at a glance. Clicking
       the card grows it downward to reveal the rest -- the lower half of the
       grid is deliberately left empty for exactly this. */
    const PREVIEW = Math.max(1, Number(card.folderPreview) || 9);
    let expanded = false;

    const addItem = (it) => {
      const cell = el('div', 'folder-item');
      const ico = el('div', 'folder-ico');
      const img = el('img');
      img.alt = '';
      img.src = it.icon || '';
      img.addEventListener('error', () => { img.remove(); ico.textContent = (it.title || '?').slice(0, 1); });
      ico.appendChild(img);
      cell.appendChild(ico);
      cell.appendChild(el('span', 'folder-name', it.title || ''));
      cell.title = it.title || '';
      cell.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (document.body.classList.contains('editing')) return;
        /* folder-item ids are NOT card ids: launchCardFromShell() only knows
           cards, so the old call silently did nothing. Open the shortcut. */
        if (it.target && API.launchPath) API.launchPath(it.target).catch(function () {});
        else if (it.id) API.launchCard(it.id);
      });
      grid.appendChild(cell);
    };

    const paint = () => {
      grid.innerHTML = '';
      const shown = expanded ? items : items.slice(0, PREVIEW);
      if (!shown.length) grid.append(el('div', 'folder-empty', '空'));
      shown.forEach(addItem);
      const rest = items.length - PREVIEW;
      if (rest > 0) {
        const more = el('div', 'folder-more',
          expanded ? '收起 ↑' : ('＋ 展开全部 ' + items.length + ' 个'));
        more.addEventListener('click', (ev) => { ev.stopPropagation(); toggle(); });
        grid.appendChild(more);
      }
    };

    const toggle = () => {
      expanded = !expanded;
      n.classList.toggle('folder-expanded', expanded);
      if (!n._baseH) n._baseH = n.style.height;
      if (expanded) {
        const base = parseFloat(n._baseH) || n.offsetHeight;
        /* important: some glass presets declare their own height, and a plain
           inline value would lose to them, leaving the grid to scroll instead
           of the card growing downward. */
        n.style.setProperty('height', Math.round(base + 190) + 'px', 'important');
      } else {
        n.style.setProperty('height', n._baseH, 'important');
      }
      paint();
      if (typeof publishHitRects === 'function') publishHitRects();
    };

    n.addEventListener('click', (ev) => {
      if (ev.target.closest('.folder-item, .folder-more')) return;
      if (document.body.classList.contains('editing')) return;
      toggle();
    });
    n.addEventListener('dblclick', () => openFolder(card));
    n.appendChild(grid);
    paint();
    return n;
  }

  function buildTile(card) {
    const n = el('div', 'widget tile');
    n.dataset.cardId = card.id;
    n.append(iconNode(card), el('div', 'name', card.title || 'untitled'));
    if (card.kind === 'folder') {
      const badge = el('span', 'tile-count', String((card.items || []).length));
      n.appendChild(badge);
    }
    n.addEventListener('click', () => {
      if (document.body.classList.contains('editing')) return;
      if (card.kind === 'folder') { openFolder(card); return; }
      API.launchCard(card.id);
    });
    return n;
  }

  /* The folder card borrows the full application drawer: no second surface,
     it scrolls in place. */
  function openFolder(card) {
    openDrawer('', card.items || [], card.title || '全部应用');
  }

  /* The music widget shows whatever Windows is currently playing (the SMTC
     * session), not a page. Main polls it and hands the state down. */

  /* jelly: the card only leans once the pointer actually travels, so a plain
     click never wobbles. While dragging it stretches + leans toward the pull
     like taffy, then springs back to rest on release. */
  (function jellyDrag() {
    let armed = null, sx = 0, sy = 0, guard = null;
    /* The shell window flips setIgnoreMouseEvents on a timer, so pointerup
       legitimately never arrives sometimes. A stuck "armed" card kept the
       jelly transform alive for every subsequent mousemove — that was the
       "jelly never stops" bug and a big part of the lag. Always release. */
    function release() {
      if (guard) { clearTimeout(guard); guard = null; }
      if (armed) {
        armed.classList.remove('is-dragging');
        armed.style.transition = '';
        armed.style.transform = '';
      }
      armed = null;
    }
    document.addEventListener('pointerdown', function (e) {
      release();
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.widget-head, .card-resize, button, input, textarea, webview')) return;
      const w = t.closest('.widget');
      if (!w) return;
      armed = w;
      sx = e.clientX; sy = e.clientY;
      guard = setTimeout(release, 700);
    }, true);
    document.addEventListener('pointermove', function (e) {
      if (!armed) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) <= 4) return;
      if (!armed.classList.contains('is-dragging')) {
        armed.classList.add('is-dragging');
        armed.style.transition = 'transform 0s, left .14s ease, top .14s ease, width .14s ease, height .14s ease';
      }
      const rot = Math.max(-7, Math.min(7, dx * 0.05));
      const stretch = 1 + Math.min(46, Math.abs(dx) + Math.abs(dy)) / 540;
      armed.style.transform = 'scale(' + stretch.toFixed(3) + ') rotate(' + rot.toFixed(2) + 'deg)';
    }, true);
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', function () { if (document.hidden) release(); });
  })();

  function buildMusicCard(card) {
    const n = el('div', 'widget music-widget');
    n.dataset.cardId = card.id;
    if (card.opacity != null && card.opacity < 1) n.style.opacity = String(card.opacity);
    n.append(el('div', 'widget-head', card.title || '正在播放'));
    const body = el('div', 'music-body');
    body.innerHTML =
      '<div class="m-deck">' +
        '<div class="m-disc"><span class="m-cover"></span><span class="m-hole"></span><span class="m-shine"></span></div>' +
      '</div>' +
      '<div class="m-float">' +
        '<div class="m-title">未在播放</div>' +
        '<div class="m-artist"></div>' +
        '<div class="m-bar"><i></i></div>' +
      '</div>' +
      '<div class="m-ctrls">' +
        '<button data-act="prev" title="上一首">‹</button>' +
        '<button data-act="playpause" class="m-play" title="播放/暂停">▶</button>' +
        '<button data-act="next" title="下一首">›</button>' +
      '</div>';
    n.appendChild(body);
    body.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (!API.mediaControl) return;
        const m = state.media || {};
        const idle = m.status === 'NoSession' || !m.title;
        const act = (b.dataset.act === 'playpause' && idle) ? 'open-player' : b.dataset.act;
        API.mediaControl(act);
      });
    });
    paintMusic(n, state.media);
    return n;
  }

  function fmtTime(s) {
    const v = Math.max(0, Math.round(Number(s) || 0));
    return Math.floor(v / 60) + ':' + String(v % 60).padStart(2, '0');
  }

  function paintMusic(node, media) {
    if (!node || !node.isConnected) return;
    const m = media || {};
    const title = node.querySelector('.m-title');
    const artist = node.querySelector('.m-artist');
    const fill = node.querySelector('.m-bar i');
    const play = node.querySelector('.m-play');
    if (!title) return;
    if (!m.ok || m.status === 'NoSession' || !m.title) {
      title.textContent = '点 ▶ 打开网易云';
      artist.textContent = '';
      fill.style.width = '0%';
      if (play) play.textContent = '▶';
      return;
    }
    title.textContent = m.title;
    artist.textContent = (m.artist || m.album || '') +
      (m.duration ? '  ·  ' + fmtTime(m.position) + ' / ' + fmtTime(m.duration) : '');
    const pct = m.duration > 0 ? Math.min(100, (m.position / m.duration) * 100) : 0;
    fill.style.width = pct + '%';
    if (play) play.textContent = m.playing ? '❚❚' : '▶';
    const cover = node.querySelector('.m-cover');
    if (cover) {
      if (m.thumb) {
        cover.style.backgroundImage = 'url(data:image/png;base64,' + m.thumb + ')';
        cover.classList.add('has-art');
      } else {
        cover.style.backgroundImage = '';
        cover.classList.remove('has-art');
      }
    }
    node.classList.toggle('is-playing', !!m.playing);
    if (m.playing) node.classList.remove('is-idle');
    else node.classList.add('is-idle');
  }

  function refreshMusicWidgets() {
    document.querySelectorAll('.music-widget').forEach((n) => paintMusic(n, state.media));
    paintLyric(state.media);
  }

  /* SMTC only reports position every few seconds. Advance the highlight
     locally so the right-hand lyric column scrolls continuously, not in
     4-second jumps. */
  setInterval(() => {
    if (shellIsAsleep() || !lyricMedia || !lyricT0 || !dom.lyric || !dom.lyric.classList.contains('show')) return;
    if (lyricMedia.playing === false) return;
    paintLyric(Object.assign({}, lyricMedia, { position: (Date.now() - lyricT0) / 1000 }));
  }, 500);

  /* ---------- 歌词层：贴边、无容器、永远在组件之下 ---------- */
  let lyricSig = '';
  let lyricCur = -1;
  let lyricMedia = null;
  let lyricT0 = 0;

  function paintLyric(media) {
    const box = dom.lyric;
    if (!box) return;
    const lines = (media && media.lyric) || [];
    if (!media || !media.title || !lines.length) {
      box.classList.remove('show');
      lyricSig = '';
      lyricCur = -1;
      return;
    }
    box.classList.add('show');
    const side = (state.lyricSide === 'left') ? 'left' : 'right';
    box.classList.toggle('left', side === 'left');
    box.classList.toggle('right', side === 'right');

    const sig = [side, media.title, media.artist, lines.length].join('|');
    if (sig !== lyricSig) {
      lyricSig = sig;
      lyricCur = -1;
      lyricT0 = Date.now() - (Number(media.position) || 0) * 1000;
      dom.lyricMeta.innerHTML = '<b>' + escapeHtml(media.title || '') + '</b>'
        + (media.artist ? ' · ' + escapeHtml(media.artist) : '');
      dom.lyricLines.textContent = '';
      lines.forEach((ln, idx) => {
        const el = document.createElement('div');
        el.className = 'lly-line';
        el.dataset.idx = String(idx);
        el.textContent = ln.text;
        dom.lyricLines.appendChild(el);
      });
    }

    lyricMedia = media;
    const pos = Number(media.position) || 0;
    let cur = -1;
    for (let idx = 0; idx < lines.length; idx += 1) {
      if (lines[idx].t <= pos + 0.25) cur = idx; else break;
    }
    if (cur !== lyricCur) {
      lyricCur = cur;
      const nodes = dom.lyricLines.children;
      for (let idx = 0; idx < nodes.length; idx += 1) {
        nodes[idx].classList.toggle('cur', idx === cur);
      }
      /* 把当前行拉到中线：行高 1.85 * 17px ≈ 31.5 */
      const lh = 31.45;
      const shift = Math.max(0, cur) * lh;
      dom.lyricLines.style.transform = 'translateY(' + (-shift) + 'px)';
    }

    const dur = Number(media.duration) || 0;
    if (dom.lyricBar) dom.lyricBar.style.width = dur > 0 ? Math.min(100, (pos / dur) * 100) + '%' : '0%';
  }


  function buildWidget(card) {
    const n = el('div', 'widget');
    n.dataset.cardId = card.id;
    if (card.opacity != null && card.opacity < 1) n.style.opacity = String(card.opacity);
    n.append(el('div', 'widget-head', card.title || ''));
    const body = el('div', 'widget-body');
    n.appendChild(body);

    /* kinds that are just an embedded page: a website, Bilibili, or one of
       the two music players */
    const EMBED = { web: 1, netease: 1, qqmusic: 1 };
    if (EMBED[card.kind]) {
      const wv = document.createElement('webview');
      wv.setAttribute('allowpopups', '');
      /* load straight away: the lazy swap depended on page bookkeeping that no
         longer matches the pixel layout, and left the embed on about:blank */
      wv.setAttribute('src', card.target || 'about:blank');
      body.appendChild(wv);
      n._lazySrc = card.target || 'about:blank';
      wv.addEventListener('dom-ready', () => applyCompactCss(wv, card.kind));
    } else if (card.kind === 'bili') {
      /* pulled feed, rendered as cover + text rows (like the mail inbox),
         not an embedded window */
      body.appendChild(buildBiliPanel(card));
    } else if (card.kind === 'mail') {
      /* real inbox rows, not a second "邮件" label under the card title */
      body.appendChild(buildMailPanel(card));
    }

    n.addEventListener('click', (e) => {
      if (document.body.classList.contains('editing')) return;
      /* bili shows a self-contained feed in the widget itself, so a click
         there should not also pop the full sheet over it */
      if (card.kind === 'bili' || card.kind === 'mail') return;
      if (e.target.closest('webview')) return;
      openSheet(card);
    });
    return n;
  }

  /* One glass hook for every widget path. Text-only cards stay plain (the
     type floats straight on the wallpaper); everything else gets one of the
     three textures, dealt from the layout seed so a re-roll re-textures the
     whole desktop. This used to live only in the data-card branch below,
     which meant mail/web/bili/folder never got a texture at all. */
  const PLAIN_KINDS = { clock: 1, pomodoro: 1, weather: 1, schedule: 1, sys: 1, vpn: 1 };

  function applyGlass(node, card) {
    if (!node || !node.classList || !card) return;
    if (PLAIN_KINDS[card.kind]) {
      node.classList.add('widget-plain');
      return;
    }
    if (!window.PicoLayout) return;
    node.classList.add(card.glass || window.PicoLayout.rollGlass(state.seed || 1, window.PicoLayout.hashString(card.id)));
  }

  function buildCardNode(card) {
    if (card.kind === 'folder') return buildFolderCard(card);
    if (card.kind === 'app') return buildTile(card);
    if (card.kind === 'music') return buildMusicCard(card);
    /* data-driven cards live in cards-extra.js so this file stays readable */
    if (window.PicoCards) {
      const built = window.PicoCards.build(card.kind, card);
      if (built) {
        const n = el('div', 'widget');
        n.dataset.cardId = card.id;
        if (card.opacity != null && card.opacity < 1) n.style.opacity = String(card.opacity);
        n.append(el('div', 'widget-head', card.title || ''));
        built.classList.add('widget-body');
        n.appendChild(built);
        n._dataCard = built;
        if (built._pull) n._pull = built._pull;
        if (built._tick) n._tick = built._tick;
        return n;
      }
    }
    return buildWidget(card);
  }

  /* ---------------- pages ---------------- */


  /* ---------- free placement: per-card rect, drag, resize, opacity ----------
   * Cards used to be grid cells, which forced every card to the same module
   * size. Now each one stores its own {x,y,w,h} in pixels and can be moved
   * and resized independently; the grid is only used to seed a new card's
   * position. */
  /* ---------- unit system -------------------------------------------------
   * 1U = 1/50 of the screen WIDTH, used as a SQUARE unit on BOTH axes.
   * Every card is an integer number of U (shell/layout.js holds the ratio
   * whitelist), so 8U x 10U really is 4:5 instead of "whatever ratio the
   * viewport happened to produce". Safe areas are measured in U as well:
   * 1U side margins, 2U under the status bar, 6U above the bottom edge for
   * the floating glass dock + page dots. --u is published to CSS so the dock
   * inset is driven by the very same unit. */
  const UNIT_DIV = 50;
  const GRID_PAD_U = 1;
  const GRID_TOP_U = 2;
  const GRID_BOTTOM_U = 6;

  function unitSize() { return window.innerWidth / UNIT_DIV; }
  function unitGap() { return Math.max(4, Math.round(unitSize() * 0.16)); }
  function unitGrid() {
    const p = unitSize();
    const rows = Math.max(8,
      Math.floor(window.innerHeight / p) - GRID_TOP_U - GRID_BOTTOM_U);
    return {
      p: p, gap: unitGap(),
      padX: GRID_PAD_U * p, padY: GRID_TOP_U * p,
      cols: UNIT_DIV - 2 * GRID_PAD_U, rows: rows
    };
  }
  function publishUnit() {
    document.documentElement.style.setProperty('--u', unitSize().toFixed(3) + 'px');
  }

  function defaultSlot() {
    const g = unitGrid();
    return { w: 8 * g.p - g.gap, h: 8 * g.p - g.gap };
  }

  function cardRect(card, cell) {
    /* The packed cell is authoritative. A saved pixel rect belongs to an old
       independent-window layout; trusting it here is what stacked cards on
       top of each other and made the grid look random. Only the player keeps
       its square silhouette, and even that is derived from its own cell. */
    const r = unitRect(cell.x || 0, cell.y || 0, cell.w || 1, cell.h || 1);
    return card.kind === 'music' ? squareRect(r) : r;
  }

  /* Snap a pixel rectangle onto the unit grid. Cards keep their own size,
     but every edge lands on a grid line, so a 2x1 sits flush against a 1x1. */
  function snapRect(x, y, w, h) {
    const c = rectToCell({ x: x, y: y, w: w, h: h });
    return unitRect(c.x, c.y, c.w, c.h);
  }

  /* Cell -> pixels. ONE pitch on both axes: a card of uw x uh U measures
     uw*p - gap by uh*p - gap. The gap is half a seam on each side, so two
     adjacent cards are exactly `gap` apart and ratios hold to within that
     seam (<2%). snapRect, unitRect and the packer all speak this geometry. */
  function unitRect(ux, uy, uw, uh) {
    const g = unitGrid();
    return {
      x: Math.round(g.padX + ux * g.p + g.gap / 2),
      y: Math.round(g.padY + uy * g.p + g.gap / 2),
      w: Math.round(uw * g.p - g.gap),
      h: Math.round(uh * g.p - g.gap),
    };
  }

  /* Pixels -> cell. Used at drag/resize end to put a card back into cell
     space before the overlap resolver runs. */
  function rectToCell(rect) {
    const g = unitGrid();
    const cols = state.cols || g.cols;
    const rows = state.rows || g.rows;
    const uw = Math.max(1, Math.min(cols, Math.round((rect.w + g.gap) / g.p)));
    const uh = Math.max(1, Math.min(rows, Math.round((rect.h + g.gap) / g.p)));
    const ux = Math.max(0, Math.min(cols - uw,
      Math.round((rect.x - g.padX - g.gap / 2) / g.p)));
    const uy = Math.max(0, Math.min(rows - uh,
      Math.round((rect.y - g.padY - g.gap / 2) / g.p)));
    return { x: ux, y: uy, w: uw, h: uh };
  }

  /* A display/DPI change only changes the size of U. Repaint the existing
     rectangles in place instead of tearing down every webview. */
  function reapplyUnitRects() {
    const g = unitGrid();
    state.cols = g.cols;
    state.rows = g.rows;
    state.pages.forEach((pg) => {
      (pg.cells || []).forEach((cell) => {
        const card = state.cards.get(cell.cardId);
        if (!card) return;
        const r = cardRect(card, cell);
        card.rect = r;
        const node = dom.pages.querySelector(
          '.widget[data-card-id="' + cell.cardId + '"]');
        if (!node) return;
        node.style.left = r.x + 'px';
        node.style.top = r.y + 'px';
        node.style.width = r.w + 'px';
        node.style.height = r.h + 'px';
      });
    });
  }

  /* The player is the one card that must stay 1:1: a 1x1 cell is only square
     by accident of the viewport, so the rect is squared inside its cell. */
  function squareRect(rect) {
    const s = Math.min(rect.w, rect.h);
    return {
      x: Math.round(rect.x + (rect.w - s) / 2),
      y: Math.round(rect.y + (rect.h - s) / 2),
      w: Math.round(s),
      h: Math.round(s),
    };
  }

  /* ---------------- GridPack: arrange / re-roll / overlap resolver --------
   * Cards are packed into cells before they are drawn, so overlap is
   * impossible by construction; spans come from a seeded weighted pool, so a
   * re-roll yields a different Tetris mix instead of a uniform grid. */

  function shellCards() {
    const out = [];
    state.cards.forEach((c) => { if (c && c.kind !== 'pet') out.push(c); });
    return out;
  }

  /* Returns true when the layout was (re)built. A saved layout is left alone
     unless the card set changed, so hand-dragged cards survive a reboot. */
  function arrangeLayout(seed, force) {
    if (!window.PicoLayout) return false;
    const cards = shellCards();
    const sig = cards.map((c) => c.id).sort().join(',');
    /* A matching signature only means "do not re-pack". The rects still have
       to be rebuilt from the packed cells: main.js re-packs single-screen
       layouts on every boot, and cardRect() prefers a stored pixel rect. That
       combination used to freeze every card into the same 1xN sliver and
       silently discard the seeded long/short mix. */
    const replay = !force && state.layoutSig === sig &&
                   state.seed != null && state.pages.length > 0;
    state.seed = ((seed == null ? (state.seed || 1) : seed) >>> 0) || 1;
    state.layoutSig = sig;
    if (!replay) {
      const spans = window.PicoLayout.assignSpans(cards, state.seed);
      const items = cards.map((c) => ({ id: c.id, w: spans[c.id][0], h: spans[c.id][1] }));
      const packed = window.PicoLayout.pack(items, state.cols, state.rows);
      state.pages = packed.map((cells, i) => ({
        id: 'p' + (i + 1),
        name: '场景' + (i + 1),
        cells: cells,
      }));
    }
    /* balanced glass: every texture gets an equal share of the glass-eligible
       cards, then a seeded shuffle decides which card wears which texture */
    const glassIds = cards.filter((c) => !PLAIN_KINDS[c.kind]).map((c) => c.id);
    const glassMap = window.PicoLayout.buildGlassMap(glassIds, state.seed);
    state.pages.forEach((pg, pi) => {
      (pg.cells || []).forEach((cell) => {
        const card = state.cards.get(cell.cardId);
        if (!card) return;
        card.page = pi;
        card.spanW = cell.w;
        card.spanH = cell.h;
        if (!PLAIN_KINDS[card.kind]) card.glass = glassMap[card.id] || 'glass-frosted';
        const r = unitRect(cell.x, cell.y, cell.w, cell.h);
        card.rect = card.kind === 'music' ? squareRect(r) : r;
      });
    });
    if (state.current >= state.pages.length) state.current = Math.max(0, state.pages.length - 1);
    return !replay;
  }

  function persistLayout() {
    if (!API.setLayout) return;
    const cards = [];
    state.cards.forEach((c) => {
      if (!c || c.kind === 'pet' || !c.rect) return;
      cards.push({
        id: c.id,
        page: c.page || 0,
        spanW: c.spanW || 1,
        spanH: c.spanH || 1,
        rect: c.rect,
      });
    });
    API.setLayout({
      seed: state.seed || 1,
      sig: state.layoutSig || '',
      cols: state.cols || 4,
      rows: state.rows || 3,
      pages: state.pages.map((p) => ({ id: p.id, name: p.name, cells: p.cells })),
      cards: cards,
    });
  }

  /* Edit-mode action: deal a fresh seed -> fresh spans -> fresh pack. */
  function rerollLayout() {
    if (!arrangeLayout((Math.floor(Math.random() * 0x7ffffffe) || 1) + 1, true)) return;
    persistLayout();
    renderPages();
    document.body.classList.add('rerolling');
    setTimeout(() => document.body.classList.remove('rerolling'), 420);
  }

  /* Write cells back to the card objects AND to the live DOM nodes, so a
     displaced card slides aside instead of waiting for the next re-render. */
  function applyCells(cells, pageIdx) {
    cells.forEach((c) => {
      const card = state.cards.get(c.cardId);
      if (!card) return;
      card.page = pageIdx;
      const r = unitRect(c.x, c.y, c.w, c.h);
      card.rect = card.kind === 'music' ? squareRect(r) : r;
      const node = dom.pages.querySelector('.widget[data-card-id="' + c.cardId + '"]');
      if (node) {
        node.style.transition = 'left .16s ease, top .16s ease, width .16s ease, height .16s ease, transform .22s cubic-bezier(.34,1.56,.64,1)';
        node.style.left = r.x + 'px';
        node.style.top = r.y + 'px';
        node.style.width = r.w + 'px';
        node.style.height = r.h + 'px';
        setTimeout(() => { node.style.transition = ''; }, 180);
      }
      if (API.setCardRect) API.setCardRect(card.id, r);
    });
  }

  /* Drag/resize end: snap to a cell, then push away anyone the card now
     covers. This is the second no-overlap guarantee on top of packing. */
  function commitDrag(card, node) {
    card.rect = snapRect(node.offsetLeft, node.offsetTop, node.offsetWidth, node.offsetHeight);
    /* a resize changes the span too -- the overlap resolver reads spans, so a
       stale one would let the next drag drop a card on top of this one.
       Snap the dropped size back to the nearest allowed U ratio. */
    const cell = rectToCell(card.rect);
    if (window.PicoLayout && window.PicoLayout.snapShape) {
      const snapped = window.PicoLayout.snapShape(cell.w, cell.h);
      cell.w = snapped[0];
      cell.h = snapped[1];
      card.rect = unitRect(cell.x, cell.y, cell.w, cell.h);
    }
    card.spanW = cell.w;
    card.spanH = cell.h;
    if (API.setCardRect) API.setCardRect(card.id, card.rect);
    resolveOverlap(card);
    if (typeof publishHitRects === 'function') publishHitRects();
  }

  function resolveOverlap(moved) {
    /* locate the page that actually holds this card's cell in the model.
       `moved.page` can lag behind after re-rolls/re-packs, so never trust it
       alone -- a stale page index makes us resolve on the wrong page and leave
       two cards overlapping. */
    let pageIdx = -1;
    for (let i = 0; i < state.pages.length; i += 1) {
      if ((state.pages[i].cells || []).some((c) => c.cardId === moved.id)) { pageIdx = i; break; }
    }
    if (pageIdx < 0) pageIdx = (moved.page != null ? moved.page : state.current) | 0;
    const page = state.pages[pageIdx];
    if (!page || !window.PicoLayout) return;
    const cell = rectToCell(moved.rect);
    const cells = [];
    (page.cells || []).forEach((c) => {
      const cd = state.cards.get(c.cardId);
      if (!cd || cd.kind === 'pet') return;
      cells.push({
        cardId: c.cardId, x: c.x, y: c.y,
        w: cd.spanW || c.w || 1, h: cd.spanH || c.h || 1,
      });
    });
    const mine = cells.filter((c) => c.cardId === moved.id)[0];
    if (!mine) return;
    mine.x = cell.x;
    mine.y = cell.y;
    mine.w = cell.w;
    mine.h = cell.h;
    const res = window.PicoLayout.resolveOnPage(cells, state.cols, state.rows, moved.id);
    page.cells = res.cells;
    applyCells(res.cells, pageIdx);
    if (res.overflow.length) {
      /* Cards pushed off this page need a new home. A naive append onto another
         page would drop them at their old coordinates and overlap whatever is
         already there, so re-fit them into free space across the existing pages
         (creating new pages only when every existing page is full). */
      const tried = [pageIdx];
      let moving = res.overflow.slice();
      let guard = 0;
      while (moving.length && guard < 128) {
        guard += 1;
        let hostIdx = -1;
        for (let k = 0; k < state.pages.length; k += 1) {
          if (tried.indexOf(k) >= 0) continue;
          hostIdx = k;
          break;
        }
        if (hostIdx < 0) {
          state.pages.push({
            id: 'p' + (state.pages.length + 1),
            name: '场景' + (state.pages.length + 1),
            cells: [],
          });
          hostIdx = state.pages.length - 1;
        }
        tried.push(hostIdx);
        const hostCells = (state.pages[hostIdx].cells || []).map((c) => {
          const cd = state.cards.get(c.cardId);
          return {
            cardId: c.cardId, x: c.x, y: c.y,
            w: cd ? (cd.spanW || c.w || 1) : (c.w || 1),
            h: cd ? (cd.spanH || c.h || 1) : (c.h || 1),
          };
        });
        const combined = hostCells.concat(moving);
        const r2 = window.PicoLayout.resolveOnPage(combined, state.cols, state.rows, null);
        state.pages[hostIdx].cells = r2.cells;
        r2.cells.forEach((c) => {
          const cd = state.cards.get(c.cardId);
          if (!cd) return;
          cd.page = hostIdx;
          const r = unitRect(c.x, c.y, c.w, c.h);
          cd.rect = cd.kind === 'music' ? squareRect(r) : r;
          cd.spanW = c.w;
          cd.spanH = c.h;
        });
        moving = r2.overflow;
      }
      persistLayout();
      renderPages();
      return;
    }
    persistLayout();
  }

  function attachCardGestures(node, card) {
    const handle = el('div', 'card-resize');
    node.appendChild(handle);

    /* move: drag the header strip only, so webview scrolls still work */
    const head = node.querySelector('.widget-head');
    if (head) {
      head.style.cursor = 'grab';
      head.addEventListener('pointerdown', (ev) => {
        if (document.body.classList.contains('editing')) return;
        ev.preventDefault();
        const startX = ev.clientX, startY = ev.clientY;
        const r = { x: node.offsetLeft, y: node.offsetTop };
        head.setPointerCapture(ev.pointerId);
        const move = (e2) => {
          const nx = Math.max(0, r.x + (e2.clientX - startX));
          const ny = Math.max(0, r.y + (e2.clientY - startY));
          node.style.left = nx + 'px';
          node.style.top = ny + 'px';
        };
        const up = () => {
          head.removeEventListener('pointermove', move);
          head.removeEventListener('pointerup', up);
          commitDrag(card, node);
        };
        head.addEventListener('pointermove', move);
        head.addEventListener('pointerup', up);
      });
    }

    /* resize: bottom-right corner */
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const startX = ev.clientX, startY = ev.clientY;
      const w0 = node.offsetWidth, h0 = node.offsetHeight;
      handle.setPointerCapture(ev.pointerId);
      const move = (e2) => {
        node.style.width = Math.max(160, w0 + (e2.clientX - startX)) + 'px';
        node.style.height = Math.max(120, h0 + (e2.clientY - startY)) + 'px';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        commitDrag(card, node);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });

    /* opacity: right-click (or long-press on touch) opens a slider */
    node.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      openCardOpacity(card, node, ev.clientX, ev.clientY);
    });
  }

  function openCardOpacity(card, node, cx, cy) {
    let pop = document.getElementById('opacityPop');
    if (pop) pop.remove();
    pop = el('div', 'opacity-pop');
    pop.id = 'opacityPop';
    const label = el('span', 'opacity-label', '透明度 ' + Math.round((card.opacity != null ? card.opacity : 1) * 100) + '%');
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '25';
    range.max = '100';
    range.value = String(Math.round((card.opacity != null ? card.opacity : 1) * 100));
    range.addEventListener('input', () => {
      const v = Number(range.value) / 100;
      node.style.opacity = String(v);
      card.opacity = v;
      label.textContent = '透明度 ' + range.value + '%';
    });
    range.addEventListener('change', () => {
      if (API.setCardOpacity) API.setCardOpacity(card.id, card.opacity);
    });
    pop.appendChild(label);
    pop.appendChild(range);
    pop.style.left = Math.min(cx, window.innerWidth - 220) + 'px';
    pop.style.top = Math.min(cy, window.innerHeight - 90) + 'px';
    document.body.appendChild(pop);
    const close = (e) => {
      if (pop.contains(e.target)) return;
      pop.remove();
      document.removeEventListener('pointerdown', close);
    };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
  }

  function renderPages() {
    dom.pages.innerHTML = '';
    const frag = document.createDocumentFragment();

    state.pages.forEach((page) => {
      const p = el('div', 'page');
      p.style.setProperty('--cols', state.cols);
      p.style.setProperty('--rows', state.rows);
      /* Last line of defence: even a hand-edited or legacy layout cannot
         paint two cards onto the same cell. */
      if (window.PicoLayout && (page.cells || []).length) {
        const fixed = window.PicoLayout.resolveOnPage(
          page.cells, state.cols, state.rows, null);
        if (fixed && !fixed.overflow.length) page.cells = fixed.cells;
      }
      (page.cells || []).forEach((cell) => {
        const card = state.cards.get(cell.cardId);
        if (!card) return;
        const node = buildCardNode(card);
        applyGlass(node, card);
        /* Free placement: every card carries its own pixel rectangle, so the
           four cards never have to be the same size. `cell` supplies the
           starting point; the user can then drag/resize it independently. */
        const rect = cardRect(card, cell);
        node.style.left = rect.x + 'px';
        node.style.top = rect.y + 'px';
        node.style.width = rect.w + 'px';
        node.style.height = rect.h + 'px';
        if (card.opacity != null) node.style.opacity = String(card.opacity);
        node.dataset.cardId = card.id;
        attachCardGestures(node, card);
        p.appendChild(node);
      });
      frag.appendChild(p);
    });

    dom.pages.appendChild(frag);
    dom.pages.style.transition = 'transform ' + DUR + 'ms ' + EASE;
    renderDots();
    applyPage(state.current, false);
    swapIframes();
  }

  function renderDots() {
    dom.dots.innerHTML = '';
    state.pages.forEach((_, i) => {
      const d = el('i');
      if (i === state.current) d.classList.add('on');
      d.addEventListener('click', () => goTo(i));
      dom.dots.appendChild(d);
    });
  }

  function setPagePaint(keepA, keepB) {
    const nodes = dom.pages.querySelectorAll('.page');
    for (let k = 0; k < nodes.length; k++) {
      nodes[k].classList.toggle('page-off', k !== keepA && k !== keepB);
    }
  }

  function applyPage(i, animate) {
    const max = Math.max(0, state.pages.length - 1);
    const prev = state.current;
    state.current = Math.max(0, Math.min(max, i));
    /* Both the outgoing and the incoming page must be painted during the
       slide. Everything else is skipped. Afterwards only the current page
       stays in the compositor. */
    setPagePaint(state.current, animate ? prev : -1);
    if (pageVisTimer) { clearTimeout(pageVisTimer); pageVisTimer = null; }
    if (!animate) {
      dom.pages.style.transition = 'none';
      dom.pages.style.transform = 'translateX(' + (-state.current * 100) + '%)';
      void dom.pages.offsetWidth;
      dom.pages.style.transition = 'transform ' + DUR + 'ms ' + EASE;
    } else {
      /* Webviews are the expensive part of a page flip. Take them out of the
         compositor for the 200ms transform, then put them straight back. */
      dom.pages.classList.add('paging');
      if (pagingTimer) clearTimeout(pagingTimer);
      pagingTimer = setTimeout(() => dom.pages.classList.remove('paging'), DUR + 20);
      dom.pages.style.transform = 'translateX(' + (-state.current * 100) + '%)';
      if (prev !== state.current) {
        pageVisTimer = setTimeout(() => {
          setPagePaint(state.current, -1);
          pageVisTimer = null;
        }, DUR + 20);
      }
    }
    const dots = dom.dots.children;
    for (let k = 0; k < dots.length; k++) dots[k].classList.toggle('on', k === state.current);
    const page = state.pages[state.current];
    swapIframes();
  }

  function goTo(i) {
    applyPage(i, true);
    /* remember the scene: a reboot must land on the widgets the user left
       visible, not silently jump back to page 0 */
    if (API.setBootPage) API.setBootPage(state.current);
  }

  /* Only the CURRENT page keeps live webviews. Every off-screen page goes to
     about:blank, which actually stops its renderer work - `visibility:hidden`
     suppresses paint but leaves timers, video and network running inside the
     guest. Page order in #pages matches state.pages, so the index is the page
     number. Restoring from _lazySrc on re-entry is a normal navigation. */
  function swapIframes() {
    const pages = dom.pages.querySelectorAll('.page');
    for (let pi = 0; pi < pages.length; pi += 1) {
      const live = pi === state.current;
      pages[pi].querySelectorAll('.widget').forEach((node) => {
        const wv = node.querySelector('webview');
        if (!wv) return;
        const want = live ? (node._lazySrc || 'about:blank') : 'about:blank';
        if (wv.getAttribute('src') === want) return;
        wv.setAttribute('src', want);
        if (want !== 'about:blank') {
          const card = state.cards.get(node.dataset.cardId);
          const kind = card && card.kind;
          const once = () => {
            wv.removeEventListener('dom-ready', once);
            applyCompactCss(wv, kind);
          };
          wv.addEventListener('dom-ready', once);
        }
      });
    }
  }

  /* Win+Shift+D hands the desktop back to Explorer: the shell window is only
     HIDDEN, not closed. A hidden transparent window still keeps its webviews,
     CSS animations and per-second card timers alive, so "switch to native"
     used to leave the whole shell burning CPU/GPU behind the user's back.
     Park everything while native and restore the live page on the way back.
     Zero visual change: the window is invisible for the entire sleep. */
  let shellAsleep = false;
  function setShellAsleep(on) {
    on = !!on;
    if (shellAsleep === on) return;
    shellAsleep = on;
    document.body.classList.toggle('shell-asleep', on);
    if (on) {
      if (typeof hideGlassMenu === 'function') hideGlassMenu();
      dom.pages.querySelectorAll('webview').forEach((wv) => {
        if (wv.getAttribute('src') !== 'about:blank') wv.setAttribute('src', 'about:blank');
      });
      dom.wallpaper.querySelectorAll('video').forEach((v) => {
        try { v.pause(); } catch (e) {}
      });
    } else {
      /* _lazySrc survived the sleep, so this is a normal page navigation;
         no card data, layout or dock state is rebuilt. */
      swapIframes();
      dom.wallpaper.querySelectorAll('video').forEach((v) => {
        try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
      });
      publishHitRects();
    }
  }
  function shellIsAsleep() { return shellAsleep; }

  /* ---------------- glass taskbar ----------------
   * One independent glass block per item: fixed cards, live Windows, then the
   * clock. The three glass kinds cycle evenly, so no kind dominates. Window
   * state is polled at a low rate; a foreground change only flips classes. */
  const DOCK_GLASS = ['glass-liquid', 'glass-frosted', 'glass-fluted'];
  const DOCK_MAX_WINDOWS = 4;   /* pinned icons now take fixed slots */
  let dockSig = '';
  let dockWindows = [];
  let dockBusy = false;
  let dockPoller = null;
  let dockFirstTimer = null;

  function dockIcon(b64) { return b64 ? 'data:image/png;base64,' + b64 : ''; }

  function dockBlock(glass, opt) {
    const b = el('div', 'dock-item ' + glass);
    if (opt.icon) {
      const img = el('img', 'di-icon');
      img.src = opt.icon;
      img.alt = '';
      b.appendChild(img);
    } else {
      b.appendChild(el('span', 'di-glyph', opt.glyph || '\u00B7'));
    }
    if (opt.text) b.appendChild(el('span', 'di-text', opt.text));
    b.appendChild(el('i', 'di-dot'));
    if (opt.title) b.title = opt.title;
    if (opt.win) {
      b.dataset.win = opt.win.hwnd;
      b.classList.add('is-running');
      b.classList.toggle('is-active', !!opt.win.active);
      b.classList.toggle('is-min', !!opt.win.min);
    }
    b.addEventListener('click', opt.onClick || function () {});
    return b;
  }

  function dockBlockForWindow(w) {
    return {
      key: 'win:' + w.hwnd,
      win: w,
      icon: dockIcon(w.icon),
      glyph: (w.title || '\u00B7').slice(0, 1),
      text: w.title || '',
      title: w.title || '',
      onClick: () => {
        if (!API.taskbar) return;
        /* the poll may be up to 12s stale - read the freshest snapshot so an
           active window is minimised, not activated twice */
        const live = dockWindows.find((x) => x.hwnd === w.hwnd) || w;
        API.taskbar(live.active ? 'minimize' : 'activate', live.hwnd).catch(() => {});
        setTimeout(refreshDockWindows, 350);
      }
    };
  }

  /* Original pinned Windows taskbar icons. They live on the folder card as
     source:'taskbar' shortcuts, already carrying their extracted icons. */
  function pinnedDockItems() {
    var seen = {};
    var out = [];
    if (!state.cards || !state.cards.forEach) return out;
    state.cards.forEach(function (c) {
      if (!c || c.kind !== 'folder' || !Array.isArray(c.items)) return;
      c.items.forEach(function (it) {
        if (!it || it.source !== 'taskbar' || !it.title) return;
        var k = String(it.title).toLowerCase();
        if (seen[k]) return;
        seen[k] = 1;
        out.push({
          key: 'pinned:' + k,
          icon: it.icon || '',
          glyph: String(it.title).slice(0, 1),
          text: it.title,
          title: it.title,
          onClick: function () {
            if (it.target && API.launchPath) API.launchPath(it.target).catch(function () {});
            else if (it.id) API.launchCard(it.id);
          }
        });
      });
    });
    return out;
  }

  function dockDescriptor() {
    /* Start, Search, the original PINNED taskbar shortcuts (real icons),
       running windows not already covered by a pinned block, Desktop,
       notification centre and clock. The desktop pet is filtered upstream. */
    var items = [
      {
        key: 'start', glyph: '\u25C9', text: '\u5F00\u59CB',
        title: '\u5F00\u59CB\u83DC\u5355 (Win)',
        onClick: function () { openStartMenu(); }
      },
      {
        key: 'search', glyph: '\u2315', text: '\u641C\u7D22',
        title: '\u641C\u7D22 (Win+S)',
        onClick: function () { if (API.taskbar) API.taskbar('search').catch(function () {}); }
      }
    ];
    /* pinned icons first, then only the running windows that are not already
       represented by one of those pinned blocks */
    var pinned = pinnedDockItems();
    pinned.forEach(function (p) { items.push(p); });
    var pinnedNames = pinned.map(function (p) { return String(p.text || '').toLowerCase(); });
    var live = dockWindows.filter(function (w) {
      var t = String(w.title || '').toLowerCase();
      return !pinnedNames.some(function (n) { return n && t.indexOf(n) >= 0; });
    });
    var rest = live.slice(DOCK_MAX_WINDOWS);
    live.slice(0, DOCK_MAX_WINDOWS).forEach(function (w) { items.push(dockBlockForWindow(w)); });
    if (rest.length) {
      items.push({
        key: 'more', glyph: '\uFF0B', text: '+' + rest.length,
        title: '\u66F4\u591A\u7A97\u53E3', onClick: function () { openWindowList(rest); }
      });
    }
    items.push({
      key: 'desktop', glyph: '\u25AD', text: '\u684C\u9762',
      title: '\u5207\u6362\u539F\u751F\u684C\u9762 / Pico RamOS (Win+Shift+D)',
      onClick: function () { if (API.desktopToggle) API.desktopToggle().catch(function () {}); }
    });
    items.push({
      key: 'notify', glyph: '\u2637', text: '\u901A\u77E5',
      title: '\u5FEB\u901F\u8BBE\u7F6E (Win+A)',
      onClick: function () { if (API.taskbar) API.taskbar('notify').catch(function () {}); }
    });
    items.push(imeDescriptor());
    return items;
  }

  function dockSigOf() {
    /* foreground state is intentionally excluded: it only flips a class */
    return JSON.stringify(dockWindows.map(function (w) { return [w.hwnd, w.title, w.min]; }));
  }

  /* ---- IME indicator -------------------------------------------------
   * One glass block that reads the LIVE Windows input method: big 中/英/EN
   * plus the language name. Updated in place from a main-process push, so
   * it never rebuilds the dock (no flicker, no layout work). */
  let imeLabelNode = null, imeNameNode = null, imeBlockNode = null;
  let imeState = { label: '--', lang: '', open: false, name: '' };

  function imeDescriptor() {
    return {
      key: 'ime', glyph: '\u4E2D', text: '',
      title: '\u8F93\u5165\u6CD5\u72B6\u6001\uFF08\u70B9\u51FB\u5207\u6362\uFF09',
      onClick: function () { if (API.taskbar) API.taskbar('ime-toggle').catch(function () {}); }
    };
  }

  function buildDockIme(glass) {
    const b = el('div', 'dock-item dock-ime ' + glass);
    const g = el('span', 'di-glyph di-ime-label', '--');
    const n = el('span', 'di-text di-ime-name', '\u8F93\u5165\u6CD5');
    b.appendChild(g);
    b.appendChild(n);
    b.appendChild(el('i', 'di-dot'));
    b.title = '\u8F93\u5165\u6CD5\u72B6\u6001\uFF08\u70B9\u51FB\u5207\u6362\uFF09';
    imeLabelNode = g;
    imeNameNode = n;
    imeBlockNode = b;
    applyImeState(imeState);
    return b;
  }

  function applyImeState(st) {
    if (!st) return;
    /* keep the desktop-mode flag across IME pushes (the main process pushes
       those without it) */
    imeState = Object.assign({ shellNative: !!imeState.shellNative }, st);
    st = imeState;
    if (imeLabelNode) imeLabelNode.textContent = st.label || '--';
    if (imeNameNode) imeNameNode.textContent = st.name || st.lang || '';
    if (imeBlockNode) {
      imeBlockNode.dataset.open = st.open ? '1' : '0';
      imeBlockNode.dataset.lang = st.lang || '';
      imeBlockNode.title = '\u5F53\u524D\u8F93\u5165\u6CD5\uFF1A' + (st.name || st.lang || '--') +
        ' \u00B7 ' + (st.label || '--') + (st.lang ? ' [' + st.lang + ']' : '') +
        '\n\u70B9\u51FB\u5207\u6362\u8F93\u5165\u6CD5 (Win+Space)';
      imeBlockNode.classList.toggle('is-native-shell', !!st.shellNative);
    }
  }

  function buildDockClock(glass) {
    const b = el('div', 'dock-item dock-clock ' + glass);
    b.appendChild(el('div', 'di-time', '--:--'));
    b.appendChild(el('div', 'di-date', '--/--'));
    b.appendChild(el('i', 'di-dot'));
    b.title = '\u65F6\u949F';
    return b;
  }

  function renderDock() {
    if (!dom.dock) return;
    dom.dock.style.display = '';
    const items = dockDescriptor();
    dockSig = dockSigOf();
    dom.dock.innerHTML = '';
    /* the IME descriptor is the last entry: peel it off so it gets its own
       compact block instead of the generic glyph+text treatment */
    items.pop();   /* drop the IME descriptor: it gets its own compact block */
    items.forEach(function (it, i) {
      dom.dock.appendChild(dockBlock(DOCK_GLASS[i % DOCK_GLASS.length], it));
    });
    dom.dock.appendChild(buildDockIme(DOCK_GLASS[items.length % DOCK_GLASS.length]));
    dom.dock.appendChild(buildDockClock(DOCK_GLASS[(items.length + 1) % DOCK_GLASS.length]));
    tick();
    publishHitRects();
    startDockPoller();
  }

  async function refreshDockWindows() {
    if (!dom.dock || dockBusy || shellIsAsleep() || document.hidden || !API.taskbar) return;
    dockBusy = true;
    let rows = null;
    try {
      const r = await API.taskbar('list');
      if (r && r.ok && Array.isArray(r.data)) rows = r.data;
    } catch (e) { /* host not up yet: keep the fixed blocks */ }
    dockBusy = false;
    if (!rows) return;
    /* double guard: the PowerShell host also filters these, but a stale host
       process (or an older script) must not put the desktop pet back */
    dockWindows = rows.filter(function (w) {
      var s = String(w.title || '') + ' ' + String(w.exe || '');
      return !/DSH Desktop Beta|\.dsh-beta|dsh-pet|桌宠/i.test(s);
    });
    if (dockSigOf() !== dockSig) { renderDock(); return; }
    /* only the foreground window changed: no DOM rebuild, no flicker */
    const nodes = dom.dock.querySelectorAll('.dock-item[data-win]');
    for (let i = 0; i < nodes.length; i += 1) {
      const w = rows.find((x) => x.hwnd === nodes[i].dataset.win);
      nodes[i].classList.toggle('is-running', !!w);
      nodes[i].classList.toggle('is-active', !!w && !!w.active);
      nodes[i].classList.toggle('is-min', !!w && !!w.min);
    }
  }

  function startDockPoller() {
    if (dockPoller || !API.taskbar) return;
    /* The first scan spawns the resident Win32 host (and its one-off C#
       compile) plus a full icon extraction pass. Doing that in the same frame
       as the shell's first paint was the launch CPU spike. Let the window
       settle first, then scan; 12 s is plenty for a taskbar. */
    const first = setTimeout(refreshDockWindows, 900);
    dockPoller = setInterval(refreshDockWindows, 12000);
    if (dockFirstTimer) clearTimeout(dockFirstTimer);
    dockFirstTimer = first;
  }

  function openWindowList(rows) {
    dom.drawer.hidden = true;
    dom.sheet.hidden = false;
    dom.sheetTitle.textContent = '\u66F4\u591A\u7A97\u53E3';
    dom.sheetBody.innerHTML = '';
    dom.sheetBody.style.padding = '16px 20px';
    const list = el('div', 'dock-win-list');
    rows.forEach((w) => {
      const row = el('div', 'dock-win-row');
      if (w.icon) {
        const img = el('img', 'di-icon');
        img.src = dockIcon(w.icon);
        img.alt = '';
        row.appendChild(img);
      }
      row.appendChild(el('span', '', w.title || ''));
      row.addEventListener('click', () => {
        closeAll();
        if (API.taskbar) API.taskbar('activate', w.hwnd).catch(() => {});
        setTimeout(refreshDockWindows, 350);
      });
      list.appendChild(row);
    });
    dom.sheetBody.appendChild(list);
    publishHitRects();
  }

  /* ---------------- sheets ---------------- */

  function closeAll() {
    window.__drawerOpen = false;
    dom.drawer.hidden = true;
    dom.drawer.classList.remove('open');
    dom.sheet.hidden = true;
    dom.sheetBody.innerHTML = '';
    publishHitRects();
  }

  function openSheet(card) {
    dom.drawer.hidden = true;
    dom.drawer.classList.remove('open');
    dom.sheet.hidden = false;
    dom.sheetTitle.textContent = card.title || '';
    dom.sheetBody.innerHTML = '';
    if (card.kind === 'web') {
      const wv = document.createElement('webview');
      wv.src = card.target || 'about:blank';
      wv.setAttribute('allowpopups', '');
      wv.style.width = '100%';
      wv.style.height = '100%';
      dom.sheetBody.appendChild(wv);
      dom.sheetBody.style.padding = '0';
    } else if (card.kind === 'bili') {
      dom.sheetBody.style.padding = '0';
      dom.sheetBody.appendChild(buildBiliPanel(card));
    } else if (card.kind === 'mail') {
      dom.sheetBody.style.padding = '0';
      dom.sheetBody.appendChild(buildMailPanel(card));
    } else {
      dom.sheetBody.style.padding = '16px 20px';
      dom.sheetBody.appendChild(el('div', '', card.title || ''));
    }
    dom.sheet.animate(
      [{ transform: 'scale(.86)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
      { duration: 240, easing: EASE }
    );
    publishHitRects();
  }


  /* ---------- mail composer ----------
   * The renderer never holds the SMTP auth code: it names the account by index
   * and main resolves the credentials it already stores. */
  /* Mail shows as three views inside one sheet: the inbox list, a single
     message, and the composer. Previously only the composer existed, so the
     card could send but never show what arrived. */
  function buildMailPanel(card) {
    const wrap = el('div', 'mail');

    /* One fetch shared by the veil counter and the inbox list, so hiding the
       inbox does not mean hitting IMAP twice. */
    let mailPromise = null;
    function loadMail() {
      if (!mailPromise) {
        mailPromise = (API.mailFetch ? API.mailFetch(12) : Promise.resolve([]))
          .catch(function () { return []; });
      }
      return mailPromise;
    }
    function messagesOf(r) {
      const accts = Array.isArray(r) ? r : (r && r.accounts) || [];
      const list = [];
      accts.forEach((a) => {
        if (a && Array.isArray(a.messages)) a.messages.forEach((m) => list.push(m));
      });
      return list;
    }
    /* Privacy without a coloured plate: CSS hides the tabs / inbox DOM while
       idle, this colourless layer only carries the hover hint. Hovering the
       card (or one click) reveals the messages; leaving re-arms it. */
    const veil = el('div', 'mail-veil');
    const veilCount = el('div', 'mail-veil-count', '…');
    const veilHint = el('div', 'mail-veil-hint', '悬停查看邮件');
    veil.appendChild(veilCount);
    veil.appendChild(veilHint);
    const badge = el('div', 'mail-badge', '…');
    loadMail().then((r) => {
      const n = messagesOf(r).filter((m) => m && m.unread).length;
      badge.textContent = n > 0 ? (n + ' 封未读') : '无未读';
      badge.classList.toggle('has-mail', n > 0);
      veilCount.textContent = n > 0 ? (n + ' 封未读') : '暂无未读';
      veil.classList.toggle('has-mail', n > 0);
    });
    wrap.appendChild(badge);
    wrap.appendChild(veil);

    const tabs = el('div', 'mail-tabs');
    const tabIn = el('button', 'mail-tab on', '收件箱');
    const tabNew = el('button', 'mail-tab', '写信');
    tabIn.type = 'button';
    tabNew.type = 'button';
    tabs.appendChild(tabIn);
    tabs.appendChild(tabNew);
    wrap.appendChild(tabs);

    const pane = el('div', 'mail-pane');
    wrap.appendChild(pane);

    function show(view) {
      tabIn.classList.toggle('on', view !== 'compose');
      tabNew.classList.toggle('on', view === 'compose');
      pane.innerHTML = '';
      if (view === 'compose') pane.appendChild(buildComposer(card));
      else if (view === 'list') pane.appendChild(buildInbox());
      else pane.appendChild(view);
    }

    function buildInbox() {
      const box = el('div', 'mail-list');
      box.appendChild(el('div', 'mail-empty', '正在收取…'));
      const account = (state.mailAccounts || [])[0];
      if (!account) {
        box.innerHTML = '';
        box.appendChild(el('div', 'mail-empty', '先去配置里填邮箱账号'));
        return box;
      }
      (async () => {
        const r = await loadMail();
        box.innerHTML = '';
        /* main returns one entry per account: {account, messages[]} or {account, error} */
        const accts = Array.isArray(r) ? r : (r && r.accounts) || [];
        const list = [];
        const errs = [];
        accts.forEach((a) => {
          if (!a) return;
          if (a.error) errs.push((a.account || '账号') + '：' + a.error);
          if (Array.isArray(a.messages)) a.messages.forEach((m) => list.push(m));
        });
        if (!list.length && errs.length) {
          errs.forEach((t) => box.appendChild(el('div', 'mail-empty', t)));
          return;
        }
        if (!list.length) {
          box.appendChild(el('div', 'mail-empty', '收件箱是空的'));
          return;
        }
        list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
        list.slice(0, 12).forEach((m) => {
          const row = el('div', 'mail-row');
          if (m.unread) row.classList.add('unread');
          row.appendChild(el('div', 'mail-from', m.from || '—'));
          row.appendChild(el('div', 'mail-subject', m.subject || '(无主题)'));
          const when = m.date ? String(m.date).replace('T', ' ').slice(0, 16) : '';
          if (when) row.appendChild(el('div', 'mail-when', when));
          row.addEventListener('click', () => show(buildMessage(m)));
          box.appendChild(row);
        });
      })();
      return box;
    }

    function buildMessage(m) {
      const one = el('div', 'mail-one');
      const back = el('button', 'mail-back', '← 收件箱');
      back.type = 'button';
      back.addEventListener('click', () => show('list'));
      one.appendChild(back);
      one.appendChild(el('div', 'mail-one-subject', m.subject || '(无主题)'));
      one.appendChild(el('div', 'mail-one-meta',
        (m.from || '—') + (m.date ? ' · ' + String(m.date).slice(0, 16) : '')));
      const body = el('div', 'mail-one-body');
      body.textContent = m.text || m.body || m.preview || '(无正文)';
      one.appendChild(body);
      return one;
    }

    tabIn.addEventListener('click', () => show('list'));
    tabNew.addEventListener('click', () => show('compose'));
    show('list');
    /* CSS :hover does the revealing. The class covers pen / touch and an
       explicit "keep it open" click; mouseleave always re-arms privacy. */
    setTimeout(() => {
      const host = wrap.closest('.widget');
      if (!host) return;
      host.addEventListener('click', () => host.classList.add('mail-revealed'));
      host.addEventListener('mouseleave', () => host.classList.remove('mail-revealed'));
    }, 0);
    return wrap;
  }

  /* ---------- bilibili: feed pulled from the API, rendered as cover + text
   * rows just like the mail inbox (no embedded webview). The desktop widget
   * shows the live list directly; clicking a row opens a detail view with a
   * big cover and an "open in Bilibili" button. */
  function buildBiliPanel(card) {
    const wrap = el('div', 'bili');

    const head = el('div', 'bili-head');
    const refresh = el('button', 'bili-refresh', '刷新');
    refresh.type = 'button';
    head.appendChild(refresh);
    wrap.appendChild(head);

    const pane = el('div', 'bili-pane');
    wrap.appendChild(pane);

    function showList() {
      pane.innerHTML = '';
      const box = el('div', 'bili-list');
      box.appendChild(el('div', 'bili-empty', '正在加载…'));
      pane.appendChild(box);
      loadInto(box);
    }

    async function loadInto(box) {
      let r = null;
      try { r = await API.biliFetch({ mode: card.biliMode || 'hot' }); } catch (e) { r = null; }
      box.innerHTML = '';
      if (!r || !r.ok) {
        box.appendChild(el('div', 'bili-empty', (r && r.error) || '加载失败'));
        return;
      }
      const items = r.items || [];
      if (!items.length) { box.appendChild(el('div', 'bili-empty', '暂无内容')); return; }
      items.forEach((v) => {
        const row = el('div', 'bili-row');
        if (v.cover) {
          const img = el('img', 'bili-cover');
          img.src = v.cover; img.alt = ''; img.loading = 'lazy';
          img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
          row.appendChild(img);
        }
        const meta = el('div', 'bili-meta');
        meta.appendChild(el('div', 'bili-name', v.title || ''));
        meta.appendChild(el('div', 'bili-sub',
          v.author + '  ·  ' + v.view + '播放  ·  ' + v.duration));
        if (v.pub) meta.appendChild(el('div', 'bili-pub', v.pub));
        row.appendChild(meta);
        row.addEventListener('click', (e) => { e.stopPropagation(); showDetail(v); });
        box.appendChild(row);
      });
    }

    function showDetail(v) {
      pane.innerHTML = '';
      const one = el('div', 'bili-one');
      const back = el('button', 'bili-back', '← 返回');
      back.type = 'button';
      back.addEventListener('click', (e) => { e.stopPropagation(); showList(); });
      one.appendChild(back);
      if (v.cover) {
        const img = el('img', 'bili-big');
        img.src = v.cover; img.alt = '';
        one.appendChild(img);
      }
      one.appendChild(el('div', 'bili-one-title', v.title || ''));
      one.appendChild(el('div', 'bili-one-meta',
        v.author + '  ·  ' + v.view + '播放  ·  ' + v.danmaku + '弹幕'));
      if (v.desc) one.appendChild(el('div', 'bili-one-desc', v.desc));
      const open = el('button', 'bili-open', '在 B 站打开');
      open.type = 'button';
      open.addEventListener('click', (e) => {
        e.stopPropagation();
        if (v.url && window.card && window.card.openExternal) window.card.openExternal(v.url);
      });
      one.appendChild(open);
      pane.appendChild(one);
    }

    refresh.addEventListener('click', (e) => {
      e.stopPropagation();
      const box = pane.querySelector('.bili-list');
      if (box) loadInto(box); else showList();
    });

    showList();
    /* auto-refresh every 5 min; stop the timer once the node leaves the DOM
       (sheet closed / widget rebuilt) so we never leak intervals. */
    const timer = setInterval(() => {
      if (!document.body.contains(wrap)) { clearInterval(timer); return; }
      if (shellIsAsleep()) return;
      const box = pane.querySelector('.bili-list');
      if (box) loadInto(box);
    }, 5 * 60 * 1000);

    return wrap;
  }

  function buildComposer(card) {
    const wrap = el('div', 'composer');
    const bar = el('div', 'composer-bar');
    const who = el('select', 'composer-from');
    const accounts = (state.mailAccounts || []);
    if (!accounts.length) {
      who.appendChild(el('option', '', '未配置邮箱'));
    } else {
      accounts.forEach((a, i) => {
        const o = el('option', '', a.label || a.user || ('账号 ' + (i + 1)));
        o.value = String(i);
        who.appendChild(o);
      });
    }
    bar.appendChild(el('span', 'composer-label', '发件'));
    bar.appendChild(who);
    wrap.appendChild(bar);

    const to = el('input', 'composer-input');
    to.type = 'text';
    to.placeholder = '收件人，多个用逗号分开';
    wrap.appendChild(labeled('收件人', to));

    const subject = el('input', 'composer-input');
    subject.type = 'text';
    subject.placeholder = '主题';
    wrap.appendChild(labeled('主题', subject));

    const body = el('textarea', 'composer-body');
    body.placeholder = '正文';
    wrap.appendChild(body);

    const foot = el('div', 'composer-foot');
    const status = el('span', 'composer-status', '');
    const send = el('button', 'composer-send', '发送');
    send.type = 'button';
    foot.appendChild(status);
    foot.appendChild(send);
    wrap.appendChild(foot);

    send.addEventListener('click', async () => {
      if (send.disabled) return;
      const payload = {
        account: who.value,
        to: to.value.trim(),
        subject: subject.value.trim(),
        text: body.value,
      };
      if (!payload.to) { status.textContent = '请填收件人'; return; }
      send.disabled = true;
      status.className = 'composer-status';
      status.textContent = '发送中…';
      try {
        const r = await API.mailSend(payload);
        if (r && r.ok) {
          status.className = 'composer-status ok';
          status.textContent = '已发送';
          body.value = '';
        } else {
          status.className = 'composer-status bad';
          status.textContent = (r && r.error) || '发送失败';
        }
      } catch (e) {
        status.className = 'composer-status bad';
        status.textContent = String((e && e.message) || e);
      } finally {
        send.disabled = false;
      }
    });
    return wrap;
  }

  function labeled(text, input) {
    const row = el('div', 'composer-row');
    row.appendChild(el('span', 'composer-label', text));
    row.appendChild(input);
    return row;
  }

  function openDrawer(q, explicit, heading) {
    dom.sheet.hidden = true;
    dom.drawer.removeAttribute('hidden');
    dom.drawer.hidden = false;
    dom.drawer.classList.add('open');
    if (dom.drawerTitle) dom.drawerTitle.textContent = heading || '全部应用';
    dom.drawerSearch.value = q || '';
    renderDrawer(q || '', explicit);
    dom.drawerSearch.focus();
    publishHitRects();
  }

  function renderDrawer(q, explicit) {
    const needle = (q || '').trim().toLowerCase();
    dom.drawerGrid.innerHTML = '';
    /* explicit = a folder's contents (plain {title,target}); the default is
       every launchable card in the shell */
    const rows = explicit
      ? explicit.filter((x) => !needle || (x.title || '').toLowerCase().indexOf(needle) >= 0)
      : (function () {
          /* Start menu = every real desktop/taskbar shortcut, not just the
             handful of cards that happen to be kind=app. */
          const out = [];
          Array.from(state.cards.values()).forEach((c) => {
            if (c.kind === 'folder' && Array.isArray(c.items)) {
              c.items.forEach((it) => out.push({
                id: it.id || '', title: it.title || '', target: it.target || '',
                icon: it.icon || '', kind: 'app'
              }));
            } else if (c.kind === 'app' || c.kind === 'module') out.push(c);
          });
          return out.filter((c) => !needle || (c.title || '').toLowerCase().indexOf(needle) >= 0);
        })();
    rows.forEach((c) => {
      const n = el('div', 'd-app');
      n.append(iconNode(c), el('span', '', c.title || ''));
      n.addEventListener('click', () => {
        closeAll();
        if (c.target) { API.launchPath ? API.launchPath(c.target) : API.launchCard(c.id); }
        else API.launchCard(c.id);
      });
      dom.drawerGrid.appendChild(n);
    });
  }

  function openStartMenu() { openDrawer('', undefined, '开始'); }

  /* ---------------- edit mode + drag ---------------- */

  let pressTimer = null;
  let dragging = null;
  /* Tell the main-process cursor poller to hold the shell clickable for the
     whole drag. Otherwise leaving the hit rects flips the window to
     click-through and pointerup is never delivered. */
  function setShellDrag(on) {
    if (API.setDragActive) { try { API.setDragActive(!!on); } catch (e) {} }
  }
  let editIdleTimer = null;

  function armEditIdle() {
    if (editIdleTimer) clearTimeout(editIdleTimer);
    /* Edit mode is a transient tool, not a persistent state. If nothing is
       being dragged, leave it after 20s so a missed pointerup can never
       strand the shell in edit/jelly mode. */
    editIdleTimer = setTimeout(() => {
      editIdleTimer = null;
      if (dragging) { armEditIdle(); return; }
      exitEdit();
    }, 20000);
  }

  function enterEdit() {
    document.body.classList.add('editing');
    const b = document.getElementById('rerollBtn');
    if (b) b.hidden = false;
    armEditIdle();
  }

  function exitEdit() {
    if (editIdleTimer) { clearTimeout(editIdleTimer); editIdleTimer = null; }
    document.body.classList.remove('editing');
    dom.hint.hidden = true;
    const b = document.getElementById('rerollBtn');
    if (b) b.hidden = true;
  }

  function gridGeometry() {
    const page = dom.pages.children[state.current];
    if (!page) return null;
    const r = page.getBoundingClientRect();
    const cs = getComputedStyle(page);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const gap = parseFloat(cs.gap) || 16;
    const cw = (r.width - padL - padR - gap * (state.cols - 1)) / state.cols;
    const ch = (r.height - padT - padB - gap * (state.rows - 1)) / state.rows;
    return { x: r.left + padL, y: r.top + padT, cw: cw, ch: ch, gap: gap };
  }

  function placeHint() {
    if (!dragging) return;
    const g = gridGeometry();
    if (!g) return;
    const rect = dragging.node.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const col = Math.max(0, Math.min(state.cols - 1, Math.round((cx - g.x - g.cw / 2) / (g.cw + g.gap))));
    const row = Math.max(0, Math.min(state.rows - 1, Math.round((cy - g.y - g.ch / 2) / (g.ch + g.gap))));
    dragging.col = col;
    dragging.row = row;
    dom.hint.hidden = false;
    dom.hint.style.left = (g.x + col * (g.cw + g.gap)) + 'px';
    dom.hint.style.top = (g.y + row * (g.ch + g.gap)) + 'px';
    dom.hint.style.width = g.cw + 'px';
    dom.hint.style.height = g.ch + 'px';
  }

  function startDrag(node, downEvent) {
    const rect = node.getBoundingClientRect();
    dragging = {
      node: node,
      offsetX: downEvent.clientX - rect.left,
      offsetY: downEvent.clientY - rect.top,
      col: null,
      row: null
    };
    node.style.position = 'fixed';
    node.style.left = rect.left + 'px';
    node.style.top = rect.top + 'px';
    node.style.width = rect.width + 'px';
    node.style.height = rect.height + 'px';
    node.style.zIndex = '30';
    node.style.pointerEvents = 'none';
    placeHint();
    setShellDrag(true);
  }

  let pressX = 0, pressY = 0;
  function cancelPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const widget = e.target.closest('.widget');
    if (!widget) return;
    cancelPress();
    pressX = e.clientX; pressY = e.clientY;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      enterEdit();
      startDrag(widget, e);
    }, 500);
  });

  document.addEventListener('pointermove', (e) => {
    /* A lost pointerup used to leave the 500ms long-press armed: the shell
       silently entered edit mode and started a drag by itself. Any real
       pointer travel cancels the long-press before it can fire. */
    if (pressTimer && Math.abs(e.clientX - pressX) + Math.abs(e.clientY - pressY) > 8) cancelPress();
    if (!dragging) return;
    dragging.node.style.left = (e.clientX - dragging.offsetX) + 'px';
    dragging.node.style.top = (e.clientY - dragging.offsetY) + 'px';
    placeHint();
  });

  document.addEventListener('pointerup', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    if (!dragging) return;
    const d = dragging;
    dragging = null;
    setShellDrag(false);
    dom.hint.hidden = true;
    d.node.style.position = '';
    d.node.style.left = '';
    d.node.style.top = '';
    d.node.style.width = '';
    d.node.style.height = '';
    d.node.style.zIndex = '';
    d.node.style.pointerEvents = '';
    /* Cards carry their own pixel rect now, so the drop is written back as a
       rect (snapped to the unit grid) rather than a grid cell — the old
       moveCard() path targeted cells that no longer drive placement, which is
       why dropped cards used to jump back to where they started. */
    const left = parseFloat(d.node.style.left);
    const top = parseFloat(d.node.style.top);
    const w = d.node.offsetWidth;
    const h = d.node.offsetHeight;
    if (!isNaN(left) && !isNaN(top)) {
      const snapped = snapRect(left, top, w, h);
      d.node.style.transition = 'left .14s ease, top .14s ease, width .14s ease, height .14s ease';
      d.node.style.left = snapped.x + 'px';
      d.node.style.top = snapped.y + 'px';
      d.node.style.width = snapped.w + 'px';
      d.node.style.height = snapped.h + 'px';
      const cid = d.node.dataset.cardId;
      const card = state.cards && state.cards.get(cid);
      if (card) card.rect = snapped;
      if (API.setCardRect) API.setCardRect(cid, snapped);
      setTimeout(() => { d.node.style.transition = ''; }, 200);
      publishHitRects();
    }
  });

  /* Final safety net: the shell window toggles mouse pass-through on a timer,
     so pointerup / pointercancel / window blur can all be missed. Without
     this, an unfinished long-press or drag kept edit mode (and the jelly)
     alive indefinitely. */
  function abortInteraction() {
    cancelPress();
    setShellDrag(false);
    if (dragging) {
      const d = dragging;
      dragging = null;
      if (dom.hint) dom.hint.hidden = true;
      ['position', 'left', 'top', 'width', 'height', 'zIndex', 'pointerEvents', 'transition', 'transform']
        .forEach((k) => { d.node.style[k] = ''; });
    }
    if (document.body.classList.contains('editing')) exitEdit();
  }
  document.addEventListener('pointercancel', abortInteraction);
  window.addEventListener('blur', abortInteraction);
  document.addEventListener('visibilitychange', () => { if (document.hidden) abortInteraction(); });

  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.widget')) return;
    e.preventDefault();
    enterEdit();
  });

  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('editing')) return;
    if (e.target.closest('.widget')) return;
    exitEdit();
  });

  /* ---------------- glass context menu ----------------
     Right-click on the dock / pager. The topmost dock catcher owns the real
     mouse, so it sends a one-way IPC and main broadcasts the cursor position
     back. The shell's own contextmenu is a fallback for when the shell is
     hit-testable. Both funnel through showGlassMenu(), which de-dupes. */
  let glassMenu = null;
  let glassMenuAt = 0;

  function hideGlassMenu() {
    if (glassMenu) glassMenu.classList.remove('open');
  }

  function showGlassMenu(cx, cy) {
    const now = Date.now();
    if (now - glassMenuAt < 200) return;
    glassMenuAt = now;
    if (!glassMenu) {
      glassMenu = el('div', 'glass-menu');
      glassMenu.id = 'glassMenu';
      const rows = [
        ['管理面板', 'manager', ''],
        ['上一页', 'page-prev', 'Ctrl+Alt+←'],
        ['下一页', 'page-next', 'Ctrl+Alt+→'],
        ['-', '', ''],
        ['重新排列当前场景', 'reroll', 'Ctrl+Alt+R'],
        ['点击穿透', 'clickthrough', ''],
        ['切到原生桌面', 'desktop', 'Win+Shift+D'],
        ['-', '', ''],
        ['退出 Pico RamOS', 'quit', '']
      ];
      rows.forEach(function (r) {
        if (r[0] === '-') { glassMenu.appendChild(el('div', 'glass-menu-sep')); return; }
        const item = el('div', 'glass-menu-item' + (r[1] === 'quit' ? ' danger' : ''));
        item.appendChild(el('span', '', r[0]));
        if (r[2]) item.appendChild(el('span', 'gm-key', r[2]));
        item.addEventListener('click', function (ev) {
          ev.stopPropagation();
          hideGlassMenu();
          if (r[1] === 'page-prev') { goTo(state.current - 1); return; }
          if (r[1] === 'page-next') { goTo(state.current + 1); return; }
          if (API.menuAction) API.menuAction(r[1]).catch(function () {});
        });
        glassMenu.appendChild(item);
      });
      dom.os.appendChild(glassMenu);
    }
    glassMenu.classList.add('open');
    const w = glassMenu.offsetWidth || 190;
    const h = glassMenu.offsetHeight || 300;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, Number(cx) || 0));
    /* open upwards: the dock lives at the bottom of the screen */
    const y = Math.max(8, Math.min(window.innerHeight - h - 8,
      (Number(cy) || window.innerHeight) - h));
    glassMenu.style.left = Math.round(x) + 'px';
    glassMenu.style.top = Math.round(y) + 'px';
  }

  [dom.dock, dom.dots].forEach(function (node) {
    if (!node) return;
    node.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      showGlassMenu(ev.clientX, ev.clientY);
    });
  });
  document.addEventListener('pointerdown', function (ev) {
    if (glassMenu && glassMenu.classList.contains('open') &&
        !ev.target.closest('#glassMenu')) hideGlassMenu();
  }, true);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') hideGlassMenu();
  });
  window.addEventListener('blur', hideGlassMenu);

  /* ---------------- navigation ---------------- */

  let wheelAcc = 0;
  let wheelLock = false;

  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    /* horizontal paging: a trackpad swipe left/right leads, while a plain
       mouse wheel (deltaY only) still flips pages */
    const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    /* Momentum from a trackpad used to keep accumulating during the lock and
       fire a second flip the instant it expired: that was the "stutter". */
    if (wheelLock) { wheelAcc = 0; return; }
    wheelAcc += d;
    if (Math.abs(wheelAcc) > 48) {
      goTo(state.current + (wheelAcc > 0 ? 1 : -1));
      wheelAcc = 0;
      wheelLock = true;
      setTimeout(() => { wheelLock = false; wheelAcc = 0; }, DUR + 60);
    }
  }, { passive: true });

  let touchX = null;
  let touchY = null;

  window.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    }
  }, { passive: true });

  window.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - (touchY == null ? e.changedTouches[0].clientY : touchY);
    /* horizontal swipe pages, vertical drag retained for touch screens */
    if (Math.abs(dx) > 60 && Math.abs(dx) >= Math.abs(dy)) goTo(state.current + (dx < 0 ? 1 : -1));
    else if (Math.abs(dy) > 60) goTo(state.current + (dy < 0 ? 1 : -1));
    touchX = null;
    touchY = null;
  });

  window.addEventListener('keydown', (e) => {
    /* edit mode: R re-deals the spans (the Tetris re-roll) */
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (!typing && document.body.classList.contains('editing') && String(e.key).toLowerCase() === 'r') {
      e.preventDefault();
      rerollLayout();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') goTo(state.current + 1);
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') goTo(state.current - 1);
    else if (e.key === 'ArrowRight') goTo(state.current + 1);
    else if (e.key === 'ArrowLeft') goTo(state.current - 1);
    else if (e.key === 'Escape') {
      closeAll();
      exitEdit();
    }
  });

  /* the re-roll button lives in os.html; wire it once here */
  (function wireReroll() {
    const b = document.getElementById('rerollBtn');
    if (!b) return;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      rerollLayout();
    });
  })();

  dom.os.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeAll();
  });

  dom.drawerSearch.addEventListener('input', (e) => renderDrawer(e.target.value));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.drawer && !dom.drawer.hidden) closeAll();
  });

  /* ---------------- clock ---------------- */

  function tick() {
    if (shellIsAsleep()) return;   /* native desktop: no clock repaints */
    const d = new Date();
    /* textContent assignment always invalidates style/paint, even when the
       string is identical. On a transparent full-screen window that means a
       whole new composited frame every 15s for a value that only changes once
       a minute. Guard every write. */
    const t = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (dom.clock.textContent !== t) dom.clock.textContent = t;
    const dt = document.querySelector('#dock .di-time');
    const dd = document.querySelector('#dock .di-date');
    if (dt && dt.textContent !== t) dt.textContent = t;
    if (dd) {
      const ds = (d.getMonth() + 1) + '/' + d.getDate() +
        ' \u5468' + '\u65E5\u4E00\u4E8C\u4E09\u56DB\u4E94\u516D'[d.getDay()];
      if (dd.textContent !== ds) dd.textContent = ds;
    }
  }

  tick();
  setInterval(tick, 30000);

   /* Data cards keep their own timers: clocks and pomodoros tick every second,
      gauges and weather refresh every 30s. Only the VISIBLE page needs them --
      the other two are `visibility:hidden`, so their DOM writes would just
      dirty layers that Chromium is trying to skip. */
  function walkDataCards(fn) {
    const nodes = document.querySelectorAll('#pages .page:not(.page-off) .widget');
    for (let i = 0; i < nodes.length; i++) {
      const cb = fn(nodes[i]);
      if (cb) cb(nodes[i]);
    }
  }
  setInterval(function () {
    if (shellIsAsleep()) return;
    walkDataCards(function (n) { return n._tick || null; });
  }, 1000);
  setInterval(function () {
    if (shellIsAsleep()) return;
    walkDataCards(function (n) { return n._pull || null; });
  }, 30000);

  /* ---------------- boot ---------------- */

  /* Follow the OS light/dark setting. body.theme-light flips the token set in
     os.css; nothing else has to know about it. */

  /* Every colour token is derived from the live desktop snapshot (sampled in
     main.js) plus the Windows accent colour. Nothing is hard-coded here, so
     the shell follows whatever wallpaper / system theme is active. */
  function applyPalette(p) {
    if (!p) return;
    const root = document.documentElement.style;
    const bodyStyle = document.body.style;
    /* body.theme-light also declares tokens; inline styles on both elements
       outrank those rules, so set both to keep the derived values authoritative */
    const set = (k, v) => { root.setProperty(k, v); bodyStyle.setProperty(k, v); };
    const parse = (h) => {
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
      return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
    };
    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
    const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const avg = parse(p.avg) || [128, 140, 145];
    const dark = parse(p.dark) || avg.map((v) => Math.round(v * 0.45));
    const light = parse(p.light) || avg.map((v) => Math.min(255, Math.round(v * 1.55)));
    const accent = parse(p.accent) || dark;
    /* Wallpaper brightness decides TEXT contrast (the shell is transparent on
       top of a live wallpaper). Windows light/dark decides the THEME classes.
       Deriving both from one guess made the shell look like it ignored the OS. */
    const wallBright = lum(avg) >= 148;
    const systemDark = (typeof p.systemDark === 'boolean') ? p.systemDark : !wallBright;
    const mix = (a, b, t) => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t));
    const glass = mix(avg, accent, 0.30);  /* Windows accent visibly tints the glass */

    /* glass surfaces: wallpaper + accent, never an opaque colour block */
    set('--glass-tint', rgba(glass, 0.16));
    set('--glass-tint-strong', rgba(glass, 0.26));
    set('--glass-tint-light', rgba(light, wallBright ? 0.34 : 0.22));
    set('--glass-tint-dark', rgba(glass, wallBright ? 0.10 : 0.14));
    set('--glass-tint-soft', rgba(glass, 0.20));
    set('--glass-edge-soft', rgba(dark, 0.22));
    set('--glass-fallback', rgba(glass, 0.30));

    /* the Windows accent drives rings, buttons and highlights */
    set('--accent', rgba(accent, 0.95));
    set('--accent-soft', rgba(accent, 0.18));

    /* text tone follows wallpaper brightness so it always stays readable */
    const fg = wallBright ? dark : light;
    set('--fg', rgba(fg, 1));
    set('--fg-dim', rgba(fg, 0.82));
    set('--pc-line', rgba(fg, 0.20));
    document.body.classList.toggle('on-dark', !wallBright);
    document.body.classList.toggle('theme-light', !systemDark);
  }

  function watchSystemTheme() {
    /* state.followSystemTheme was never populated from getState(), so this
       used to bail out every boot and the shell never tracked Windows at all.
       applyPalette() now sets the class from the systemDark flag main.js
       sends; matchMedia is only a fallback until the first payload arrives. */
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      if (typeof state.systemDark === 'boolean') {
        document.body.classList.toggle('theme-light', !state.systemDark);
      } else {
        document.body.classList.toggle('theme-light', mq.matches);
      }
    };
    apply();
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }

  /* ---- click-through ----------------------------------------------------
   * The window ignores the mouse by default, so a renderer-side pointermove
   * listener would never fire and could never hand control back. The main
   * process polls the cursor instead; our only job is to publish the screen
   * rectangles that should swallow it: widgets, the dock, open sheets and the
   * drawer. Republished after every layout change, debounced. */
  var hitTimer = null;
  var hitHeartbeat = null;

  /* A stale rect list is the classic "dock icons look fine but do nothing"
     failure: the main-process cursor poller then keeps the window click-through
     forever. Republish on a slow heartbeat so a missed layout callback can
     never leave the dock dead for more than a few seconds. */
  function startHitRectHeartbeat() {
    if (hitHeartbeat) return;
    /* 8s is enough as a safety net: renderDock()/applyPage()/resize already
       republish immediately on every real geometry change. Each publish walks
       ~30 nodes with getBoundingClientRect(), which forces a synchronous
       layout - halving it removes a periodic layout thrash. */
    hitHeartbeat = setInterval(() => {
      if (!shellIsAsleep() && !document.hidden) publishHitRects();
    }, 8000);
  }

  function publishHitRects() {
    if (!API.setHitRects) return;
    if (hitTimer) clearTimeout(hitTimer);
    hitTimer = setTimeout(function () {
      var out = [];
      /* #dock is a full-width transparent strip - it must NOT be a hit rect,
         or the whole bottom of the desktop would stop accepting clicks.
         Only the individual glass blocks count. */
      var nodes = document.querySelectorAll('.widget, .dock-item, .sheet, #drawer, #dots, .tile');
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i];
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          out.push({
            x: r.left, y: r.top, w: r.width, h: r.height,
            /* main fits the always-on-top dock hit window to exactly these
               blocks, so the empty parts of the bottom strip stay clickable */
            kind: el.classList.contains('dock-item') ? 'dock' : 'other'
          });
        }
      }
      API.setHitRects(out).catch(function () {});
    }, 60);
  }

  /* Only ever painted when the shell cannot start. It is an error state, not
     part of the design: a blank transparent window over a hidden taskbar is
     far worse than one short line explaining that recovery is in progress. */
  function showBootError(msg) {
    try {
      const box = el('div', 'boot-error');
      box.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
        'z-index:99999;padding:16px 22px;border-radius:14px;background:rgba(20,26,32,.86);' +
        'color:#eef4f7;font:13px/1.6 system-ui,sans-serif;max-width:420px;text-align:center;pointer-events:none';
      box.textContent = '界面加载失败，正在自动恢复…';
      document.body.appendChild(box);
    } catch (e) {}
    try { console.error('[shell] boot failed', msg); } catch (e) {}
  }

  async function boot() {
    watchSystemTheme();
    if (!API.getState) {
      showBootError('preload-missing');
      if (API.shellBootFailed) API.shellBootFailed().catch(function () {});
      return;
    }
    /* Main can be busy compiling the icon helper / scanning shortcuts when
       the renderer asks for state. A single failed invoke used to produce a
       permanently blank shell with no retry and no feedback. */
    let s = null, lastErr = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      try { s = await API.getState(); }
      catch (err) { lastErr = (err && err.message) || String(err); }
      if (s) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (!s) {
      showBootError(lastErr);
      if (API.shellBootFailed) API.shellBootFailed().catch(function () {});
      return;
    }
    /* Perf mode is the default. cards.json "glassOn": true restores the old
       backdrop-filter glass without a code change or a rebuild. */
    document.body.classList.toggle('glass-on', s.glassOn === true);
    state.pages = s.pages || [];
    state.cards = new Map((s.cards || []).map((c) => [c.id, c]));
    state.dock = s.dock || [];
    /* The unit grid is derived from the live viewport, never from a saved
       cell count: 1U = innerWidth / 50 on both axes. */
    publishUnit();
    const ug = unitGrid();
    state.cols = ug.cols;
    state.rows = ug.rows;
    state.mailAccounts = s.mailAccounts || [];
    state.media = s.media || null;
    state.wallpaper = s.wallpaper || { type: 'none', src: '', dim: 0.25 };
    state.seed = s.seed || 1;
    state.layoutSig = s.layoutSig || '';
    state.systemDark = s.palette && s.palette.systemDark;
    applyPalette(s.palette);
    state.current = s.current || 0;
    /* first run (or a changed card set): deal spans + pack. A saved layout is
       replayed untouched, so manual drags survive restarts. */
    if (arrangeLayout(state.seed, false)) persistLayout();
    renderWallpaper();
    renderPages();
    renderDock();
    publishHitRects();
    startHitRectHeartbeat();
    /* U is a fraction of the viewport: keep CSS and every card rect in sync
       when the display or DPI changes, without rebuilding the webviews. */
    const refitUnits = () => {
      publishUnit();
      reapplyUnitRects();
      publishHitRects();
    };
    window.addEventListener('resize', refitUnits);
    /* primary display / DPI changed in main: re-fit after the window has been
       resized so card rects and hit rects use the SAME new 1U pitch */
    if (API.onDisplayChanged) API.onDisplayChanged(refitUnits);
    /* config writes can fail (disk full / read-only / AV lock). Surface it
       once in the console instead of silently losing every later edit. */
    if (API.configHealth) API.configHealth().then((h) => {
      if (h && !h.ok) console.error('[shell] config not writable:', h.lastError);
    }).catch(function () {});
    /* an OS theme / accent change re-tints every token without a reload */
    if (API.onPalette) API.onPalette((p) => {
      if (p && typeof p.systemDark === 'boolean') state.systemDark = p.systemDark;
      applyPalette(p);
    });
    if (API.onIme) API.onIme(applyImeState);
    /* right-click from the topmost dock catcher, and global page hotkeys */
    if (API.onGlassMenu) API.onGlassMenu(function (p) {
      if (p && typeof p.x === 'number') showGlassMenu(p.x, p.y);
    });
    if (API.onPageStep) API.onPageStep(function (d) {
      goTo(state.current + (Number(d) || 0));
    });
    if (API.onDesktopMode) API.onDesktopMode(function (m) {
      /* native desktop = park the hidden shell (see setShellAsleep). Run this
         BEFORE the IME early-return: the IME block may not exist yet. */
      setShellAsleep(!!m && m.mode === 'native');
      if (!m || !imeBlockNode) return;
      applyImeState(Object.assign({}, imeState, { shellNative: m.mode === 'native' }));
    });
    /* A mode switch during page load can beat the listener registration.
       Query once so the shell never wakes up "live" behind a native desktop. */
    if (API.desktopMode) API.desktopMode().then((m) => {
      if (m && m.mode === 'native') setShellAsleep(true);
    }).catch(() => {});
    if (API.onChanged) {
      API.onChanged((next) => {
        if (!next) return;
        document.body.classList.toggle('glass-on', next.glassOn === true);
        const targetPage = Math.max(0, Number(next.current) || 0);
        state.current = targetPage;
        state.pages = next.pages || state.pages;
        state.cards = new Map((next.cards || []).map((c) => [c.id, c]));
        state.dock = next.dock || state.dock;
        state.mailAccounts = next.mailAccounts || state.mailAccounts;
        state.media = next.media || state.media;
        /* a card added or removed while running changes the packing */
        if (arrangeLayout(state.seed, false)) persistLayout();
        /* Playing-state arrives every couple of seconds. Re-rendering the card
           tree for that would tear down and reload every embedded webview, so
           the music widget repaints in place and the layout only rebuilds when
           the card set itself changed. */
        const sig = JSON.stringify((next.pages || []).map((p) => p.cells));
        if (sig !== state._layoutSig) {
          state._layoutSig = sig;
          renderPages();
          renderDock();
          publishHitRects();
        } else {
          refreshMusicWidgets();
        }
        /* the bottom strip (or a page-go IPC) moves between pages without
           changing any cell, so apply the horizontal transform explicitly */
        applyPage(targetPage, true);
      });
    }
    /* the Win11 start menu never opens now -- this fires instead */
    if (API.onStartMenu) {
      API.onStartMenu(() => {
        /* explicit flag: reading the class back races with openSheet() */
        if (window.__drawerOpen) {
          window.__drawerOpen = false;
          closeAll();
        } else {
          window.__drawerOpen = true;
          openDrawer('', null, '全部应用');
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
