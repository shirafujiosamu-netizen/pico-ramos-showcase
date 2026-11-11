/* RETIRED - the always-on-top skin window put Pico RamOS above real
   applications. The glass taskbar now lives in shell/os.js (#dock).
   This file is kept for reference only and is never loaded. */
/* Pico RamOS - native taskbar skin.
 * Pure paint. No click handlers, no hit rects: the whole window is
 * click-through, so the real Windows taskbar keeps 100% of its behaviour. */
(function () {
  'use strict';

  var GLASS = ['glass-liquid', 'glass-frosted', 'glass-fluted'];
  var TARGET = 62;          /* preferred block width, px */
  var GAP = 6;
  var PAD = 20;
  var skin = document.getElementById('skin');
  var root = document.documentElement;
  var count = 0;

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function build(width, taskbarH) {
    /* Always a multiple of three: liquid / frosted / fluted stay 1:1:1. */
    var usable = Math.max(240, (width || 1920) - PAD);
    var n = Math.floor(usable / (TARGET + GAP));
    n = Math.max(3, Math.min(60, n - (n % 3)));
    if (n === count && skin.childElementCount === n) return;
    count = n;
    root.style.setProperty('--tb-h', clamp(taskbarH || 48, 36, 80) + 'px');
    var frag = document.createDocumentFragment();
    for (var i = 0; i < n; i += 1) {
      var b = document.createElement('div');
      b.className = 'tb-block ' + GLASS[i % GLASS.length];
      b.appendChild(document.createElement('i'));
      frag.appendChild(b);
    }
    skin.textContent = '';
    skin.appendChild(frag);
  }

  function rgba(hex, a) {
    if (typeof hex !== 'string') return '';
    var h = hex.trim().replace('#', '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '';
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function lum(hex) {
    if (typeof hex !== 'string') return 128;
    var h = hex.trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return 128;
    return 0.2126 * parseInt(h.slice(0, 2), 16) +
           0.7152 * parseInt(h.slice(2, 4), 16) +
           0.0722 * parseInt(h.slice(4, 6), 16);
  }

  function palette(p) {
    if (!p) return;
    var avg = p.avg || '#8fa8a4';
    var light = p.light || '#eef5f4';
    var dark = p.dark || '#16211f';
    var accent = p.accent || avg;
    var bright = typeof p.systemDark === 'boolean' ? !p.systemDark : lum(avg) >= 148;
    var set = function (k, v) { if (v) root.style.setProperty(k, v); };
    set('--tb-tint', rgba(avg, bright ? 0.13 : 0.20));
    set('--tb-tint-strong', rgba(avg, bright ? 0.22 : 0.30));
    set('--tb-edge', rgba(bright ? dark : light, bright ? 0.16 : 0.24));
    set('--tb-accent', rgba(accent, 0.95));
    set('--tb-fg', rgba(bright ? dark : light, 0.96));
    document.body.classList.toggle('on-dark', !bright);
  }

  var api = window.skin || {};
  if (typeof api.onConfig === 'function') {
    api.onConfig(function (c) { build(c && c.width, c && c.taskbarH); });
  }
  if (typeof api.onPalette === 'function') {
    api.onPalette(palette);
  }
  /* headless / static preview fallback */
  build(window.innerWidth, 48);
})();
