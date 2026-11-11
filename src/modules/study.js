/* Pico RamOS study card - a generic "custom projects" learning card.
 * Replaces the fixed IELTS card: every project is user-defined, any language,
 * any topic. Project kinds:
 *   vocab  - flip-card vocabulary (any language)
 *   listen - listening practice (http audio or local file, per-item loop)
 *   speak  - spoken sentences / question bank with random draw
 *   note   - classified notes / material library (the ref-card classification idea)
 * Data lives on the card config (cfg.study) so every study card keeps its own
 * projects; export/import JSON to share packs between machines. */
(function () {
  'use strict';
  var api = window.card;
  if (!api) return;

  var rail = document.getElementById('srail');
  var bar = document.getElementById('sbar');
  var pane = document.getElementById('spane');
  var KIND_LABEL = { vocab: '背单词', listen: '磨耳朵', speak: '口语/题库', note: '素材分类' };

  var cfg = null;
  var data = null;            // { projects: [], active: id }
  var saveTimer = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { api.save({ study: data }); }, 300);
  }
  function active() {
    for (var i = 0; i < data.projects.length; i++) if (data.projects[i].id === data.active) return data.projects[i];
    return data.projects[0] || null;
  }

  /* ---------- starter pack (first run) ---------- */
  function starter() {
    return {
      active: 'p_vocab',
      projects: [
        {
          id: 'p_vocab', name: '英语 · 核心词', kind: 'vocab', known: {},
          items: [
            { a: 'resilient', b: '有韧性的，能恢复的' },
            { a: 'inevitable', b: '不可避免的' },
            { a: 'ambiguous', b: '模糊的，有歧义的' },
            { a: 'deliberate', b: '故意的；深思熟虑的' },
            { a: 'intuitive', b: '直觉的' },
            { a: 'perspective', b: '视角，观点' },
          ],
        },
        {
          id: 'p_speak', name: '口语常用句', kind: 'speak',
          items: [
            { text: 'Could you say that again in a different way?', cn: '能换种说法再说一遍吗？', done: false },
            { text: "I'd say it depends on the situation.", cn: '我觉得要看情况。', done: false },
            { text: 'What I mean is, the idea itself is simple.', cn: '我的意思是，想法本身不复杂。', done: false },
            { text: "Let me put it another way.", cn: '我换个说法。', done: false },
            { text: "That's a really interesting point.", cn: '这个点很有意思。', done: false },
          ],
        },
        {
          id: 'p_listen', name: '磨耳朵', kind: 'listen',
          items: [{ title: '示例：粘贴音频链接或本地路径', src: '', loop: true }],
        },
        {
          id: 'p_note', name: '素材分类', kind: 'note',
          cats: [{ name: '参考图', color: '#f47b5c' }, { name: '文案', color: '#9ece6a' }],
          items: [
            { cat: '参考图', title: '示例条目', body: '点正文可复制。分类可以随意增删改，像参考图卡片那样归类你的素材。' },
          ],
        },
      ],
    };
  }

  /* ---------- top chrome ---------- */
  function renderRail() {
    var h = data.projects.map(function (p) {
      return '<button class="pchip' + (p.id === data.active ? ' on' : '') + '" data-p="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');
    rail.innerHTML = h + '<button class="pchip add" id="pAdd">＋ 新项目</button>';
    rail.querySelectorAll('.pchip[data-p]').forEach(function (b) {
      b.addEventListener('click', function () { data.active = b.dataset.p; persist(); renderAll(); });
    });
    document.getElementById('pAdd').addEventListener('click', addProject);

    var p = active();
    bar.innerHTML =
      '<span class="pname">' + esc(p ? p.name : '（空）') + '</span>' +
      '<span class="kindtag">' + (p ? (KIND_LABEL[p.kind] || p.kind) : '') + '</span>' +
      '<button id="pMenu">管理 ▾</button>';
    document.getElementById('pMenu').addEventListener('click', projectMenu);
  }

  function addProject() {
    var p = { id: uid('p'), name: '新项目', kind: 'vocab', items: [], known: {} };
    data.projects.push(p);
    data.active = p.id;
    persist(); renderAll();
  }

  function projectMenu() {
    var p = active();
    if (!p) return;
    var name = prompt('项目名称（可改）：', p.name);
    if (name != null && name.trim()) { p.name = name.trim(); }
    var kind = prompt('类型：vocab=背单词 / listen=磨耳朵 / speak=口语题库 / note=素材分类', p.kind);
    if (kind && KIND_LABEL[kind]) {
      p.kind = kind;
      if (kind === 'note' && !p.cats) p.cats = [{ name: '默认', color: '#f47b5c' }];
    }
    persist(); renderAll();
    var more = prompt('更多操作：export=导出这个项目 / import=导入项目包 / del=删除这个项目（回车跳过）', '');
    if (more === 'export') exportProject(p);
    else if (more === 'import') importPack();
    else if (more === 'del' && data.projects.length > 1) {
      data.projects = data.projects.filter(function (x) { return x.id !== p.id; });
      data.active = data.projects[0].id;
      persist(); renderAll();
    }
  }

  /* ---------- export / import ---------- */
  function exportProject(p) {
    var blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (p.name || 'study') + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function importPack() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(rd.result);
          var packs = Array.isArray(j) ? j : (j.projects ? j.projects : [j]);
          packs.forEach(function (pk) {
            if (!pk || typeof pk !== 'object') return;
            pk.id = uid('p');
            pk.items = pk.items || [];
            data.projects.push(pk);
          });
          persist(); renderAll();
        } catch (e) { alert('导入失败：不是有效的项目 JSON'); }
      };
      rd.readAsText(f);
    });
    inp.click();
  }

  /* ============ vocab (Baicizhan-style: PICK the meaning) ============
     The old flip card ("click to reveal") never made the user recall
     anything - the field report: "I can't remember if I never pick the
     meaning". Default is now 4-choice: the word on top, four meanings, one
     correct. Pick right -> green + counted as known; pick wrong -> red with
     the correct one lit. Flip mode stays available (and is the automatic
     fallback when a project has fewer than 4 items). */
  var vIdx = 0, vFace = false;
  var vPick = -1, vOpts = null, vResult = '';
  function shuffled(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function buildChoices(items, correct) {
    var pool = [], seen = {};
    seen[correct] = 1;
    items.forEach(function (it) {
      if (it.b && it.b !== correct && !seen[it.b]) { seen[it.b] = 1; pool.push(it.b); }
    });
    var opts = [{ b: correct, ok: 1 }];
    shuffled(pool).slice(0, 3).forEach(function (b) { opts.push({ b: b, ok: 0 }); });
    if (opts.length < 4) return null;                 // not enough distractors -> flip fallback
    return shuffled(opts);
  }
  function renderVocab(p) {
    var items = p.items || [];
    if (!items.length) { pane.innerHTML = '<div class="empty">还没有词条，在下面添加</div>' + addVocabForm(); return; }
    if (vIdx >= items.length) vIdx = 0;
    var w = items[vIdx];
    var known = p.known || {};
    var doneN = items.filter(function (it) { return known[it.a]; }).length;
    var choiceMode = p.mode !== 'flip' && items.length >= 4;
    var head = '<div class="vmeta"><span>' + (vIdx + 1) + ' / ' + items.length + ' · 已会 ' + doneN + '</span>' +
      '<span class="vmodes">' +
      '<label><input type="checkbox" id="vShuffle"' + (p._order ? ' checked' : '') + '> 乱序</label>' +
      (items.length >= 4 ? '<button class="mbtn" id="vMode">' + (choiceMode ? '翻卡' : '选释义') + '</button>' : '') +
      '</span></div>';
    var body = '';
    if (choiceMode) {
      if (vPick < 0 || !vOpts) vOpts = buildChoices(items, w.b);
      body +=
        '  <div class="flash vq"><div class="fw">' + esc(w.a) + '</div>' +
        '  <div class="fhint">选一个释义（键盘 1-4）</div></div>' +
        '  <div class="vopts">' + vOpts.map(function (o, i) {
          var cls = 'vopt';
          if (vPick >= 0) {
            if (o.ok) cls += ' ok';
            else if (i === vPick) cls += ' no';
            else cls += ' dim';
          }
          return '<button class="' + cls + '" data-i="' + i + '"><span class="vk">' + (i + 1) + '</span>' +
            '<span class="vt">' + esc(o.b) + '</span></button>';
        }).join('') + '</div>' +
        (vResult === 'ok' ? '<div class="vfb ok">✓ 记住了</div>'
          : vResult === 'no' ? '<div class="vfb no">✕ 正确释义：' + esc(w.b) + '</div>' : '');
    } else {
      body +=
        '  <div class="flash" id="flash">' +
        (vFace
          ? '    <div class="fw" style="font-size:1.31rem">' + esc(w.a) + '</div><div class="fm">' + esc(w.b) + '</div>'
          : '    <div class="fw">' + esc(w.a) + '</div><div class="fhint">点一下看释义</div>') +
        '  </div>';
    }
    pane.innerHTML =
      '<div class="vwrap">' + head + body +
      '  <div class="vacts">' +
      '    <button id="vPrev">← 上一张</button>' +
      '    <button class="dunno" id="vNo">不认识</button>' +
      '    <button class="know" id="vYes">认识</button>' +
      '    <button id="vNext">下一张 →</button>' +
      '  </div>' +
      '</div>' +
      '<div class="ptip">' + (choiceMode ? '选对自动下一题 · ←/→ 换词 · 点下面词条可跳转' : '←/→ 翻张 · 空格翻面 · 点下面词条可跳转') + '</div>' +
      '<div class="qlist" style="margin-top:0.5rem">' +
      items.map(function (it, i) {
        return '<div class="qitem" data-i="' + i + '"><span class="qt">' + esc(it.a) + '</span>' +
          '<span class="mini">' + (known[it.a] ? '已会' : '✕') + '</span></div>';
      }).join('') + '</div>' +
      addVocabForm();
    if (choiceMode) {
      pane.querySelectorAll('.vopt').forEach(function (b) {
        b.addEventListener('click', function () { pickChoice(p, Number(b.dataset.i)); });
      });
    } else {
      document.getElementById('flash').addEventListener('click', function () { vFace = !vFace; renderVocab(p); });
    }
    document.getElementById('vPrev').addEventListener('click', function () { stepV(-1, p); });
    document.getElementById('vNext').addEventListener('click', function () { stepV(1, p); });
    document.getElementById('vYes').addEventListener('click', function () { markV(p, w.a, true); stepV(1, p); });
    document.getElementById('vNo').addEventListener('click', function () { markV(p, w.a, false); stepV(1, p); });
    document.getElementById('vShuffle').addEventListener('change', function (e) {
      p._order = e.target.checked ? shuffled(items).map(function (x) { return x.a; }) : null;
    });
    var modeBtn = document.getElementById('vMode');
    if (modeBtn) modeBtn.addEventListener('click', function () {
      p.mode = choiceMode ? 'flip' : 'choice';
      vPick = -1; vOpts = null; vResult = '';
      persist(); renderVocab(p);
    });
    pane.querySelectorAll('.qlist .qitem').forEach(function (it) {
      it.addEventListener('click', function () { vIdx = Number(it.dataset.i); vFace = true; vPick = -1; vOpts = null; vResult = ''; renderVocab(p); });
    });
    bindAddVocab(p);
  }
  function pickChoice(p, i) {
    if (vPick >= 0 || !vOpts) return;
    vPick = i;
    vResult = vOpts[i].ok ? 'ok' : 'no';
    markV(p, (p.items[vIdx] || {}).a, !!vOpts[i].ok);
    renderVocab(p);
    if (vResult === 'ok') setTimeout(function () { stepV(1, p); }, 900);
  }
  function addVocabForm() {
    return '<div class="sform"><input id="va" placeholder="单词 / 题目"><input id="vb" placeholder="释义 / 答案">' +
      '<button id="vaAdd">添加</button></div>';
  }
  function bindAddVocab(p) {
    document.getElementById('vaAdd').addEventListener('click', function () {
      var a = document.getElementById('va').value.trim();
      var b = document.getElementById('vb').value.trim();
      if (!a) return;
      p.items.push({ a: a, b: b });
      persist(); renderVocab(p);
    });
  }
  function stepV(d, p) {
    var items = p.items || [];
    var pool = p._order ? p._order : null;
    if (pool) {
      var cur = pool.indexOf(items[vIdx] && items[vIdx].a);
      cur = (cur + d + pool.length) % pool.length;
      var target = pool[cur];
      for (var i = 0; i < items.length; i++) if (items[i].a === target) { vIdx = i; break; }
    } else {
      vIdx = (vIdx + d + items.length) % items.length;
    }
    vFace = false; vPick = -1; vOpts = null; vResult = '';
    renderVocab(p);
  }
  function markV(p, key, ok) {
    p.known = p.known || {};
    if (ok) p.known[key] = 1; else delete p.known[key];
    persist();
  }

  /* ============ listen ============ */
  var audioEl = null, playingIdx = -1;
  function renderListen(p) {
    var items = p.items || [];
    var h = '<div class="ptip">链接填 http(s) 音频可直接播放；本地文件路径点「打开」用默认播放器放</div>';
    if (items.length) {
      h += items.map(function (it, i) {
        var isHttp = /^https?:\/\//i.test(it.src || '');
        return '<div class="litem" data-i="' + i + '">' +
          '<div class="lt">' + esc(it.title || it.src || '未命名') +
          '<small>' + esc(it.src || '（未填来源）') + '</small></div>' +
          (isHttp ? '<button data-a="play">播放</button>' : '<button data-a="open">打开</button>') +
          '<button data-a="loop" class="' + (it.loop ? 'on' : '') + '">循环</button>' +
          '<button class="del" data-a="del">✕</button></div>';
      }).join('');
    } else {
      h += '<div class="empty">还没有听力条目</div>';
    }
    h += '<div class="sform"><input id="lt" placeholder="标题（如 BBC 6 Minute English）">' +
      '<input id="ls" placeholder="音频链接或本地路径"><button id="lAdd">添加</button></div>';
    pane.innerHTML = h;
    if (!audioEl) { audioEl = document.createElement('audio'); audioEl.preload = 'none'; }
    pane.querySelectorAll('.litem').forEach(function (row) {
      var i = Number(row.dataset.i);
      row.querySelectorAll('button').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = b.dataset.a;
          var it = items[i];
          if (a === 'play') {
            if (playingIdx === i && !audioEl.paused) { audioEl.pause(); playingIdx = -1; return; }
            audioEl.src = it.src;
            audioEl.loop = !!it.loop;
            audioEl.play().then(function () { playingIdx = i; }).catch(function () {
              alert('播放失败：链接可能不允许直接播放，试试「打开」');
            });
          } else if (a === 'open') {
            if (!it.src) { alert('还没填来源'); return; }
            if (/^https?:\/\//i.test(it.src)) api.openExternal(it.src);
            else api.launchApp(it.src);
          } else if (a === 'loop') {
            it.loop = !it.loop;
            if (playingIdx === i) audioEl.loop = !!it.loop;
            b.classList.toggle('on', !!it.loop);
            persist();
          } else if (a === 'del') {
            items.splice(i, 1); persist(); renderListen(p);
          }
        });
      });
    });
    document.getElementById('lAdd').addEventListener('click', function () {
      var t = document.getElementById('lt').value.trim();
      var s = document.getElementById('ls').value.trim();
      if (!s) { alert('填一个音频链接或本地路径'); return; }
      items.push({ title: t || s, src: s, loop: true });
      persist(); renderListen(p);
    });
  }

  /* ============ speak ============ */
  function renderSpeak(p) {
    var items = p.items || [];
    var h = '<div class="srow" style="display:flex;gap:6px;margin-bottom:10px">' +
      '<button id="sRand" style="flex:1;appearance:none;border:1px solid rgba(244,123,92,.45);border-radius:8px;background:rgba(244,123,92,.15);color:#ffb9a6;font:600 11px/1 \"Microsoft YaHei\",sans-serif;padding:9px 0;cursor:pointer">🎲 随机抽一条</button></div>' +
      '<div id="sCard"></div>';
    if (items.length) {
      h += '<div class="qlist">' + items.map(function (it, i) {
        return '<div class="qitem' + (it.done ? ' done' : '') + '" data-i="' + i + '">' +
          '<span class="qt">' + esc(it.text) + (it.cn ? '<br><small style="color:var(--ink-4)">' + esc(it.cn) + '</small>' : '') + '</span>' +
          '<span class="mini" data-a="done">' + (it.done ? '撤销' : '会了') + '</span>' +
          '<span class="mini" data-a="del">✕</span></div>';
      }).join('') + '</div>';
    } else {
      h += '<div class="empty">还没有句子，在下面添加</div>';
    }
    h += '<div class="sform"><input id="st" placeholder="句子 / 题目"><input id="sc" placeholder="中文（可选）">' +
      '<button id="sAdd">添加</button></div>';
    pane.innerHTML = h;
    document.getElementById('sRand').addEventListener('click', function () {
      if (!items.length) return;
      var it = items[Math.floor(Math.random() * items.length)];
      document.getElementById('sCard').innerHTML =
        '<div class="qcard"><div class="tag">RANDOM</div>' + esc(it.text) +
        (it.cn ? '<div class="cn">' + esc(it.cn) + '</div>' : '') + '</div>';
    });
    pane.querySelectorAll('.qitem').forEach(function (row) {
      var i = Number(row.dataset.i);
      row.addEventListener('click', function (e) {
        var it = items[i];
        if (e.target.dataset.a === 'done') { it.done = !it.done; persist(); renderSpeak(p); return; }
        if (e.target.dataset.a === 'del') { items.splice(i, 1); persist(); renderSpeak(p); return; }
        document.getElementById('sCard').innerHTML =
          '<div class="qcard"><div class="tag">#' + (i + 1) + '</div>' + esc(it.text) +
          (it.cn ? '<div class="cn">' + esc(it.cn) + '</div>' : '') + '</div>';
      });
    });
    document.getElementById('sAdd').addEventListener('click', function () {
      var t = document.getElementById('st').value.trim();
      var c = document.getElementById('sc').value.trim();
      if (!t) return;
      items.push({ text: t, cn: c, done: false });
      persist(); renderSpeak(p);
    });
  }

  /* ============ note (classified material library) ============ */
  var nCat = '';
  function renderNote(p) {
    var cats = p.cats || [];
    var items = p.items || [];
    if (cats.length && !nCat) nCat = cats[0].name;
    var h = '<div class="ptip">自定义分类 + 条目，点正文复制。参考图卡片的分类法搬到这里。</div>';
    h += '<div class="cats">' + cats.map(function (c) {
      return '<button class="cat' + (c.name === nCat ? ' on' : '') + '" data-c="' + esc(c.name) + '"' +
        ' style="border-color:' + esc(c.color) + ';' + (c.name === nCat ? 'background:' + esc(c.color) + '33;' : '') + '">' + esc(c.name) + '</button>';
    }).join('') + '<button class="cat catadd" id="catAdd">＋ 分类</button></div>';
    var shown = items.filter(function (it) { return it.cat === nCat; });
    if (shown.length) {
      h += shown.map(function (it) {
        var gi = items.indexOf(it);
        return '<div class="nitem"><div class="nt"><span>' + esc(it.title) + '</span>' +
          '<span class="del" data-i="' + gi + '">✕</span></div>' +
          '<div class="nb" data-i="' + gi + '">' + esc(it.body) + '</div></div>';
      }).join('');
    } else {
      h += '<div class="empty">这个分类还是空的</div>';
    }
    h += '<div class="sform"><input id="nt" placeholder="标题"><button id="nAdd">添加条目</button></div>' +
      '<div class="sform" style="margin-top:0"><input id="nb" placeholder="内容（可多行，点条目正文复制）"></div>';
    pane.innerHTML = h;
    pane.querySelectorAll('.cat[data-c]').forEach(function (b) {
      b.addEventListener('click', function () { nCat = b.dataset.c; renderNote(p); });
    });
    document.getElementById('catAdd').addEventListener('click', function () {
      var name = prompt('新分类名称：', '新分类');
      if (!name || !name.trim()) return;
      p.cats = p.cats || [];
      p.cats.push({ name: name.trim(), color: '#f47b5c' });
      nCat = name.trim();
      persist(); renderNote(p);
    });
    pane.querySelectorAll('.nitem .del').forEach(function (b) {
      b.addEventListener('click', function () { items.splice(Number(b.dataset.i), 1); persist(); renderNote(p); });
    });
    pane.querySelectorAll('.nb').forEach(function (b) {
      b.addEventListener('click', function () {
        var it = items[Number(b.dataset.i)];
        if (it && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(it.body || '').catch(function () {});
        }
        var old = b.innerHTML;
        b.innerHTML = '已复制 ✓';
        setTimeout(function () { renderNote(p); }, 700);
      });
    });
    document.getElementById('nAdd').addEventListener('click', function () {
      var t = document.getElementById('nt').value.trim();
      var body = document.getElementById('nb').value;
      if (!t && !body.trim()) return;
      items.push({ cat: nCat || (cats[0] && cats[0].name) || '默认', title: t || '未命名', body: body.trim() });
      persist(); renderNote(p);
    });
  }

  /* ---------- dispatch ---------- */
  function renderPane() {
    var p = active();
    if (!p) { pane.innerHTML = '<div class="empty">没有项目，点上面 ＋ 新建</div>'; return; }
    audioPause();
    if (p.kind === 'vocab') renderVocab(p);
    else if (p.kind === 'listen') renderListen(p);
    else if (p.kind === 'speak') renderSpeak(p);
    else if (p.kind === 'note') renderNote(p);
    else pane.innerHTML = '<div class="empty">未知类型：' + esc(p.kind) + '（管理里可改）</div>';
  }
  function audioPause() { if (audioEl && !audioEl.paused) { audioEl.pause(); playingIdx = -1; } }
  function renderAll() { renderRail(); renderPane(); }

  /* keyboard nav only while the vocab pane is up */
  document.addEventListener('keydown', function (e) {
    if (!data) return;
    var p = active();
    if (!p || p.kind !== 'vocab' || !pane.querySelector('.vwrap')) return;
    if (e.key === 'ArrowLeft') stepV(-1, p);
    else if (e.key === 'ArrowRight') stepV(1, p);
    else if (e.key === ' ') { e.preventDefault(); vFace = !vFace; renderVocab(p); }
    else if (/^[1-4]$/.test(e.key) && vOpts && vPick < 0) pickChoice(p, Number(e.key) - 1);
  });

  /* ---------- boot ---------- */
  api.getState().then(function (c) {
    cfg = c;
    data = (c && c.study && c.study.projects) ? c.study : starter();
    if (!data.active || !data.projects.some(function (p) { return p.id === data.active; })) {
      data.active = data.projects[0] && data.projects[0].id;
    }
    renderAll();
    if (!c || !c.study) persist();   // seed starter pack on first run
  });
})();
