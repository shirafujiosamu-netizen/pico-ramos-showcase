/* Pico RamOS shared card chrome: NO title bar (mobile-widget look) - a small
   drag grip (top-left), the settings popover (opacity/color/topmost/click-
   through + pet asset controls) and a resize handle (bottom-right).
   Used by shell.html, module pages (study/mail) and the custom pet page.
   DOM contract: a #chrome-slot element; resize handle goes to #rslot or body. */
(function () {
  'use strict';
  const api = window.card;
  if (!api) return;

  const SWATCHES = ['#16161c', '#1f2430', '#2a1f2b', '#1c2a24', '#2b2418', '#3a1d1d', '#101418', '#f47b5c'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  api.getState().then((cfg) => {
    if (!cfg) return;
    /* System color following: when the global switch is on, the OS light/dark
       tone replaces this card's palette color and the whole shell re-skins
       (body.theme-light flips every token in card.css). The Windows ACCENT
       color rides along in the same push and drives --accent (focus ring,
       highlights) - main polls it, so picking a new accent in Windows
       Settings re-skins every card within ~1.5s. The palette controls in the
       settings popover are disabled in that mode - one source of truth. */

/* Ink follows the surface. A light card color (a paper palette pick, or the OS
   light tone) with the dark-theme ink tokens paints near-white text on a bright
   pane - the "字看不清楚" report. Every place that writes --card-color goes
   through here, so text contrast can never drift away from the surface. */
function relLum(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return 0;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function paintCardColor(color, opts) {
  if (color) document.documentElement.style.setProperty('--card-color', color);
  const col = color || getComputedStyle(document.documentElement).getPropertyValue('--card-color');
  const light = relLum(col) > 0.42;
  // an explicit OS tone wins over the luminance guess
  if (opts && typeof opts.forceLight === 'boolean') {
    document.body.classList.toggle('theme-light', opts.forceLight);
  } else {
    document.body.classList.toggle('theme-light', light);
  }
}

    let following = !!cfg.followSystemColor;
    const applyTheme = (t) => {
      if (t && typeof t.following === 'boolean') following = t.following;
      if (t && t.accent) document.documentElement.style.setProperty('--accent', t.accent);
      if (!following) {
        // switched off at runtime: fall back to this card's own palette color
        paintCardColor(cfg.color || '#16161c');
        return;
      }
      const dark = !t || t.dark !== false;
      const color = (t && t.color) || cfg.systemColor;
      paintCardColor(color, { forceLight: !dark });
    };
    applyTheme(null);                       // initial paint from getState
    api.onSystemTheme(applyTheme);          // OS flips light/dark/accent later

    /* Gallery focus: the focused card anchors the strip (full size, accent
       ring); the others are context (dimmer). main broadcasts on every
       slide / reorder / scene switch. */
    let focused = !!cfg.isFocused;
    const paintFocus = (f) => {
      focused = !!(f && f.focused);
      document.body.classList.toggle('is-focus', focused);
    };
    paintFocus({ focused: cfg.isFocused });
    api.onCardFocus(paintFocus);
    // wheel over a card slides the strip focus (cards never scroll anyway)
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;                // ctrl+wheel stays for content zoom
      api.focusNext(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    // clicking anywhere on the card makes it the focus
    document.addEventListener('pointerdown', () => {
      if (!focused) api.focusSet(cfg.id);
    });

    const isPet = cfg.kind === 'pet';
    if (isPet) document.body.classList.add('pet');   // pets never dim as context

    /* ---------- content fit: text scales with the window ----------
       A small card with big content used to grow a fat scrollbar; the root
       font size now tracks the window size (all card text is rem-based), so
       content shrinks to fit instead of scrolling. Floor 0.9 keeps text
       readable on the smallest cards ("字还是看不清" - 0.74 was too small
       once the glass tint lowered the contrast). */
    function fitText() {
      const w = window.innerWidth, h = window.innerHeight;
      if (!w || !h) return;
      const s = Math.max(0.9, Math.min(1, Math.min(w / 360, h / 460)));
      document.documentElement.style.fontSize = (13 * s).toFixed(2) + 'px';
    }
    fitText();
    window.addEventListener('resize', fitText);

    /* ---------- pointer 3D tilt (the TRJ card feel) ----------
       The card is a physical pane: it leans toward the pointer. Frozen
       while a window drag runs (body.dragging), eased back to flat when
       the pointer leaves the window. */
    const cardEl = document.getElementById('card');
    if (cardEl) {
      let traf = 0, tpx = 0, tpy = 0;
      const applyTilt = () => {
        traf = 0;
        const w = window.innerWidth, h = window.innerHeight;
        if (!w || !h) return;
        const rx = (0.5 - tpy / h) * 7;
        const ry = (tpx / w - 0.5) * 9;
        cardEl.style.transition = 'transform .12s ease-out';
        cardEl.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
      };
      document.addEventListener('pointermove', (e) => {
        if (document.body.classList.contains('dragging')) return;
        tpx = e.clientX; tpy = e.clientY;
        if (!traf) traf = requestAnimationFrame(applyTilt);
      }, { passive: true });
      document.addEventListener('pointerleave', () => {
        if (traf) { cancelAnimationFrame(traf); traf = 0; }
        cardEl.style.transition = 'transform .5s cubic-bezier(.22,1,.36,1)';
        cardEl.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg)';
      });
    }

    const slot = document.getElementById('chrome-slot');
    if (slot) {
      slot.innerHTML =
        '<div class="chrome">' +
        '  <div class="grip" id="cGrip" title="拖动调整卡片顺序"><span class="gdots"></span></div>' +
        '  <div class="cacts">' +
        '    <button class="cbtn" id="cSet" title="设置">⚙</button>' +
        '    <button class="cbtn danger" id="cClose" title="关闭卡片">✕</button>' +
        '  </div>' +
        '</div>' +
        '<div class="csettings hidden" id="cSettings">' +
        '  <label class="crow"><span class="clab">透明度</span>' +
        '    <input type="range" id="cOpacity" min="15" max="100" value="' + Math.round((cfg.opacity || 0.92) * 100) + '">' +
        '    <span class="cval" id="cOpVal"></span></label>' +
        '  <div class="crow"><span class="clab">颜色</span>' +
        '    <span class="swatches">' + SWATCHES.map((c) =>
          '<button class="sw' + (c === cfg.color ? ' on' : '') + '" data-c="' + c + '" style="background:' + c + '"></button>').join('') +
        '    </span><input type="color" id="cColor" value="' + esc(cfg.color || '#16161c') + '" title="自定义颜色"></div>' +
        (following ?
          '  <div class="crow muted">跟随系统颜色中：表面与文字随系统深浅色切换<br>' +
          '  自定义颜色请先到管理面板 / 向导关掉「跟随系统颜色」</div>' : '') +
        '  <label class="crow"><input type="checkbox" id="cTop"' + (cfg.topMost ? ' checked' : '') + '> 置顶</label>' +
        '  <div class="crow"><span class="clab">穿透</span>' +
        '    <select id="cCT">' +
        '      <option value="null"' + (cfg.clickThrough == null ? ' selected' : '') + '>跟随全局</option>' +
        '      <option value="true"' + (cfg.clickThrough === true ? ' selected' : '') + '>强制穿透</option>' +
        '      <option value="false"' + (cfg.clickThrough === false ? ' selected' : '') + '>强制交互</option>' +
        '    </select></div>' +
        (isPet ? petRows(cfg) : '') +
        '  <div class="crow muted">拖卡片任意位置移动 · 拖边缘或四角改大小 · 滚轮切换焦点卡片<br>' +
        '  想恢复紧凑组合：托盘或 Ctrl+Alt+R 重新排列。全局开关在管理面板 / 托盘：模式（置顶↔桌面组件）、点击穿透。Ctrl+Alt+D 临时拖动。</div>' +
        '</div>';

      const grip = document.getElementById('cGrip');
      let dragging = false, lx = 0, ly = 0, pending = null, raf = 0;
      const flush = () => {
        raf = 0;
        if (pending) { api.moveBy(pending.dx, pending.dy); pending = null; }
      };
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        dragging = true; lx = e.screenX; ly = e.screenY;
        document.body.classList.add('dragging');           // freezes the 3D tilt
        if (grip.setPointerCapture) { try { grip.setPointerCapture(e.pointerId); } catch (err) {} }
        api.dragStart();
        e.preventDefault();
      });
      // rAF-coalesced: one IPC + one native move per frame, never per event
      grip.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.screenX - lx, dy = e.screenY - ly;
        lx = e.screenX; ly = e.screenY;
        if (!dx && !dy) return;
        if (!pending) pending = { dx: 0, dy: 0 };
        pending.dx += dx; pending.dy += dy;
        if (!raf) raf = requestAnimationFrame(flush);
      });
      const gripEnd = () => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('dragging');
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        flush();
        api.dragEnd();          // main keeps the card where it was dropped
      };
      grip.addEventListener('pointerup', gripEnd);
      grip.addEventListener('pointercancel', gripEnd);

      const setBtn = document.getElementById('cSet');
      const setBox = document.getElementById('cSettings');
      setBtn.addEventListener('click', (e) => { e.stopPropagation(); setBox.classList.toggle('hidden'); });

      const op = document.getElementById('cOpacity');
      const opVal = document.getElementById('cOpVal');
      const showOp = () => { opVal.textContent = op.value + '%'; };
      showOp();
      op.addEventListener('input', () => { showOp(); api.setOpacity(Number(op.value) / 100); });

      if (following) {
        // one source of truth: while following, the OS tone wins - the palette
        // is visibly disabled so it never looks like a broken control
        document.querySelectorAll('.sw').forEach((b) => {
          b.disabled = true; b.style.opacity = '.35'; b.style.cursor = 'default';
        });
        const cc = document.getElementById('cColor');
        if (cc) { cc.disabled = true; cc.style.opacity = '.35'; }
      } else {
        document.querySelectorAll('.sw').forEach((b) => b.addEventListener('click', () => {
          document.querySelectorAll('.sw').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          api.setColor(b.dataset.c);
          paintCardColor(b.dataset.c);
        }));
        document.getElementById('cColor').addEventListener('input', (e) => {
          api.setColor(e.target.value);
          paintCardColor(e.target.value);
        });
      }
      document.getElementById('cTop').addEventListener('change', (e) => api.setTopMost(e.target.checked));
      document.getElementById('cCT').addEventListener('change', (e) => {
        const v = e.target.value;
        api.setClickThrough(v === 'null' ? null : v === 'true');
      });
      document.getElementById('cClose').addEventListener('click', () => api.close());

      if (isPet) wirePetRows(cfg);
    }

    /* ---------- whole-card drag: with no title bar the card BODY is the handle ----------
       Only the 14px grip used to move a card - grabbing the card anywhere else
       did nothing, and grabbing near an edge hit the resize zone instead (the
       "edges expand outward while I drag" report). Now any non-interactive
       surface drags the window; interactive content opts out via closest(). */
    const NODRAG = 'button, input, select, textarea, a, webview, .crz, .grip, .csettings, ' +
      '.flash, .qcard, .qitem, .nitem, .mitem, .litem, .pchip, .cat, .ftile, .sw, label, #vaAdd, #lAdd, #sAdd, #nAdd';
    (function bodyDrag() {
      const host = document.getElementById('card') || document.body;
      let on = false, lx = 0, ly = 0, pend = null, raf = 0;
      const flush = () => {
        raf = 0;
        if (pend) { api.moveBy(pend.dx, pend.dy); pend = null; }
      };
      host.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest && e.target.closest(NODRAG)) return;
        if (window.getSelection && String(window.getSelection())) return;   // dragging selected text
        on = true; lx = e.screenX; ly = e.screenY;
        document.body.classList.add('dragging');           // freezes the 3D tilt
        if (host.setPointerCapture) { try { host.setPointerCapture(e.pointerId); } catch (err) {} }
        api.dragStart();
        e.preventDefault();
      });
      host.addEventListener('pointermove', (e) => {
        if (!on) return;
        const dx = e.screenX - lx, dy = e.screenY - ly;
        lx = e.screenX; ly = e.screenY;
        if (!dx && !dy) return;
        if (!pend) pend = { dx: 0, dy: 0 };
        pend.dx += dx; pend.dy += dy;
        if (!raf) raf = requestAnimationFrame(flush);
      });
      const end = () => {
        if (!on) return;
        on = false;
        document.body.classList.remove('dragging');
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        flush();
        api.dragEnd();          // main keeps the card where it was dropped
      };
      host.addEventListener('pointerup', end);
      host.addEventListener('pointercancel', end);
    })();

    /* 8-way resize: a transparent overlay with eight hit zones. pointerdown
       snapshots the window bounds; pointermove computes ABSOLUTE bounds for
       the dragged direction (the opposite edge stays anchored) and ships them
       through card-resize-to - relative deltas from a single corner is what
       made the old handle grow the window in random directions on diagonal
       drags. rAF-coalesced: one IPC + one native move per frame. */
    const MIN_W = 200, MIN_H = 120;                 // keep in sync with main.js
    const rzHost = document.getElementById('rslot') || document.body;
    const zones = document.createElement('div');
    zones.className = 'crzones';
    zones.title = '拖边缘或四角调整大小';
    zones.innerHTML =
      '<div class="crz crz-n" data-d="n"></div><div class="crz crz-s" data-d="s"></div>' +
      '<div class="crz crz-e" data-d="e"></div><div class="crz crz-w" data-d="w"></div>' +
      '<div class="crz crz-nw" data-d="nw"></div><div class="crz crz-ne" data-d="ne"></div>' +
      '<div class="crz crz-sw" data-d="sw"></div><div class="crz crz-se" data-d="se"></div>';
    rzHost.appendChild(zones);
    let rzOn = false, rdir = '', rsx = 0, rsy = 0, sb = null, rpending = null, rraf = 0;
    const rflush = () => {
      rraf = 0;
      if (rpending) { api.resizeTo(rpending); rpending = null; }
    };
    zones.addEventListener('pointerdown', (e) => {
      const z = e.target.closest('.crz');
      if (!z || e.button !== 0) return;
      sb = api.boundsSync();                        // sync read: no await in a drag
      if (!sb) return;
      rzOn = true; rdir = z.dataset.d; rsx = e.screenX; rsy = e.screenY;
      if (z.setPointerCapture) { try { z.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault(); e.stopPropagation();
    });
    zones.addEventListener('pointermove', (e) => {
      if (!rzOn) return;
      const dx = e.screenX - rsx, dy = e.screenY - rsy;
      if (!dx && !dy) return;
      const b = { x: sb.x, y: sb.y, width: sb.width, height: sb.height };
      if (rdir.indexOf('e') !== -1) b.width = Math.max(MIN_W, sb.width + dx);
      if (rdir.indexOf('s') !== -1) b.height = Math.max(MIN_H, sb.height + dy);
      if (rdir.indexOf('w') !== -1) {
        const nw = Math.max(MIN_W, sb.width - dx);
        b.x = sb.x + (sb.width - nw); b.width = nw;   // right edge anchored
      }
      if (rdir.indexOf('n') !== -1) {
        const nh = Math.max(MIN_H, sb.height - dy);
        b.y = sb.y + (sb.height - nh); b.height = nh; // bottom edge anchored
      }
      rpending = b;
      if (!rraf) rraf = requestAnimationFrame(rflush);
    });
    const rzEnd = () => {
      if (!rzOn) return;
      rzOn = false;
      if (rraf) { cancelAnimationFrame(rraf); rraf = 0; }
      rflush();
      api.save({});                                  // persist the final size
    };
    zones.addEventListener('pointerup', rzEnd);
    zones.addEventListener('pointercancel', rzEnd);
  });

  /* ---------- pet-specific settings rows (hub pet and custom assets alike) ---------- */
  function petRows(cfg) {
    const p = cfg.pet || {};
    const isHub = !p.type || p.type === 'hub';
    const kindName = isHub ? '文枢桌宠（默认）' : { image: '图片', model3d: '3D 模型', l2d: 'Live2D' }[p.type] || p.type;
    return (
      '  <div class="crow phead">桌宠素材 · ' + esc(kindName) + '</div>' +
      '  <div class="crow"><button class="pbtn" id="pImport">更换素材（GLB / Live2D / 图片）</button></div>' +
      '  <div class="crow"><button class="pbtn ghost2" id="pReset">恢复默认桌宠</button></div>' +
      '  <label class="crow"><span class="clab">缩放</span>' +
      '    <input type="range" id="pScale" min="20" max="400" value="' + Math.round((p.scale || 1) * 100) + '">' +
      '    <span class="cval" id="pScaleVal"></span></label>' +
      '  <label class="crow"><span class="clab">旋转</span>' +
      '    <input type="range" id="pRotate" min="-180" max="180" value="' + (p.rotate || 0) + '">' +
      '    <span class="cval" id="pRotateVal"></span></label>' +
      '  <label class="crow"><span class="clab">自转</span>' +
      '    <input type="range" id="pSpin" min="0" max="60" value="' + (p.spin || 0) + '">' +
      '    <span class="cval" id="pSpinVal"></span></label>' +
      '  <div class="crow" id="pActRow"></div>');
  }

  function wirePetRows(cfg) {
    const p = cfg.pet || {};
    const pet = window.__pet;
    if (!pet) {
      // hub pet has no in-page transform API: only import / reset make sense
      ['pScale', 'pRotate', 'pSpin'].forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.closest('.crow')) el.closest('.crow').style.display = 'none';
      });
      const act = document.getElementById('pActRow');
      if (act) act.style.display = 'none';
      document.getElementById('pImport').addEventListener('click', () => {
        api.petPickAsset().then((r) => {
          if (r && r.ok) api.petApplyAsset(r);       // switch to custom renderer
        });
      });
      document.getElementById('pReset').addEventListener('click', () => api.petClearAsset());
      return;
    }
    const scale = document.getElementById('pScale');
    const scaleVal = document.getElementById('pScaleVal');
    const rotate = document.getElementById('pRotate');
    const rotateVal = document.getElementById('pRotateVal');
    const spin = document.getElementById('pSpin');
    const spinVal = document.getElementById('pSpinVal');
    const showVals = () => {
      scaleVal.textContent = scale.value + '%';
      rotateVal.textContent = rotate.value + '°';
      spinVal.textContent = spin.value === '0' ? '关' : spin.value + '°/s';
    };
    showVals();
    scale.addEventListener('input', () => { showVals(); if (pet) { pet.save({ scale: Number(scale.value) / 100 }); pet.applyTransform(); } });
    rotate.addEventListener('input', () => { showVals(); if (pet) { pet.save({ rotate: Number(rotate.value) }); pet.applyTransform(); } });
    spin.addEventListener('input', () => {
      showVals();
      if (pet) { pet.save({ spin: Number(spin.value) }); pet.applyTransform(); }
      // 3d uses model-viewer auto-rotate; image/l2d spin via CSS is not wired (kept for 3d)
    });

    // interaction row: motion select (3d/l2d) or say input (image); re-rendered
    // when the pet page finishes enumerating motions (async model load)
    const actRow = document.getElementById('pActRow');
    const cur0 = p.act || {};
    function renderActRow() {
      const motions = (pet && pet.getMotions) ? pet.getMotions() : [];
      const cur = (cfg.pet && cfg.pet.act) || cur0;
      if (p.type === 'image') {
        actRow.innerHTML = '<span class="clab">台词</span><input type="text" id="pSay" placeholder="点击桌宠时显示" value="' + esc(cur.say || '') + '">';
        const say = document.getElementById('pSay');
        say.addEventListener('change', () => { if (pet) pet.save({ act: { motion: '', say: say.value.trim() } }); });
      } else if (motions.length) {
        const opts = motions.map((m, i) => {
          const label = typeof m === 'string' ? m : m.label;
          const val = typeof m === 'string' ? m : (m.group + '::' + m.index);
          return '<option value="' + esc(val) + '"' + (cur.motion === val ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('');
        actRow.innerHTML = '<span class="clab">互动</span><select id="pMotion">' +
          '<option value=""' + (!cur.motion ? ' selected' : '') + '>默认（第一个）</option>' + opts + '</select>';
        document.getElementById('pMotion').addEventListener('change', (e) => {
          if (pet) pet.save({ act: { motion: e.target.value, say: cur.say || '' } });
        });
      } else {
        actRow.innerHTML = '<span class="clab">互动</span><span class="crow muted" style="flex:1">素材加载后这里会出现动作列表</span>';
      }
    }
    renderActRow();
    document.addEventListener('pet-motions', () => {
      if (setBox && !setBox.classList.contains('hidden')) renderActRow();
    });

    document.getElementById('pImport').addEventListener('click', () => {
      api.petPickAsset().then((r) => {
        if (!r || !r.ok) return;
        if (pet && pet.replaceAsset) pet.replaceAsset(r);   // custom pet: swap in place
        else api.petApplyAsset(r);                          // hub pet: switch + rebuild card
      });
    });
    document.getElementById('pReset').addEventListener('click', () => {
      if (pet) pet.clearAsset();
    });
  }

  /* ---------- first-run hint: one-time, auto-dismissing ----------
   * With no title bar and hover-faded chrome, a card reads as a plain brick
   * to a new user. Show the three verbs once (on first hover), persist that
   * it has been seen, and never show it again. */
  if (cfg.hints && cfg.hints.cardOps === false) {
    const host = document.getElementById('card') || document.body;
    const hint = document.createElement('div');
    hint.className = 'chint';
    hint.textContent = '拖卡片移动 · 拖边缘改大小 · ⚙ 设置卡片';
    (document.getElementById('rslot') || document.body).appendChild(hint);
    let armed = false, done = false, t1 = 0, t2 = 0;
    const dismiss = () => {
      if (done) return; done = true;
      clearTimeout(t1); clearTimeout(t2);
      hint.classList.remove('on'); hint.classList.add('out');
      setTimeout(() => { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 400);
      api.hintSeen('cardOps');
    };
    host.addEventListener('pointerenter', () => {
      if (done || armed) return;
      armed = true;
      t1 = setTimeout(() => {
        hint.classList.add('on');                     // fade in
        api.hintSeen('cardOps');                      // shown once, never again
        t2 = setTimeout(dismiss, 3600);               // auto-fade out
      }, 800);
    });
    host.addEventListener('pointerleave', () => {
      if (done) return;
      clearTimeout(t1); armed = false;
    });
  }
})();
