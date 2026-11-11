/* Pico RamOS manager window logic */
(function () {
  'use strict';
  var M = window.manager;
  if (!M) return;

  var listEl = document.getElementById('mList');
  var sListEl = document.getElementById('sList');
  var editEl = document.getElementById('mEdit');
  var editId = null;
  var scenes = [];
  var activeScene = null;
  var KIND_LABEL = { app: '软件', web: '网址', module: '模块', pet: '桌宠', bili: '视频', folder: '文件夹', mail: '消息' };
  var NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderScenes() {
    sListEl.innerHTML = scenes.map(function (s, i) {
      return '<div class="srow" data-id="' + esc(s.id) + '">' +
        '<span class="sbadge">' + (NUM[i] || (i + 1)) + '</span>' +
        '<span class="sname">' + esc(s.name) + '</span>' +
        '<span class="scount">' + (s.count || 0) + ' 张</span>' +
        (s.id === activeScene ? '<span class="sactive">当前</span>' : '') +
        '<button data-a="go">切换</button>' +
        '<button data-a="ren">重命名</button>' +
        '<button class="del" data-a="del">删除</button>' +
        '</div>';
    }).join('') || '<div style="color:#6f6b63;font-size:11px;padding:6px 0">还没有场景</div>';
  }

  function sceneOptions(sel) {
    return scenes.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>';
    }).join('');
  }

  function refresh() {
    Promise.all([M.list(), M.scenes()]).then(function (res) {
      var cards = res[0] || [];
      var st = res[1] || {};
      scenes = st.scenes || [];
      activeScene = st.active || null;
      renderScenes();
      var html = '';
      scenes.forEach(function (s, i) {
        var inScene = cards.filter(function (c) { return c.scene === s.id; });
        if (!inScene.length) return;
        html += '<div class="sgroup"><div class="sghead"><span class="sgnum">' + (NUM[i] || (i + 1)) + '</span>' +
          esc(s.name) + '<span class="sgcount">' + inScene.length + ' 张</span></div>';
        inScene.forEach(function (c) {
          var ct = c.clickThrough === true ? ' · 穿透' : c.clickThrough === false ? ' · 交互' : '';
          html += '<div class="mitem" data-id="' + c.id + '">' +
            '<span class="mdot" style="background:' + esc(c.color || '#16161c') + '"></span>' +
            '<div class="mbody"><div class="mname">' + esc(c.title || '未命名') + '</div>' +
            '<div class="mtarget">' + esc(c.target || '—') + ' · ' + c.w + '×' + c.h + ' · ' + Math.round((c.opacity || 0.92) * 100) + '%' + ct + '</div></div>' +
            '<span class="mkind">' + (KIND_LABEL[c.kind] || c.kind) + '</span>' +
            '<select class="mscene" data-id="' + c.id + '" title="移动到场景">' + sceneOptions(c.scene) + '</select>' +
            '<div class="macts">' +
            '<button data-a="up" title="上移">↑</button>' +
            '<button data-a="down" title="下移">↓</button>' +
            '<button data-a="open">显示</button>' +
            '<button data-a="edit">编辑</button>' +
            '<button class="del" data-a="del">删除</button>' +
            '</div></div>';
        });
        html += '</div>';
      });
      listEl.innerHTML = html || '<div style="color:#6f6b63;font-size:11.5px;text-align:center;padding:30px 0">还没有卡片，点上面导入一个</div>';
    });
  }

  listEl.addEventListener('change', function (e) {
    var sel = e.target.closest('select.mscene');
    if (!sel) return;
    M.sceneMoveCard(sel.dataset.id, sel.value).then(refresh);
  });

  listEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-a]'); if (!btn) return;
    var id = e.target.closest('.mitem').dataset.id;
    var a = btn.dataset.a;
    if (a === 'open') M.open(id).then(refresh);
    else if (a === 'del') M.remove(id).then(refresh);
    else if (a === 'up') M.sceneReorder(id, 'up').then(refresh);
    else if (a === 'down') M.sceneReorder(id, 'down').then(refresh);
    else if (a === 'edit') openEdit(id);
  });

  /* ---------- scene rows ---------- */
  sListEl.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-a]'); if (!btn) return;
    var id = e.target.closest('.srow').dataset.id;
    var a = btn.dataset.a;
    if (a === 'go') M.sceneSwitch(id);
    else if (a === 'ren') {
      var old = (scenes.filter(function (s) { return s.id === id; })[0] || {}).name || '';
      var name = prompt('场景名称：', old);
      if (name !== null) M.sceneRename(id, name).then(refresh);
    } else if (a === 'del') {
      var cnt = (scenes.filter(function (s) { return s.id === id; })[0] || {}).count || 0;
      if (confirm('删除场景？其中的 ' + cnt + ' 张卡会移到相邻场景。')) M.sceneDelete(id).then(refresh);
    }
  });
  document.getElementById('sAdd').addEventListener('click', function () {
    var name = prompt('新场景名称：', '场景 ' + (scenes.length + 1));
    if (name === null) return;
    M.sceneAdd(String(name).trim()).then(refresh);
  });
  document.getElementById('sLayout').addEventListener('click', function () {
    M.sceneLayout();          // main re-packs every card of the current page
  });

  /* ---------- edit panel ---------- */
  function openEdit(id) {
    M.list().then(function (cards) {
      var c = cards.find(function (x) { return x.id === id; });
      if (!c) return;
      editId = id;
      document.getElementById('eTitle').value = c.title || '';
      document.getElementById('eTarget').value = c.target || '';
      document.getElementById('eOpacity').value = Math.round((c.opacity || 0.92) * 100);
      document.getElementById('eOpVal').textContent = Math.round((c.opacity || 0.92) * 100) + '%';
      document.getElementById('eColor').value = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#16161c';
      document.getElementById('eW').value = c.w;
      document.getElementById('eH').value = c.h;
      document.getElementById('eTop').checked = !!c.topMost;
      document.getElementById('eCT').value = c.clickThrough === true ? 'true' : c.clickThrough === false ? 'false' : 'null';
      document.getElementById('eTargetRow').style.display = c.kind === 'app' ? '' : 'none';
      document.getElementById('eBrowse').style.display = c.kind === 'app' ? '' : 'none';
      editEl.classList.remove('hidden');
    });
  }
  document.getElementById('eOpacity').addEventListener('input', function (e) {
    document.getElementById('eOpVal').textContent = e.target.value + '%';
  });
  document.getElementById('eBrowse').addEventListener('click', function () {
    M.pickFile().then(function (p) { if (p) document.getElementById('eTarget').value = p; });
  });
  document.getElementById('eSave').addEventListener('click', function () {
    var ct = document.getElementById('eCT').value;
    var patch = {
      title: document.getElementById('eTitle').value.trim() || '未命名',
      target: document.getElementById('eTarget').value.trim(),
      opacity: Number(document.getElementById('eOpacity').value) / 100,
      color: document.getElementById('eColor').value,
      w: Math.max(200, Number(document.getElementById('eW').value) || 300),
      h: Math.max(120, Number(document.getElementById('eH').value) || 220),
      topMost: document.getElementById('eTop').checked,
      clickThrough: ct === 'null' ? null : ct === 'true',
    };
    M.update(editId, patch).then(function () { editEl.classList.add('hidden'); refresh(); });
  });
  document.getElementById('eCancel').addEventListener('click', function () { editEl.classList.add('hidden'); });

  /* ---------- add ---------- */
  function nextPos() {
    var n = listEl.querySelectorAll('.mitem').length;
    return { x: 140 + n * 28, y: 140 + n * 28 };
  }
  document.getElementById('addExe').addEventListener('click', function () {
    M.pickFile().then(function (p) {
      if (!p) return;
      var pos = nextPos();
      var name = p.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
      M.add({ kind: 'app', title: name, target: p, x: pos.x, y: pos.y }).then(refresh);
    });
  });
  document.getElementById('addUrl').addEventListener('click', function () {
    var u = prompt('输入网址（http/https）：', 'https://');
    if (!u || !/^https?:\/\//.test(u)) return;
    var pos = nextPos();
    var name = u.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    M.add({ kind: 'web', title: name, target: u, w: 420, h: 560, x: pos.x, y: pos.y }).then(refresh);
  });
  document.getElementById('addModule').addEventListener('click', function () {
    var pos = nextPos();
    M.add({ kind: 'module', title: '学习卡', target: 'study', w: 340, h: 440, x: pos.x, y: pos.y }).then(refresh);
  });
  document.getElementById('addPet').addEventListener('click', function () {
    var pos = nextPos();
    // pet follows the global click-through switch by default; import a custom
    // asset from the card's own settings (or the wizard on first run)
    M.add({ kind: 'pet', title: '桌宠', w: 460, h: 580, x: pos.x, y: pos.y }).then(refresh);
  });
  document.getElementById('addBili').addEventListener('click', function () {
    var pos = nextPos();
    M.add({ kind: 'bili', title: 'B 站', target: 'https://www.bilibili.com', w: 480, h: 640, x: pos.x, y: pos.y }).then(refresh);
  });
  document.getElementById('addFolder').addEventListener('click', function () {
    var pos = nextPos();
    M.add({ kind: 'folder', title: '桌面文件夹', items: [], w: 340, h: 400, x: pos.x, y: pos.y }).then(refresh);
  });

  /* ---------- global switches ---------- */
  M.modeGet().then(function (m) {
    var radios = document.querySelectorAll('input[name="gmode"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === m;
  });
  Array.prototype.forEach.call(document.querySelectorAll('input[name="gmode"]'), function (r) {
    r.addEventListener('change', function () { if (r.checked) M.modeSet(r.value); });
  });
  M.ctGet().then(function (on) { document.getElementById('gCT').checked = !!on; });
  document.getElementById('gCT').addEventListener('change', function (e) { M.ctSet(e.target.checked); });
  M.snapGet().then(function (v) {
    document.getElementById('gSnapCards').checked = !!v.cards;
    document.getElementById('gSnapScreen').checked = !!v.screen;
  });
  document.getElementById('gSnapCards').addEventListener('change', function (e) {
    M.snapSet({ cards: e.target.checked, screen: document.getElementById('gSnapScreen').checked });
  });
  document.getElementById('gSnapScreen').addEventListener('change', function (e) {
    M.snapSet({ cards: document.getElementById('gSnapCards').checked, screen: e.target.checked });
  });
  M.followSystemGet().then(function (on) {
    document.getElementById('gFollow').checked = !!on;
    updateFollowState(!!on);
  });
  function updateFollowState(on) {
    var el = document.getElementById('gFollowState');
    if (!el) return;
    if (!on) { el.textContent = '已关闭 · 各卡使用自己的颜色'; return; }
    var tone = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? '深色' : '浅色';
    el.textContent = '已开启 · 当前系统=' + tone + ' · 强调色';
    // the live Windows accent (focus ring / dock active circle) with a swatch,
    // so the switch visibly reports WHAT it is following
    M.followSystemAccent().then(function (a) {
      if (!a) { el.textContent += '（读取失败）'; return; }
      var chip = document.createElement('span');
      chip.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:3px;' +
        'vertical-align:-1px;margin:0 3px 0 2px;border:1px solid rgba(255,255,255,.25);background:' + a;
      el.appendChild(chip);
      el.appendChild(document.createTextNode(a + '（焦点描边 / 场景条当前圈实时跟随，约 1.5s 内生效）'));
    });
  }
  document.getElementById('gFollow').addEventListener('change', function (e) {
    M.followSystemSet(e.target.checked).then(updateFollowState);   // main re-skins every open card at once
  });
  document.getElementById('runWizard').addEventListener('click', function () {
    M.openWizard();   // add-only re-run: existing cards are kept
  });

  /* ---------- footer ---------- */
  document.getElementById('showAll').addEventListener('click', function () {
    M.showScene();                 // current page only
  });
  document.getElementById('hideAll').addEventListener('click', function () {
    M.hideAll();                   // every page
  });
  M.autostartGet().then(function (on) { document.getElementById('eAuto').checked = !!on; });
  document.getElementById('eAuto').addEventListener('change', function (e) { M.autostartSet(e.target.checked); });
  document.getElementById('quitBtn').addEventListener('click', function () { M.quit(); });
  document.getElementById('mClose').addEventListener('click', function () { M.close(); });

  refresh();
})();
