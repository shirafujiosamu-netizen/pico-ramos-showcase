/* Pico RamOS - GridPack layout engine.
 *
 * Pure functions, no DOM: os.js owns rendering, this file owns the maths of
 * "which card sits in which cell". Two rules the old free-placement code
 * could not guarantee are enforced here by construction:
 *
 *   1. NO OVERLAP - every card is packed into a free run of cells before it
 *      is ever drawn, so a card can never be painted on top of another.
 *   2. FIXED UNIT SYSTEM - 1U = 1/50 of the screen width, applied as a
 *      SQUARE unit on both axes. A card is always an integer number of U and
 *      its reduced w:h must be one of ALLOWED_RATIOS. The old "6x5 cells"
 *      stretched with the viewport, so a 2x2 card could end up 1.67:1 --
 *      an accidental ratio that also made every card far too big.
 *
 * Everything is deterministic for a given (seed, card set), so a saved layout
 * replays exactly and user drags survive a reboot.
 */
window.PicoLayout = (function () {
  'use strict';

  var UNIT_DIV = 50;              /* 1U = screen width / 50 */
  var MIN_U = 4, MAX_U = 18, MAX_AREA_U = 200;
  var ALLOWED_RATIOS = [[1, 1], [1, 2], [2, 1], [2, 3], [3, 2], [1, 4], [4, 5]];

  /* Canonical shapes, all in U and all reducing to an allowed ratio.
     `video` is the single deliberately larger card (Bilibili). */
  var SHAPES = {
    square:    [8, 8],    /* 1:1  ~4.1% of the screen */
    sliver:    [5, 10],   /* 1:2 */
    bar:       [10, 5],   /* 2:1 */
    portrait:  [8, 12],   /* 2:3 */
    landscape: [12, 8],   /* 3:2 */
    column:    [4, 16],   /* 1:4 */
    soft:      [8, 10],   /* 4:5  inbox only - folders are 1:1 squares */
    video:     [15, 10]   /* 3:2  the big Bili card */
  };

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a || 1; }
  function ratioOf(w, h) { var g = gcd(w, h); return [w / g, h / g]; }
  function isAllowedShape(w, h) {
    if (w < MIN_U || h < MIN_U || w > MAX_U || h > MAX_U || w * h > MAX_AREA_U) return false;
    var r = ratioOf(w, h);
    return ALLOWED_RATIOS.some(function (q) { return q[0] === r[0] && q[1] === r[1]; });
  }
  function shape(key) { return (SHAPES[key] || SHAPES.square).slice(); }

  /* A hand-resized card must land back on the design system: pick the allowed
     integer-U shape closest to the dropped size. This is what stops "随便
     设置" sizes from creeping back in after a drag. */
  function snapShape(w, h) {
    var best = shape('square'), bestD = Infinity, a, b, d;
    for (a = MIN_U; a <= MAX_U; a += 1) {
      for (b = MIN_U; b <= MAX_U; b += 1) {
        if (!isAllowedShape(a, b)) continue;
        d = Math.abs(a - w) + Math.abs(b - h);
        if (d < bestD) { bestD = d; best = [a, b]; }
      }
    }
    return best;
  }

  /* span pools: [shapeName, weight]. No raw pixel or accidental cell spans. */
  var POOLS = {
    music:    [['square', 1]],
    mail:     [['soft', 4], ['bar', 2], ['sliver', 1]],
    bili:     [['video', 3], ['landscape', 2], ['square', 1]],
    web:      [['soft', 3], ['bar', 2], ['sliver', 1]],
    netease:  [['square', 1]],
    qqmusic:  [['square', 1]],
    folder:   [['soft', 4], ['sliver', 2], ['bar', 1]],
    app:      [['square', 1]],
    clock:    [['square', 2], ['sliver', 2], ['bar', 1]],
    pomodoro: [['square', 2], ['sliver', 2], ['bar', 1]],
    weather:  [['sliver', 1]],
    schedule: [['soft', 3], ['sliver', 2], ['bar', 1]],
    sys:      [['bar', 3], ['square', 2], ['sliver', 1]],
    vpn:      [['bar', 2], ['sliver', 1]],
    module:   [['sliver', 1]],
    pet:      [['sliver', 1]]
  };
  var DEFAULT_POOL = [['square', 1]];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(pool, rng) {
    var total = 0, i;
    for (i = 0; i < pool.length; i += 1) total += pool[i][1];
    var r = rng() * total;
    for (i = 0; i < pool.length; i += 1) {
      r -= pool[i][1];
      if (r <= 0) return shape(pool[i][0]);
    }
    return shape(pool[0][0]);
  }

  /* cards must arrive in a stable order: state order replays a seed exactly */
  function assignSpans(cards, seed) {
    var rng = mulberry32(seed >>> 0);
    var out = {};
    (cards || []).forEach(function (c) {
      if (!c || !c.id) return;
      out[c.id] = pick(POOLS[c.kind] || DEFAULT_POOL, rng);
    });
    /* Pure weighted sampling can flatten a seed into a wall of identical
       squares. Demand one real 2:1 BAR, one 1:2 SLIVER and one 1:1 square on
       every seed; which card wears which is still seed-driven. Anchors only
       pick from kinds whose own pool has more than one allowed shape. */
    var ids = Object.keys(out);
    var flexible = ids.filter(function (id) {
      var card = (cards || []).filter(function (x) { return x && x.id === id; })[0];
      var pool = card ? (POOLS[card.kind] || DEFAULT_POOL) : DEFAULT_POOL;
      return pool.length > 1;
    });
    var used = {};
    function anchor(key) {
      var want = shape(key);
      if (ids.some(function (id) {
        return out[id][0] === want[0] && out[id][1] === want[1];
      })) return;
      for (var i = 0; i < flexible.length; i += 1) {
        var id = flexible[i];
        if (used[id]) continue;
        out[id] = want;
        used[id] = true;
        return;
      }
    }
    anchor('bar');
    anchor('sliver');
    anchor('square');
    /* Content-heavy kinds are pinned so a re-roll can never make a folder or
       the inbox swallow half the desktop again. Bili is the one card that is
       allowed to be larger -- 15U x 10U is still exactly 3:2. */
    (cards || []).forEach(function (c) {
      if (!c || !c.id || !out[c.id]) return;
      if (c.kind === 'bili') out[c.id] = shape('video');
      else if (c.kind === 'mail') out[c.id] = shape('soft');
      else if (c.kind === 'folder') out[c.id] = shape('square');
    });
    return out;
  }

  function key(x, y) { return x + ',' + y; }

  function fits(grid, cols, rows, x, y, w, h) {
    var i, j;
    if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
    for (j = y; j < y + h; j += 1) {
      for (i = x; i < x + w; i += 1) {
        if (grid.has(key(i, j))) return false;
      }
    }
    return true;
  }

  function occupy(grid, x, y, w, h) {
    var i, j;
    for (j = y; j < y + h; j += 1) {
      for (i = x; i < x + w; i += 1) grid.add(key(i, j));
    }
  }

  function firstFree(grid, cols, rows, w, h) {
    var x, y;
    for (y = 0; y <= rows - h; y += 1) {
      for (x = 0; x <= cols - w; x += 1) {
        if (fits(grid, cols, rows, x, y, w, h)) return { x: x, y: y };
      }
    }
    return null;
  }

  /* First-fit-decreasing pack across as many pages as needed. Big cards land
     first so they anchor the page; small ones fill the gaps around them.
     `pinId` (optional) is placed at its own cell before anything else. */
  function pack(items, cols, rows, pinId) {
    var list = (items || []).slice().sort(function (a, b) {
      return (b.w * b.h - a.w * a.h) || (a.id < b.id ? -1 : 1);
    });
    var pin = null;
    if (pinId) {
      pin = list.filter(function (it) { return it.id === pinId; })[0] || null;
      if (pin) list = list.filter(function (it) { return it.id !== pinId; });
    }
    var pages = [[]];
    var grid = new Set();
    if (pin) {
      if (fits(grid, cols, rows, pin.x, pin.y, pin.w, pin.h)) {
        occupy(grid, pin.x, pin.y, pin.w, pin.h);
        pages[0].push({ cardId: pin.id, x: pin.x, y: pin.y, w: pin.w, h: pin.h });
      } else {
        list.push(pin);           /* pin blocked: treat it as a normal item */
      }
    }
    list.forEach(function (it) {
      var spot = firstFree(grid, cols, rows, it.w, it.h);
      if (!spot) {                /* page full: start the next one */
        grid = new Set();
        pages.push([]);
        spot = firstFree(grid, cols, rows, it.w, it.h);
      }
      occupy(grid, spot.x, spot.y, it.w, it.h);
      pages[pages.length - 1].push({ cardId: it.id, x: spot.x, y: spot.y, w: it.w, h: it.h });
    });
    return pages;
  }

  /* Drag-end conflict resolution for ONE page: the pinned card keeps its
     cell, everybody it now covers slides to the nearest free cell. Anything
     with no room at all comes back as `overflow` for the caller to rehome. */
  function resolveOnPage(cells, cols, rows, pinId) {
    var grid = new Set();
    var out = [];
    var overflow = [];
    var ordered = (cells || []).slice().sort(function (a, b) {
      if (a.cardId === pinId) return -1;
      if (b.cardId === pinId) return 1;
      return 0;
    });
    ordered.forEach(function (c) {
      var spot = null;
      if (fits(grid, cols, rows, c.x, c.y, c.w, c.h)) {
        spot = { x: c.x, y: c.y };
      } else {
        spot = firstFree(grid, cols, rows, c.w, c.h);
      }
      if (!spot) { overflow.push(c); return; }
      occupy(grid, spot.x, spot.y, c.w, c.h);
      out.push({ cardId: c.cardId, x: spot.x, y: spot.y, w: c.w, h: c.h });
    });
    return { cells: out, overflow: overflow };
  }

  var GLASS = ['glass-liquid', 'glass-fluted', 'glass-frosted'];

  /* Balanced glass assignment across the whole card set (not per-card random):
     every texture appears as evenly as possible (3:3:3 with 9 cards, 4:3:3 with
     10, 3:2:2 with 7). Seed still shuffles WHICH card gets WHICH texture, so a
     re-roll changes the look, but no single texture can dominate. */
  function buildGlassMap(ids, seed) {
    ids = (ids || []).filter(Boolean);
    var n = ids.length;
    var base = Math.floor(n / 3);
    var rem = n % 3;
    var pool = [];
    for (var g = 0; g < 3; g += 1) {
      var cnt = base + (g < rem ? 1 : 0);
      for (var k = 0; k < cnt; k += 1) pool.push(GLASS[g]);
    }
    var rng = mulberry32(((seed >>> 0) ^ 0x85ebca6b) >>> 0);
    for (var i = pool.length - 1; i > 0; i -= 1) {
      var j = Math.floor(rng() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    var map = {};
    ids.forEach(function (id, idx) { map[id] = pool[idx]; });
    return map;
  }

  /* Seeded + salted by card id: every card gets its own texture, and the whole
     set is re-dealt whenever the layout seed changes. */
  function rollGlass(seed, salt) {
    var r = mulberry32(((seed >>> 0) ^ 0x9e3779b9) + (salt >>> 0) * 1013904223)();
    return GLASS[Math.min(2, Math.floor(r * 3))];
  }

  function hashString(s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h >>> 0;
  }

  return {
    POOLS: POOLS,
    SHAPES: SHAPES,
    UNIT_DIV: UNIT_DIV,
    ALLOWED_RATIOS: ALLOWED_RATIOS,
    isAllowedShape: isAllowedShape,
    snapShape: snapShape,
    ratioOf: ratioOf,
    mulberry32: mulberry32,
    assignSpans: assignSpans,
    pack: pack,
    resolveOnPage: resolveOnPage,
    rollGlass: rollGlass,
    buildGlassMap: buildGlassMap,
    hashString: hashString
  };
})();
