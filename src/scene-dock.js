/* Pico RamOS scene dock renderer */
(function () {
  'use strict';
  var D = window.dock;
  if (!D) return;

  var dotsEl = document.getElementById('sdots');
  var addEl = document.getElementById('sadd');
  var labelEl = document.getElementById('slabel');
  var cur = { scenes: [], active: null };
  var NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function render() {
    var html = '';
    cur.scenes.forEach(function (s, i) {
      var on = s.id === cur.active;
      html += '<div class="slot"><button class="sdot' + (on ? ' on' : '') + '" data-id="' + esc(s.id) + '"' +
        ' data-name="' + esc(s.name) + '" data-cnt="' + (s.count || 0) + '">' +
        '<span>' + (NUM[i] || (i + 1)) + '</span></button></div>';
    });
    dotsEl.innerHTML = html;
  }

  /* hover label */
  dotsEl.addEventListener('mouseover', function (e) {
    var btn = e.target.closest('.sdot');
    if (!btn) return;
    var slot = btn.parentNode;
    labelEl.innerHTML = esc(btn.dataset.name) + '<span class="cnt">' + btn.dataset.cnt + ' 张卡</span>';
    labelEl.style.left = Math.round(slot.offsetLeft + slot.offsetWidth / 2) + 'px';
    labelEl.classList.add('show');
  });
  dotsEl.addEventListener('mouseout', function (e) {
    if (e.target.closest('.sdot')) labelEl.classList.remove('show');
  });

  /* click a circle -> that page */
  dotsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('.sdot');
    if (btn && btn.dataset.id !== cur.active) D.switch(btn.dataset.id);
  });

  /* + -> new scene (main switches to it right away) */
  addEl.addEventListener('click', function () {
    var name = prompt('新场景名称：', '场景 ' + (cur.scenes.length + 1));
    if (name === null) return;
    D.add(String(name).trim());
  });

  function step(dir) {
    var n = cur.scenes.length;
    if (n < 2) return;
    var i = -1;
    cur.scenes.forEach(function (s, k) { if (s.id === cur.active) i = k; });
    if (i < 0) i = 0;
    D.switch(cur.scenes[((i + dir) % n + n) % n].id);
  }

  /* HORIZONTAL paging: a trackpad swipe left/right flips pages. A plain
     mouse only reports deltaY, so that still works as the fallback axis. */
  var wheelLock = false;
  document.addEventListener('wheel', function (e) {
    e.preventDefault();
    if (wheelLock || cur.scenes.length < 2) return;
    var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    wheelLock = true;
    setTimeout(function () { wheelLock = false; }, 380);
    step(d > 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') step(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(-1);
  });

  /* drag the strip sideways to flip pages (mirrors the shell's swipe) */
  var dragX = null;
  document.addEventListener('pointerdown', function (e) {
    if (e.target.closest && e.target.closest('.sdot, #sadd')) return;
    dragX = e.clientX;
  });
  document.addEventListener('pointerup', function (e) {
    if (dragX == null) return;
    var dx = e.clientX - dragX;
    dragX = null;
    if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
  });

  D.state().then(function (s) { cur = s || cur; render(); });
  D.onScenes(function (s) { if (s) { cur = s; render(); } });

  /* live OS accent color: the active circle tracks the Windows accent */
  D.onSystemTheme(function (t) {
    if (t && t.accent) document.documentElement.style.setProperty('--accent', t.accent);
  });
})();
