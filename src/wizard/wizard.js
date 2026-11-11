/* Pico RamOS unified first-run setup: step 1 login consent + global defaults,
   step 2 software paths + which cards to enable, step 3 mail IMAP accounts +
   agent API key. On first run the selection REPLACES the seed; re-run from the
   manager only ADDS (reset=false). Per-card settings still live in each card's
   own panel. */
(function () {
  'use strict';
  var M = window.manager;
  if (!M) return;

  var SWATCHES = ['#16161c', '#1f2430', '#2a1f2b', '#1c2a24', '#2b2418', '#3a1d1d', '#101418', '#f47b5c'];
  var state = null;
  var step = 1;
  var picks = [];          // [{ cfg, on, target }]
  var mail = [];           // [{ provider, label, host, port, secure, user, password }]

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var $ = function (id) { return document.getElementById(id); };
  var PROV_LABEL = { gmail: 'Gmail', qq: 'QQ 邮箱', netease163: '163 邮箱', custom: '自定义' };

  /* ---------- title bar drag (frameless window) ---------- */
  (function () {
    var head = $('whead');
    var dx = 0, dy = 0, on = false, pending = null, raf = 0;
    head.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      on = true; dx = e.screenX; dy = e.screenY;
      if (head.setPointerCapture) { try { head.setPointerCapture(e.pointerId); } catch (err) {} }
    });
    head.addEventListener('pointermove', function (e) {
      if (!on) return;
      var mx = e.screenX - dx, my = e.screenY - dy;
      dx = e.screenX; dy = e.screenY;
      if (!mx && !my) return;
      pending = { dx: (pending ? pending.dx : 0) + mx, dy: (pending ? pending.dy : 0) + my };
      if (!raf) raf = requestAnimationFrame(function () {
        raf = 0;
        if (pending) { M.wizardMoveBy(pending.dx, pending.dy); pending = null; }
      });
    });
    var end = function () { on = false; };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  })();

  /* ---------- boot ---------- */
  M.wizardState().then(function (st) {
    state = st;
    var s = st.settings || {};
    $('wOpacity').value = Math.round((s.defaultOpacity || 0.92) * 100);
    $('wOpVal').textContent = $('wOpacity').value + '%';
    $('wColor').value = s.defaultColor || '#16161c';
    var mode = s.mode === 'desktop' ? 'desktop' : 'top';
    var radios = document.querySelectorAll('input[name="wmode"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === mode;
    $('wSnapCards').checked = s.snapCards !== false;
    $('wSnapScreen').checked = s.snapScreen !== false;
    $('wCT').checked = !!s.clickThrough;
    $('wAuto').checked = !!s.autostart;
    $('wFollow').checked = !!s.followSystemColor;
    syncFollowUI();
    $('wAgent').value = st.agentKey || '';
    mail = (st.mail || []).map(function (a) {
      return { provider: a.provider || 'custom', label: a.label || '', host: a.host || '',
        port: a.port || 993, secure: a.secure !== false, user: a.user || '', password: a.password || '' };
    });
    renderSwatches();
    buildPicks(st.library || []);
    renderMail();
    refreshStep();
  });

  function renderSwatches() {
    var box = $('wSwatches');
    box.innerHTML = SWATCHES.map(function (c) {
      return '<button class="wsw-b" data-c="' + c + '" style="background:' + c + '"></button>';
    }).join('');
    box.querySelectorAll('.wsw-b').forEach(function (b) {
      b.addEventListener('click', function () { $('wColor').value = b.dataset.c; });
    });
  }

  /* following the system tone disables the manual palette: one source of truth */
  function syncFollowUI() {
    var on = $('wFollow').checked;
    $('wColor').disabled = on;
    $('wColor').style.opacity = on ? '.35' : '';
    document.querySelectorAll('.wsw-b').forEach(function (b) {
      b.disabled = on; b.style.opacity = on ? '.35' : ''; b.style.cursor = on ? 'default' : '';
    });
  }
  $('wFollow').addEventListener('change', syncFollowUI);

  function kindLabel(k) {
    return { app: '软件', web: '网址', module: '学习卡', pet: '桌宠', bili: '视频', folder: '文件夹', mail: '消息' }[k] || k;
  }

  function buildPicks(library) {
    picks = library.map(function (c) {
      return { cfg: c, on: c.kind === 'pet' || c.kind === 'module' || c.kind === 'folder' || c.kind === 'mail', target: c.target || '' };
    });
    renderPicks();
  }

  function renderPicks() {
    $('wList').innerHTML = picks.map(function (p, i) {
      var c = p.cfg;
      var pathRow = '';
      if (c.kind === 'app' || c.kind === 'web' || c.kind === 'bili') {
        pathRow =
          '<div class="wp-path">' +
          '  <input class="wp-input" data-i="' + i + '" value="' + esc(p.target) + '" placeholder="' +
          (c.kind === 'app' ? '程序路径（还没设）' : 'https://') + '">' +
          (c.kind === 'app' ? '<button class="wp-browse" data-i="' + i + '">浏览…</button>' : '') +
          '</div>';
      }
      return '<div class="wp-item" data-i="' + i + '">' +
        '<label class="wp-check"><input type="checkbox" data-i="' + i + '"' + (p.on ? ' checked' : '') + '></label>' +
        '<div class="wp-body"><div class="wp-name">' + esc(c.title || '未命名') + '</div>' +
        '<div class="wp-sub">' + kindLabel(c.kind) + ' · ' + c.w + '×' + c.h + '</div>' + pathRow + '</div>' +
        '</div>';
    }).join('');

    $('wList').querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () { picks[Number(cb.dataset.i)].on = cb.checked; });
    });
    $('wList').querySelectorAll('.wp-input').forEach(function (inp) {
      inp.addEventListener('input', function () { picks[Number(inp.dataset.i)].target = inp.value.trim(); });
    });
    $('wList').querySelectorAll('.wp-browse').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.dataset.i);
        M.wizardPick().then(function (p) {
          if (!p) return;
          picks[i].target = p;
          picks[i].on = true;
          renderPicks();
        });
      });
    });
  }

  $('wAddExe').addEventListener('click', function () {
    M.wizardPick().then(function (p) {
      if (!p) return;
      var name = p.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
      picks.push({ cfg: { kind: 'app', title: name, w: 300, h: 220 }, on: true, target: p });
      renderPicks();
    });
  });

  /* ---------- mail accounts ---------- */
  function mailRow(a, i) {
    var hostInfo = a.provider === 'custom'
      ? (' · ' + esc(a.host || '?') + ':' + (a.port || 993))
      : '';
    return '<div class="wmitem" data-i="' + i + '">' +
      '<span class="wm-up" data-i="' + i + '" title="上移">▲</span>' +
      '<span class="wm-down" data-i="' + i + '" title="下移">▼</span>' +
      '<span class="wm-name">' + (PROV_LABEL[a.provider] || '自定义') + hostInfo + '</span>' +
      '<span class="wm-u">' + esc(a.user || '') + '</span>' +
      '<span class="wm-del" data-i="' + i + '" title="删除">✕</span>' +
      '</div>';
  }
  function renderMail() {
    $('wMList').innerHTML = mail.length
      ? mail.map(mailRow).join('')
      : '<div class="wm-empty">还没添加邮箱账户。</div>';
    $('wMList').querySelectorAll('.wm-del').forEach(function (b) {
      b.addEventListener('click', function () {
        mail.splice(Number(b.dataset.i), 1); renderMail();
      });
    });
    $('wMList').querySelectorAll('.wm-up').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.dataset.i); if (i <= 0) return;
        var t = mail[i - 1]; mail[i - 1] = mail[i]; mail[i] = t; renderMail();
      });
    });
    $('wMList').querySelectorAll('.wm-down').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.dataset.i); if (i >= mail.length - 1) return;
        var t = mail[i + 1]; mail[i + 1] = mail[i]; mail[i] = t; renderMail();
      });
    });
  }
  $('wMProv').addEventListener('change', function () {
    $('wMCustom').classList.toggle('hidden', $('wMProv').value !== 'custom');
  });
  $('wMAdd').addEventListener('click', function () {
    var provider = $('wMProv').value;
    var user = $('wMUser').value.trim();
    var password = $('wMPass').value;
    if (!user || !password) { $('wHint').textContent = '邮箱和授权码都要填'; return; }
    var a = { provider: provider, label: '', user: user, password: password, secure: true };
    if (provider === 'custom') {
      a.host = $('wMHost').value.trim();
      a.port = Number($('wMPort').value) || 993;
      a.secure = $('wMSecure').checked;
      if (!a.host) { $('wHint').textContent = '自定义需要填 IMAP 服务器'; return; }
    }
    mail.push(a);
    $('wMUser').value = ''; $('wMPass').value = '';
    $('wHint').textContent = '';
    renderMail();
  });

  /* ---------- step nav ---------- */
  function refreshStep() {
    $('pane1').classList.toggle('hidden', step !== 1);
    $('pane2').classList.toggle('hidden', step !== 2);
    $('pane3').classList.toggle('hidden', step !== 3);
    $('wStep').textContent = step + ' / 3';
    $('wBack').style.visibility = step === 1 ? 'hidden' : 'visible';
    $('wNext').textContent = step === 3 ? '完成设置' : '下一步';
    var n = picks.filter(function (p) { return p.on; }).length;
    $('wHint').textContent = step === 2 ? ('已选 ' + n + ' 张卡片') : '';
  }
  $('wOpacity').addEventListener('input', function () { $('wOpVal').textContent = $('wOpacity').value + '%'; });
  $('wBack').addEventListener('click', function () { if (step > 1) { step--; refreshStep(); } });
  $('wNext').addEventListener('click', function () {
    if (step === 1) {
      if (!$('wAgree').checked) { $('wHint').textContent = '请先勾选本地数据说明'; return; }
      step = 2; refreshStep(); return;
    }
    if (step === 2) { step = 3; refreshStep(); return; }
    finish();
  });

  function finish() {
    var mode = 'top';
    var radios = document.querySelectorAll('input[name="wmode"]');
    for (var i = 0; i < radios.length; i++) if (radios[i].checked) mode = radios[i].value;
    var settings = {
      defaultOpacity: Number($('wOpacity').value) / 100,
      defaultColor: $('wColor').value,
      mode: mode,
      snapCards: $('wSnapCards').checked,
      snapScreen: $('wSnapScreen').checked,
      clickThrough: $('wCT').checked,
      autostart: $('wAuto').checked,
      followSystemColor: $('wFollow').checked,
    };
    var cards = picks.filter(function (p) { return p.on; }).map(function (p) {
      var c = JSON.parse(JSON.stringify(p.cfg));   // strip ids: main assigns fresh ones
      delete c.id;
      if (p.target) c.target = p.target;
      return c;
    });
    var reset = !(state && state.onboarded);       // first run replaces, re-run adds
    M.wizardDone({
      reset: reset, cards: cards, settings: settings,
      mail: mail.map(function (a) { return JSON.parse(JSON.stringify(a)); }),
      agentKey: $('wAgent').value.trim(),
    });
  }
})();
