// Pico RamOS main process - desktop card system.
// Cards = frameless transparent windows. Each card is one of:
//   app    : launches an external exe/bat (workbench, WeChat, TIM, ...)
//   web    : embedded <webview> of a URL (Gmail / QQ mail / 163 ...)
//   module : built-in page (study card, mail card, ...)
// Users import their own software paths; every card keeps its own
// position / size / opacity / color. Cards snap to each other's edges
// (and screen edges) when close, and do NOT snap when far apart.
//
// Global switches (persisted in cards.json):
//   mode: 'top'     - classic: each card decides its own always-on-top
//          'desktop' - widget mode: all cards sit at the bottom of the
//                      z-order (above wallpaper, below every other window)
//   clickThrough    - master switch: when on, clicks pass through cards to
//                     the windows below (per-card override via cfg.clickThrough)
// Ctrl+Alt+D toggles drag mode: temporarily makes every card interactive so
// cards can be moved even while click-through is on.

const { spawnSync } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, shell, nativeTheme, systemPreferences, desktopCapturer, nativeImage, powerMonitor } = require('electron');
/* alias: Node's net is already required below; Electron's net.fetch uses
   the Chromium stack, so it honours the system proxy / TUN route. */
const { net: electronNet, session } = require('electron');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const https = require('https');
const { spawn, exec } = require('child_process');

const APP_DIR = __dirname;
const CONF_FILE = path.join(APP_DIR, 'cards.json');
const LOG_FILE = path.join(APP_DIR, 'card-os.log');
const ZORDER_PS1 = path.join(APP_DIR, 'desktop-mode.ps1');
const HUB_PORT = 8848;
const SNAP_PX = 14;                 // edge snap threshold (px). Farther = no snap.
const MIN_W = 200, MIN_H = 120;
/* Refined layout language (review 2026-10-15: "ugly, too big, no gaps"):
 * auto-layout keeps a uniform breathing gap between cards, a margin from the
 * screen edge, and never makes a card bulkier than the max box - a wall of
 * near-fullscreen slabs read as cluttered, a spaced grid reads as designed. */
const SNAP_GAP = 16;                // card<->card snap keeps this gap (flush-0 = ugly)
const LAYOUT_MARGIN = 20;           // packer: room from the screen edge
const LAYOUT_GAP = 16;              // packer: uniform gap between cards
const LAYOUT_MAX_W = 340, LAYOUT_MAX_H = 460;   // packer: size ceiling

/* Move a window by x/y WITHOUT ever letting Windows grow it. A frameless
 * transparent window passed a fractional rect (and, on some DPI scalings, even
 * a plain setPosition) gets silently expanded by ~1px; re-saving that grown
 * size then made the card visibly enlarge on every drag. Pinning the size
 * kills the accumulation ONLY if the pinned value is an AUTHORITATIVE one
 * (see baseW/baseH on the card entry) - pinning the live getBounds() read
 * still ratchets, because the read itself is the polluted value. Callers
 * must pass the card's base size, never b.width/b.height from a fresh read. */
function moveWindow(win, x, y, w, h) {
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
}
/* Commit a rect WE chose (layout / resize / snap). Real electron emits
 * 'move' ASYNCHRONOUSLY, so the echo of this setBounds arrives after the
 * caller returned and would run snapEdges - dragging the card 10-16px off
 * the rect we just committed (saved conf and on-screen window disagreed).
 * Recording the rect lets the move handler recognise its own echo by
 * identity: only a window sitting exactly on a committed rect is skipped,
 * every genuine user drag still snaps. */
const placedRects = new Map();      // win -> {x,y,w,h} we just committed
function commitRect(win, x, y, w, h) {
  placedRects.set(win, { x: Math.round(x), y: Math.round(y), w: w, h: h });
  moveWindow(win, x, y, w, h);
}

/* Autostart is a SWITCH and defaults to OFF (user request, 2026-10-13).
 * Portable electron cannot rely on setLoginItemSettings (it would launch a bare
 * electron.exe with no app dir), so enabling writes a tiny hidden Startup vbs
 * that resolves the electron binary and starts the app. Disabling removes it. */
const STARTUP_DIR = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
);
const AUTOSTART_VBS = path.join(STARTUP_DIR, 'PicoRamOS-autostart.vbs');

/* ---------------- logging ---------------- */
function log() {
  const parts = Array.prototype.map.call(arguments, (a) => {
    if (a instanceof Error) return a.stack || a.message;
    return String(a);
  });
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 200 * 1024) fs.writeFileSync(LOG_FILE, '', 'utf8');
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + parts.join(' ') + '\n', 'utf8');
  } catch (e) {}
}
process.on('uncaughtException', (e) => {
  log('UNCAUGHT', e);
  /* A corrupt config or a broken helper must never leave the native taskbar
     hidden with no running shell to renew the lease. */
  try { setShellTakeover(false); } catch (e2) {}
});
process.on('unhandledRejection', (e) => log('UNHANDLED', e));

/* ELECTRON_RUN_AS_NODE leaks from some dev tools. require('electron') then
   returns a path STRING, every destructured API is undefined, and the app
   dies with the misleading "ipcMain.handle is not a function". Say it out
   loud instead - and do it before the first handler is registered. */
if (!app || !ipcMain || typeof app.requestSingleInstanceLock !== 'function') {
  const msg = 'Pico RamOS must run inside Electron. Unset ELECTRON_RUN_AS_NODE and launch with start.bat.';
  log('FATAL', msg, 'ELECTRON_RUN_AS_NODE=' + (process.env.ELECTRON_RUN_AS_NODE || '(unset)'));
  try { if (dialog && dialog.showErrorBox) dialog.showErrorBox('Pico RamOS', msg); } catch (e) {}
  process.exit(1);
}

/* ---------------- config ---------------- */
function uid() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ---- config safety net ---------------------------------------------------
   cards.json is the ONLY copy of the user's layout, shortcuts and mail setup.
   A half-written file, a sync tool, a bad edit or a disk-full error used to be
   silently replaced by a fresh seed, which is an unrecoverable data loss.
   Rules now: quarantine first, recover from tmp/backups, validate the shape,
   write atomically per-process, fsync, rotate a few backups, never write on
   an unchanged boot. */
/* Deliberately NOT 'cards.json.bak-': the project already contains 14 manual
   backups with that prefix. Those are read-only recovery candidates and must
   NEVER be rotated away by an automatic cleanup. */
const CONF_BAK_PREFIX = 'cards.json.autobak-';
const CONF_LEGACY_BAK_RE = /^cards\.json\.bak(?:-|$)/;
const CONF_BROKEN_PREFIX = 'cards.json.broken-';
const MAX_CONF_BAK = 5;
const CONF_BACKUP_MS = 10 * 60 * 1000;
let confWriteBusy = false;
let confWritePending = false;
let confBackupAt = 0;
let confLastError = '';

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function confBackups() {
  try {
    return fs.readdirSync(APP_DIR)
      .filter((n) => n.indexOf(CONF_BAK_PREFIX) === 0 || CONF_LEGACY_BAK_RE.test(n))
      .map((n) => ({ n: n, t: fs.statSync(path.join(APP_DIR, n)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch (e) { return []; }
}

/* Valid JSON is not the same as a valid config. A truncated-but-parseable
   object used to pass the old `Array.isArray(conf.cards)` check and then blow
   up much later, in unrelated IPC handlers. */
function confShapeOk(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  if (!Array.isArray(o.cards)) return false;
  if (o.cards.some((c) => !c || typeof c.id !== 'string' || !c.id || typeof c.kind !== 'string')) return false;
  if (o.layout && (!Array.isArray(o.layout.pages) ||
      o.layout.pages.some((p) => !p || !Array.isArray(p.cells)))) return false;
  if (o.mail != null && !Array.isArray(o.mail)) return false;
  if (o.scenes != null && !Array.isArray(o.scenes)) return false;
  return true;
}

function readConfFile(file) {
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return confShapeOk(o) ? o : null;
  } catch (e) { return null; }
}

function quarantineBrokenConf() {
  try {
    if (!fs.existsSync(CONF_FILE)) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dst = CONF_FILE + '.broken-' + stamp;
    fs.copyFileSync(CONF_FILE, dst);
    log('config unreadable -> quarantined', path.basename(dst));
  } catch (e) { log('config quarantine fail', e.message); }
}

function recoveryCandidates() {
  const out = [CONF_FILE + '.tmp', CONF_FILE + '.tmp-' + process.pid];
  confBackups().forEach((b) => out.push(path.join(APP_DIR, b.n)));
  return out;
}

function rotateConfBackups() {
  try {
    /* ONLY our own autobak files are disposable. Manual .bak-* files stay on
       disk forever, even if they are older. */
    const own = confBackups().filter((b) => b.n.indexOf(CONF_BAK_PREFIX) === 0);
    for (let i = MAX_CONF_BAK; i < own.length; i++) {
      try { fs.unlinkSync(path.join(APP_DIR, own[i].n)); } catch (e) {}
    }
  } catch (e) { /* best effort */ }
}

function configHealth() {
  return {
    ok: !confLastError,
    lastError: confLastError,
    backups: confBackups().length,
    broken: (() => {
      try { return fs.readdirSync(APP_DIR).filter((n) => n.indexOf(CONF_BROKEN_PREFIX) === 0).length; }
      catch (e) { return 0; }
    })()
  };
}

// Starter cards for a FRESH install. Deliberately free of any personal path:
// every machine imports its own programs through the manager. Web cards are
// generic URLs anyone can use.
/* Bring the user's desktop shortcuts into the shell as launcher cards.
 * Idempotent: cards carry source:'desktop' plus the .lnk filename in
 * shortcut, so re-running only adds new ones and drops deleted ones. */
/* The renderer replays saved pages only when layout.sig matches the live card
   set. Keep the two signatures identical or a boot re-packs everything. */
function layoutCardSig() {
  return conf.cards.filter(Boolean)
    .map((c) => c.id).sort().join(',');
}

/* Reconcile the saved scene pages with the live card set WITHOUT rearranging
   them. The old implementation re-packed every card into 1x1 cells on every
   boot, which silently destroyed page names, sizes and hand-dragged positions.
   Now only newborn cards get a free slot and dead cells are removed. */
function rebuildLayoutFromCards() {
  try {
    const layout = conf.layout || (conf.layout = { cols: 4, rows: 3, pages: [], dock: [] });
    const cols = layout.cols || 4, rows = layout.rows || 3;
    if (!Array.isArray(layout.pages) || !layout.pages.length) {
      layout.pages = [{ id: 'p1', name: '\u529E\u516C', cells: [] }];
    }
    const live = conf.cards.filter(Boolean);
    const liveIds = new Set(live.map((c) => c.id));

    layout.pages.forEach((pg) => {
      if (!Array.isArray(pg.cells)) pg.cells = [];
      pg.cells = pg.cells.filter((cell) => cell && cell.cardId && liveIds.has(cell.cardId));
    });

    const placed = new Set();
    layout.pages.forEach((pg) => pg.cells.forEach((cell) => placed.add(cell.cardId)));

    /* A newborn card (a shortcut that appeared on the desktop) must also obey
       the 1U ratio system. The old 1x1 placeholder was a fraction of a unit
       and produced a tiny, off-system card. */
    const L = shellLayoutModule();
    for (const c of live) {
      if (placed.has(c.id)) continue;
      let want = null;
      try {
        if (L && L.assignSpans) want = L.assignSpans([c], 1)[c.id];
      } catch (e) { want = null; }
      const sw = (want && want[0]) || 8;
      const sh = (want && want[1]) || 8;
      const used = new Set();
      let slot = null, host = null;
      for (const pg of layout.pages) {
        used.clear();
        pg.cells.forEach((cell) => {
          for (let i = cell.x; i < cell.x + (cell.w || 1); i += 1) {
            for (let j = cell.y; j < cell.y + (cell.h || 1); j += 1) used.add(i + ',' + j);
          }
        });
        for (let y = 0; y + sh <= rows && !slot; y += 1) {
          for (let x = 0; x + sw <= cols && !slot; x += 1) {
            let free = true;
            for (let i = x; i < x + sw && free; i += 1) {
              for (let j = y; j < y + sh; j += 1) {
                if (used.has(i + ',' + j)) { free = false; break; }
              }
            }
            if (free) slot = { cardId: c.id, x, y, w: sw, h: sh };
          }
        }
        if (slot) { host = pg; break; }
      }
      if (!slot) {
        host = { id: 'p' + (layout.pages.length + 1),
                 name: '\u573A\u666F' + (layout.pages.length + 1), cells: [] };
        layout.pages.push(host);
        slot = { cardId: c.id, x: 0, y: 0, w: sw, h: sh };
      }
      host.cells.push(slot);
      placed.add(c.id);
    }

    layout.pages.forEach((pg, i) => pg.cells.forEach((cell) => {
      const card = conf.cards.find((k) => k && k.id === cell.cardId);
      if (!card) return;
      card.page = i;
      card.spanW = cell.w || 1;
      card.spanH = cell.h || 1;
    }));
    layout.sig = layoutCardSig();
    saveConf();
  } catch (err) {
    log('rebuildLayoutFromCards failed: ' + (err && err.message));
  }
}

/* The Windhawk mod watches for this file: present = hide taskbar and
   desktop icons, absent = show them again. */
/* Agent artefacts live on F: / G: only. Pico never writes to C: at run time.
   The Windhawk mod's own install dir is read once for diagnostics; it is a
   third-party system component, not an artefact we create. */
const RUN_DIR = path.join(APP_DIR, 'run');
try { if (!fs.existsSync(RUN_DIR)) fs.mkdirSync(RUN_DIR, { recursive: true }); } catch (e) {}
const SHELL_FLAG = path.join(RUN_DIR, 'pico-ram-os-shell.on');

/* v1.2 Windhawk mods still watch C:/Temp and call SW_SHOW every 2 s when that
   file is absent. We deliberately do NOT create it any more (no C: writes).
   Instead detect the stale mod once, read-only, and let the resident Win32
   helper re-hide at a short interval until the admin installer upgrades it.
   On the v1.5 mod this detector is false and the slow 10 s watchdog applies. */
const WINDHAWK_MOD_SRC = 'C:\\ProgramData\\Windhawk\\ModsSource\\local@pico-ram-os-desktop.wh.cpp';
let legacyMod = null;
function legacyModActive() {
  if (legacyMod !== null) return legacyMod;
  try {
    legacyMod = fs.readFileSync(WINDHAWK_MOD_SRC, 'utf8')
      .indexOf('L"C:/Temp/pico-ram-os-shell.on"') >= 0;
  } catch (e) { legacyMod = false; }
  if (legacyMod) log('old Windhawk mod detected -> no C: flag written; run install-windhawk-launcher.bat as administrator to finish the migration');
  return legacyMod;
}
function syncFlag(on) {
  try {
    if (on) fs.writeFileSync(SHELL_FLAG, 'on');
    else if (fs.existsSync(SHELL_FLAG)) fs.unlinkSync(SHELL_FLAG);
  } catch (e) { log('shell flag failed: ' + (e && e.message)); }
}


/* Isolation guard: the switch file keeps the taskbar hidden. If this process
   dies dirty (taskkill /F, crash) nothing would ever remove it and Windows would
   be left with no taskbar and no start menu. A tiny watchdog outlives us just
   long enough to delete it. */
/* Retired: a resident PowerShell polling Get-Process every 800 ms cost more
 * than it protected. The 15 s lease in the Windhawk mod does the same job
 * with zero processes. Left as a named no-op for older configs/logs. */
function startFlagWatchdog() { /* lease replaced me */ }


/* The switch file is a lease, not a switch: this process keeps renewing it.
   If anything kills us - including taskkill /T, which takes our children with
   it - the file goes stale and the mod releases the desktop on its own. */
const FLAG_TOUCH_MS = 5000;
let flagTimer = null;
function startFlagLease() {
  if (flagTimer) return;
  const touch = () => {
    try { if (fs.existsSync(SHELL_FLAG)) fs.utimesSync(SHELL_FLAG, new Date(), new Date()); }
    catch (e) { /* best effort */ }
  };
  flagTimer = setInterval(touch, FLAG_TOUCH_MS);
  if (flagTimer.unref) flagTimer.unref();
}

function setShellTakeover(on) {
  /* Windhawk now treats the flag as a 15 s lease (and the flag itself lives
     on F:), so no watchdog process and no C: writes are needed. */
  if (on) startFlagLease();
  syncFlag(on);
  log('desktop takeover:', on ? 'on' : 'off');
}

const ICON_DIR = path.join(APP_DIR, '.icons');
function ensureIconDir() {
  try { if (!fs.existsSync(ICON_DIR)) fs.mkdirSync(ICON_DIR, { recursive: true }); } catch (e) {}
}

/* Resolve a .lnk down to the real executable. getFileIcon on the shortcut
   itself hands back the generic white-page glyph, so follow the link first. */
function resolveShortcutTarget(target) {
  try {
    if (!target || !target.toLowerCase().endsWith('.lnk')) return target;
    const link = shell.readShortcutLink(target);
    return (link && (link.target || link.icon)) || target;
  } catch (e) {
    return target;
  }
}

/* Shell cards get a real icon instead of a play glyph: read it out of the
   shortcut's target once and cache the PNG on disk keyed by the card id. */
async function cardIconFor(card) {
  ensureIconDir();
  const png = path.join(ICON_DIR, card.id + '.png');
  if (fs.existsSync(png) && pngOk(fs.readFileSync(png))) {
    card.icon = require('url').pathToFileURL(png).href;
    return card.icon;
  }
  try {
    const real = resolveShortcutTarget(card.target);
    const img = await app.getFileIcon(real, { size: 'large' });
    const buf = img && !img.isEmpty() ? img.toPNG() : null;
    if (pngOk(buf)) {
      fs.writeFileSync(png, buf);
      card.icon = require('url').pathToFileURL(png).href;
      return card.icon;
    }
  } catch (e) {
    log('icon fail:', card.title, (e && e.message) || e);
  }
  return null;
}

/* ---------------------------------------------------------------------------
   Windows-native shortcut handling.

   Two things used to be wrong here:
   1. A Steam .url is a text INI. The game art is in its IconFile= line, not
      on the .url shell object; getFileIcon() on the .url returns the generic
      "internet shortcut" glyph. A .lnk likewise has to be resolved first.
   2. Electron's getFileIcon() returns the blank-document glyph (a 719 byte
      PNG, sha below) for several self-contained exes. The old code cached
      that glyph and then skipped every later retry because the file existed.
   --------------------------------------------------------------------------- */
const GENERIC_ICON_SHA =
  '8d3a4a171cc348663dac75952fdc77c3ee176a5256fdfe903a37fba808978847';
const PNG_MAGIC = '89504e470d0a1a0a';

function pngOk(buf, loose) {
  if (!buf || !Buffer.isBuffer(buf) || buf.length < (loose ? 100 : 800)) return false;
  if (buf.slice(0, 8).toString('hex') !== PNG_MAGIC) return false;
  return crypto.createHash('sha256').update(buf).digest('hex') !== GENERIC_ICON_SHA;
}

/* Steam / an uninstaller deletes the .url or .lnk from the desktop. Pico now
   follows the filesystem instead of keeping a frozen snapshot forever. An
   item the user explicitly pinned is exempt. URIs and shell: paths are not
   filesystem targets, so they are never pruned. */
function itemAlive(it) {
  if (!it || !it.target) return false;
  if (it.pinned) return true;
  const t = String(it.target);
  const m = /^([a-zA-Z]:[\\/])/.exec(t);
  if (!m) return true;                       // URI / shell: / UNC: not a file
  /* A removable or mapped drive that is OFFLINE is not "uninstalled".
     Pruning on a transient missing drive permanently erased curated folder
     items (and their resolved icons); keep the tile until the drive is back.
     OneDrive / cloud placeholders report existsSync=true, so real deletions
     on a healthy drive are still pruned as the user asked. */
  try { if (!fs.existsSync(m[1])) return true; } catch (e) { return true; }
  return fs.existsSync(t);
}

/* A cached icon reference is only trusted when the file behind it is still
   there and is not one of the blank glyphs we used to write. */
function iconRefGood(ref) {
  if (!ref || typeof ref !== 'string') return false;
  if (!/^file:/i.test(ref)) return true;          // data: / http: are user supplied
  try {
    const p = require('url').fileURLToPath(ref);
    if (!fs.existsSync(p)) return false;
    if (/\.png$/i.test(p)) {
      const buf = fs.readFileSync(p);
      return pngOk(buf) || (buf.length >= 100 &&
        buf.slice(0, 8).toString('hex') === PNG_MAGIC &&
        crypto.createHash('sha256').update(buf).digest('hex') !== GENERIC_ICON_SHA);
    }
    return true;                                  // .ico / .exe supplied art
  } catch (e) { return false; }
}

function readUrlShortcut(file) {
  try {
    const raw = fs.readFileSync(file);
    let text = raw.toString('utf8');
    if (text.indexOf('\u0000') >= 0) text = raw.toString('utf16le');
    const pick = (k) => {
      const m = text.match(new RegExp('^\\s*' + k + '\\s*=\\s*(.+?)\\s*$', 'im'));
      return m ? m[1] : '';
    };
    return {
      url: pick('URL'),
      iconFile: pick('IconFile').replace(/,\s*-?\d+\s*$/, ''),
    };
  } catch (e) { return null; }
}

/* Fall back to Win32 directly, the same ExtractAssociatedIcon route the
   taskbar host already uses. Pure ASCII, path passed via the environment so
   quotes in a program directory cannot break the command line. */
function nativeIconPng(exe) {
  try {
    const ps = 'Add-Type -AssemblyName System.Drawing | Out-Null;' +
      '$i=[System.Drawing.Icon]::ExtractAssociatedIcon($env:PICO_ICON_EXE);' +
      'if($i){$m=New-Object System.IO.MemoryStream;' +
      '$i.ToBitmap().Save($m,[System.Drawing.Imaging.ImageFormat]::Png);' +
      '[Convert]::ToBase64String($m.ToArray())}';
    const out = require('child_process').execFileSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps], {
        encoding: 'utf8', timeout: 4000, windowsHide: true,
        env: Object.assign({}, process.env, { PICO_ICON_EXE: exe }),
      });
    return Buffer.from(String(out || '').trim(), 'base64');
  } catch (e) { return null; }
}

/* Resolve one folder item to an icon the shell can actually draw. */
async function shellIconFor(item) {
  const t = String(item.target || '');
  const ext = path.extname(t).toLowerCase();
  if (ext === '.url') {
    const u = readUrlShortcut(t);
    if (u && u.iconFile && fs.existsSync(u.iconFile)) {
      return require('url').pathToFileURL(u.iconFile).href;
    }
    return null;              /* never show the generic internet glyph */
  }
  let exe = t;
  if (ext === '.lnk') {
    let link = null;
    try { link = shell.readShortcutLink(t); } catch (e) { /* broken link */ }
    if (!link) return null;
    const declared = String(link.icon || '').replace(/,\s*-?\d+\s*$/, '');
    if (declared && /\.ico$/i.test(declared) && fs.existsSync(declared)) {
      return require('url').pathToFileURL(declared).href;
    }
    if (link.target && fs.existsSync(link.target)) exe = link.target;
    else if (declared && fs.existsSync(declared)) exe = declared;
    else return null;
  }
  ensureIconDir();
  const png = path.join(ICON_DIR,
    'lnk-' + String(item.id || 'x').replace(/[^\w-]/g, '') + '.png');
  if (fs.existsSync(png) && pngOk(fs.readFileSync(png), true)) {
    return require('url').pathToFileURL(png).href;
  }
  let buf = null;
  try {
    const img = await app.getFileIcon(exe, { size: 'large' });
    if (img && !img.isEmpty()) buf = img.toPNG();
  } catch (e) { /* fall through to Win32 */ }
  if (!pngOk(buf)) {
    const native = nativeIconPng(exe);
    if (pngOk(native, true)) buf = native;
  }
  if (!pngOk(buf, true)) {
    try { fs.unlinkSync(png); } catch (e) { /* nothing cached */ }
    return null;
  }
  fs.writeFileSync(png, buf);
  return require('url').pathToFileURL(png).href;
}


/* Folder cards are tagged with a role: 办公 / 游戏 / 桌面文件夹. The old
   rescan wrote the whole shortcut list into the FIRST folder card, flattening
   any scene grouping back into one pile on every boot. */
const FOLDER_ROLES = {
  office:  { id: 'c_folder_office', title: '\u529E\u516C' },
  games:   { id: 'c_games_folder',  title: '\u6E38\u620F' },
  desktop: { id: 'c_mv97oio9xrm3', title: '\u684C\u9762\u6587\u4EF6\u5939' },
};
const OFFICE_NAME_RE = /photoshop|illustrator|premiere|after effects|figma|xmind|\u58A8\u5200|davinci|resolve|\u4F18\u52A8\u6F2B|clip studio|\u6307\u6325\u4E2D\u67A2/i;
const GAME_NAME_RE = /\u4EBA\u4EBA\u89C6\u9891|axolotl|launcher|r2modman|steam|epic|\u542F\u52A8\u5668/i;

function classifyShortcut(it) {
  const target = String(it.target || '').toLowerCase();
  if (target.endsWith('.url')) return 'games';       /* steam game shortcuts */
  if (OFFICE_NAME_RE.test(String(it.title || ''))) return 'office';
  if (GAME_NAME_RE.test(String(it.title || ''))) return 'games';
  return 'desktop';
}

function folderCardFor(role) {
  const meta = FOLDER_ROLES[role];
  let card = conf.cards.find((c) => c && c.kind === 'folder' && c.folderRole === role);
  if (!card) card = conf.cards.find((c) => c && c.kind === 'folder' && c.id === meta.id);
  if (!card) card = conf.cards.find((c) => c && c.kind === 'folder' && !c.folderRole);
  if (!card) {
    card = {
      id: meta.id, kind: 'folder', title: meta.title, items: [],
      w: 1, h: 1, x: 0, y: 0, opacity: 1, color: '',
      topMost: false, args: {}, factor: 1, clickThrough: false,
      scene: conf.activeScene, followSystemColor: true, page: 0,
    };
    conf.cards.push(card);
  }
  card.folderRole = role;
  return card;
}

/* Saved entries keep their resolved icons; freshly found shortcuts are only
   appended, never used to overwrite an existing entry. Dead entries were
   already pruned by itemAlive(), so a shortcut the uninstaller removed is
   absent from both sides and disappears from the page. */
function mergeFolderItems(curated, found) {
  const out = curated.slice();
  const seen = new Set(out.map((x) => String(x.target).toLowerCase()));
  for (const it of found) {
    const k = String(it.target).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

async function syncDesktopShortcuts() {
  try {
    const desktop = app.getPath('desktop');
    const pinnedDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Internet Explorer',
      'Quick Launch', 'User Pinned', 'TaskBar');
    const list = [];
    const seen = new Set();
    const scan = (dir, source) => {
      if (!dir || !fs.existsSync(dir)) return;
      for (const file of fs.readdirSync(dir)) {
        const low = file.toLowerCase();
        if (!low.endsWith('.lnk') && !low.endsWith('.url')) continue;
        const title = file.replace(/\.(lnk|url)$/i, '');
        if (seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        list.push({
          id: crypto.createHash('md5').update(source + ':' + file).digest('hex').slice(0, 10),
          title: title,
          target: path.join(dir, file),
          source: source,
        });
      }
    };
    scan(desktop, 'desktop');
    scan(pinnedDir, 'taskbar');

    const curated = { office: [], games: [], desktop: [] };
    for (const card of conf.cards) {
      if (!card || card.kind !== 'folder' || !Array.isArray(card.items)) continue;
      const role = card.folderRole || 'desktop';
      if (!curated[role]) curated[role] = [];
      for (const it of card.items) {
        if (!it || !it.target) continue;
        /* Windows semantics for EVERY entry, including the ones discovered
           from the desktop / taskbar: the uninstaller deletes the shortcut,
           so the tile goes with it. Previously those entries were thrown away
           and rebuilt each boot, which also threw away their resolved icons. */
        if (!itemAlive(it)) continue;
        curated[role].push(Object.assign({}, it));
      }
    }
    const found = { office: [], games: [], desktop: [] };
    for (const it of list) found[classifyShortcut(it)].push(it);

    const buckets = {};
    for (const role of Object.keys(FOLDER_ROLES)) {
      buckets[role] = mergeFolderItems(curated[role] || [], found[role] || []);
    }

    /* Repair or fill every icon. A cached blank glyph is no longer accepted
       as "already done" -- that was why uninstalling / reinstalling never
       changed the picture even though the path was identical. */
    for (const role of Object.keys(buckets)) {
      for (const item of buckets[role]) {
        if (iconRefGood(item.icon)) continue;
        try {
          const ref = await shellIconFor(item);
          if (ref) item.icon = ref;
          else delete item.icon;
        } catch (err) {
          log('icon failed ' + item.title + ': ' + (err && err.message));
        }
      }
    }

    for (const role of Object.keys(FOLDER_ROLES)) folderCardFor(role).items = buckets[role];
    log('shortcuts by scene: office=' + buckets.office.length +
        ' games=' + buckets.games.length + ' desktop=' + buckets.desktop.length);
    return list;
  } catch (err) {
    log('desktop shortcut scan failed: ' + (err && err.message));
    return [];
  }
}

function seedCards() {
  const mk = (o) => Object.assign({
    id: uid(), w: 300, h: 220, opacity: 0.92, color: '#16161c',
    topMost: true, args: '', factor: 1, clickThrough: null,
  }, o);
  // NOTE: no x/y here - createCard places the card in the current page's
  // Tetris mosaic (right-anchored, biggest blocks first)
  return [
    // example app card with NO target: teaches the import flow on first run
    mk({ kind: 'app', title: '工作台 · 导入你的程序', target: '', w: 260, h: 150 }),
    // web mail cards are NOT seeded any more: the mail aggregation card below
    // already pulls every IMAP account (QQ / 163 / Gmail) into one inbox, and
    // seeding a QQ web card next to it produced the duplicate-mailbox report
    mk({ kind: 'web', title: '163 邮箱', target: 'https://mail.163.com', w: 300, h: 400 }),
    // Bilibili card: persistent login session (scan QR once, stays logged in)
    mk({ kind: 'bili', title: 'B 站', target: 'https://www.bilibili.com', w: 340, h: 420 }),
    // music vinyl cards: SMTC-driven widgets living in their own projects
    mk({ kind: 'app', title: '网易云唱片', target: 'F:\\job\\netease-card\\start-card.bat', w: 320, h: 320 }),
    mk({ kind: 'app', title: 'QQ 音乐唱片', target: 'F:\\job\\qqmusic-card\\start-card.bat', w: 320, h: 320 }),
    // decorative folder card: holds desktop shortcuts, never moves files
    mk({ kind: 'folder', title: '桌面文件夹', items: [], w: 280, h: 320 }),
    // mail aggregation card: pulls the user's IMAP accounts (set in the unified
    // first-run setup) into one inbox; channels show in the setup order
  ];
}

function loadConf() {
  let rawBefore = '';
  try { rawBefore = fs.readFileSync(CONF_FILE, 'utf8').replace(/^\uFEFF/, '').replace(/\s+$/, ''); }
  catch (e) { rawBefore = ''; }
  let conf = readConfFile(CONF_FILE);
  if (!conf && fs.existsSync(CONF_FILE)) {
    /* NEVER seed on top of a damaged file. Save the evidence, then try the
       most recent good copies in order: in-flight tmp, then rotated backups. */
    quarantineBrokenConf();
    for (const f of recoveryCandidates()) {
      conf = readConfFile(f);
      if (conf) { log('config recovered from', path.basename(f)); break; }
    }
    if (!conf) log('config UNRECOVERABLE -> starting from a seed; original is quarantined');
  }
  const fresh = !conf;
  if (fresh) conf = { cards: seedCards(), autostart: false, mode: 'desktop', clickThrough: false };
  // migration: older configs predate the global switches / wizard / snap split
  // Pico RamOS is desktop beautification: every window belongs at the bottom.
  conf.mode = 'desktop';
  if (typeof conf.clickThrough !== 'boolean') conf.clickThrough = false;
  if (typeof conf.autostart !== 'boolean') conf.autostart = false;   // switch, default OFF
  if (typeof conf.snapCards !== 'boolean') conf.snapCards = true;    // card<->card edge snap
  if (typeof conf.snapScreen !== 'boolean') conf.snapScreen = true;  // screen work-area snap
  if (typeof conf.onboarded !== 'boolean') conf.onboarded = !fresh;  // existing users skip the wizard
  if (typeof conf.defaultOpacity !== 'number') conf.defaultOpacity = 0.92;
  if (typeof conf.defaultColor !== 'string') conf.defaultColor = '#16161c';
  if (!Array.isArray(conf.mail)) conf.mail = [];        // IMAP accounts for the mail card
  if (typeof conf.agentKey !== 'string') conf.agentKey = '';
  // follow the OS light/dark switch: card surfaces (not webview/app content)
  // flip between the dark default and a warm-paper light tone. Default OFF so
  // existing users keep the exact look they have.
  if (typeof conf.followSystemColor !== 'boolean') conf.followSystemColor = false;
  // one-time UI hints already shown (cardOps = the move/resize/settings hint)
  if (!conf.hints || typeof conf.hints !== 'object') conf.hints = {};
  if (typeof conf.hints.cardOps !== 'boolean') conf.hints.cardOps = false;
  /* scenes = workspace pages. A scene is a named page; every card belongs to
   * exactly one scene and only the active scene's cards are on screen. Legacy
   * configs (and fresh installs) migrate to a single 主场景 holding everything. */
  if (!Array.isArray(conf.scenes) || !conf.scenes.length) {
    conf.scenes = [{ id: 'scene-' + Date.now().toString(36), name: '主场景' }];
  }
  conf.scenes = conf.scenes
    .filter((s) => s && typeof s.id === 'string' && s.id)
    .map((s) => ({ id: s.id, name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : '场景' }));
  if (!conf.scenes.length) conf.scenes = [{ id: 'scene-' + Date.now().toString(36), name: '主场景' }];
  const sceneIds = new Set(conf.scenes.map((s) => s.id));
  if (!conf.activeScene || !sceneIds.has(conf.activeScene)) conf.activeScene = conf.scenes[0].id;
  conf.cards.forEach((c) => { if (c && (!c.scene || !sceneIds.has(c.scene))) c.scene = conf.activeScene; });
  // mosaic focus: one card of the active scene anchors the pack (big, at the
  // right edge). Legacy configs have none - the page's first card takes it.
  if (typeof conf.activeCard !== 'string' || !conf.cards.some((c) => c && c.id === conf.activeCard)) {
    const first = conf.cards.find((c) => c && (c.scene || 'main') === conf.activeScene);
    conf.activeCard = first ? first.id : '';
  }
  conf = migrateShellLayout(conf);
  /* The renderer is the sole authority for grid size (1U = innerWidth / 50).
     Clobbering cols/rows to 6x3 here used to rewrite a 48x23 unit grid on
     every boot, so the saved cells and the saved grid silently disagreed.
     Only configs that explicitly opted into legacy single-page keep 6x3. */
  if (typeof conf.singlePage !== 'boolean') conf.singlePage = false;
  if (typeof conf.gridUnit !== 'number') conf.gridUnit = 50;
  /* Boot is read-mostly now: writing on every start used to bake in whatever
     a half-applied migration produced, and defeated external config edits. */
  const after = JSON.stringify(conf, null, 2).replace(/\s+$/, '');
  if (fresh || !rawBefore || after !== rawBefore) saveConf(conf);
  return conf;
}

/* --- shell layout (v7): page grid replaces per-window mosaic packing --- */

/* Map a card kind to a default grid footprint. Embedded pages need room;
 * launcher tiles are 1x1 icons. */
function defaultSpan(kind) {
  /* Everything starts small. A 2x2 default made every fresh widget look like
     an empty billboard; the user resizes what they actually use. */
  if (kind === 'netease' || kind === 'qqmusic') return { w: 1, h: 2 }
  return { w: 1, h: 1 }
}

/* First-fit pack a flat card list into a cols x rows grid, reading order.
 * Cards whose span cannot fit are returned as overflow instead of overlapping. */
function packPage(cards, cols, rows, pageId, pageName) {
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const cells = [];
  const overflow = [];

  function fits(x, y, w, h) {
    if (x + w > cols || y + h > rows) return false;
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) if (grid[y + dy][x + dx]) return false;
    }
    return true;
  }
  function mark(x, y, w, h) {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) grid[y + dy][x + dx] = true;
    }
  }

  cards.forEach((card) => {
    const span = defaultSpan(card.kind);
    let placed = false;
    for (let y = 0; y + span.h <= rows && !placed; y += 1) {
      for (let x = 0; x + span.w <= cols && !placed; x += 1) {
        if (!fits(x, y, span.w, span.h)) continue;
        mark(x, y, span.w, span.h);
        cells.push({ cardId: card.id, x: x, y: y, w: span.w, h: span.h });
        placed = true;
      }
    }
    if (!placed) overflow.push(card);
  });

  return { page: { id: pageId, name: pageName, cells: cells }, overflow: overflow };
}

function migrateShellLayout(cfg) {
  if (cfg.layout && Array.isArray(cfg.layout.pages) && cfg.layout.pages.length) {
    cfg.layout.cols = cfg.layout.cols || 4;
    cfg.layout.rows = cfg.layout.rows || 3;
    if (!Array.isArray(cfg.layout.dock)) cfg.layout.dock = [];
    if (!cfg.wallpaper || typeof cfg.wallpaper !== 'object') {
      cfg.wallpaper = { type: 'none', src: '', blur: 0, dim: 0.25 };
    }
    return cfg;
  }

  const cols = 4;
  const rows = 3;
  const pages = [];
  const overflow = [];
  let pageSeq = 0;

  (cfg.scenes || []).forEach((scene) => {
    const cards = cfg.cards.filter((c) => c && (c.scene || 'main') === scene.id);
    if (!cards.length) return;
    const packed = packPage(cards, cols, rows, scene.id, scene.name || '\u573A\u666F');
    pages.push(packed.page);
    packed.overflow.forEach((c) => overflow.push(c));
    pageSeq += 1;
  });

  /* a scene holding more cells than one page can take spills onto its own page
   * rather than silently disappearing */
  while (overflow.length) {
    const take = overflow.splice(0, cols * rows);
    const packed = packPage(take, cols, rows, 'page-overflow-' + pageSeq, '\u66F4\u591A ' + pageSeq);
    pages.push(packed.page);
    pageSeq += 1;
  }

  if (!pages.length) pages.push({ id: 'page-empty', name: '\u4E3B\u573A\u666F', cells: [] });

  /* keep legacy pixel geometry so an old config can still be rebuilt by hand */
  cfg.cards.forEach((c) => {
    if (!c) return;
    if (!c.legacy) c.legacy = { x: c.x, y: c.y, w: c.w, h: c.h };
  });

  cfg.layout = {
    cols: cols,
    rows: rows,
    pages: pages,
    dock: pages[0].cells.slice(0, 4).map((c) => c.cardId)
  };
  if (!cfg.wallpaper || typeof cfg.wallpaper !== 'object') {
    cfg.wallpaper = { type: 'none', src: '', blur: 0, dim: 0.25 };
  }
  log('shell layout migrated: ' + pages.length + ' page(s), ' + cfg.cards.length + ' card(s)');
  return cfg;
}
function writeConfNow(obj) {
  confWriteBusy = true;
  const tmp = CONF_FILE + '.tmp-' + process.pid;
  try {
    /* per-process tmp name: two Pico instances (or a stale helper) can no
       longer race on the same file and make renameSync throw ENOENT */
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(obj, null, 2), 'utf8');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, CONF_FILE);
    confLastError = '';
    /* rotating backup: first write of a session, then at most every 10 min */
    if (Date.now() - confBackupAt > CONF_BACKUP_MS) {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(CONF_FILE, path.join(APP_DIR, CONF_BAK_PREFIX + stamp + '.json'));
        confBackupAt = Date.now();
        rotateConfBackups();
      } catch (e) { log('config backup fail', e.message); }
    }
    return true;
  } catch (e) {
    confLastError = String(e && e.message || e);
    log('saveConf fail', confLastError);
    try { fs.unlinkSync(tmp); } catch (e2) {}
    return false;
  } finally {
    confWriteBusy = false;
    /* coalesce bursts (drag + resize + layout) into ONE extra write */
    if (confWritePending) {
      confWritePending = false;
      setImmediate(() => { try { writeConfNow(conf); } catch (e) {} });
    }
  }
}

function saveConf(c) {
  const obj = c || conf;
  if (confWriteBusy) { confWritePending = true; return; }
  writeConfNow(obj);
}
let conf = loadConf();

/* ---------------- card windows ---------------- */
const cardWins = new Map();     // id -> { win, cfg }
// test hook: lets the FakeWin stub keep a card's authoritative base size in
// sync when it is given an explicit width/height (production only ever
// resizes through the resize IPC, which already does this).
global.__cardWins = cardWins;
let tray = null;
let managerWin = null;
let moveMode = false;           // Ctrl+Alt+D: everything interactive (drag cards)

function shellPath() { return path.join(APP_DIR, 'shell', 'shell.html'); }
function modulePath(target) { return path.join(APP_DIR, 'modules', target + '.html'); }

function portOpen(port) {
  return new Promise((res) => {
    const s = new net.Socket();
    s.setTimeout(400);
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => { s.destroy(); res(false); });
    s.once('timeout', () => { s.destroy(); res(false); });
    s.connect(port, '127.0.0.1');
  });
}

function baseWebPrefs(preload) {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    webSecurity: true,
    backgroundThrottling: false,
    webviewTag: true,
  };
}

/* ---------------- z-order (desktop widget mode) ----------------
 * Electron has no "send to bottom" API, so we call SetWindowPos(HWND_BOTTOM)
 * through a tiny bundled PowerShell helper using the window's native handle. */
function zOrder(id, mode) {
  const c = cardWins.get(id);
  if (!c || c.win.isDestroyed()) return;
  let hwnd = '';
  try {
    const b = c.win.getNativeWindowHandle();
    if (b && b.length >= 8) hwnd = b.readBigUInt64LE(0).toString();
    else if (b && b.length >= 4) hwnd = b.readUInt32LE(0).toString();
  } catch (e) { log('getNativeWindowHandle fail', e.message); return; }
  if (!hwnd) return;
  try {
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ZORDER_PS1,
      '-Mode', mode, '-Hwnd', hwnd], { windowsHide: true, stdio: 'ignore' }).unref();
  } catch (e) { log('zorder spawn fail', e.message); }
}

function applyMode() {
  /* Desktop beautification is fixed at the bottom. There is intentionally no
     "top" branch any more: a card must never float above a real application. */
  conf.mode = 'desktop';
  cardWins.forEach((c, id) => {
    if (c.win.isDestroyed()) return;
    try { c.win.setFocusable(false); } catch (e) {}
    c.win.setAlwaysOnTop(false);
    zOrder(id, 'bottom');
  });
  applyAllClickThrough();
  buildTray();
  log('mode -> desktop (forced)');
}

/* ---------------- click-through ---------------- */
function effectiveClickThrough(cfg) {
  if (moveMode) return false;                           // drag mode wins
  if (cfg.clickThrough === true) return true;
  if (cfg.clickThrough === false) return false;
  // no per-card override: every card follows the global switch
  return !!conf.clickThrough;
}
function applyClickThrough(id) {
  const c = cardWins.get(id);
  if (!c || c.win.isDestroyed()) return;
  const on = effectiveClickThrough(c.cfg);
  try { c.win.setIgnoreMouseEvents(on); } catch (e) {}
}
function applyAllClickThrough() { cardWins.forEach((c, id) => applyClickThrough(id)); }

function setMoveMode(on) {
  moveMode = !!on;
  applyAllClickThrough();
  // widget mode: cards sit at the z-order bottom and are non-focusable, which
  // makes them undraggable. Drag mode lifts focusability for its duration.
  if (conf.mode === 'desktop') {
    cardWins.forEach((c) => {
      if (!c.win.isDestroyed()) { try { c.win.setFocusable(moveMode); } catch (e) {} }
    });
  }
  cardWins.forEach((c) => {
  });
  buildTray();
  log('moveMode ->', moveMode);
}

/* ---------------- free placement + Tetris on demand ----------------
 * The look the user asked for: cards of DIFFERENT sizes pack together edge to
 * edge like Tetris blocks - one compact mosaic, anchored to the RIGHT edge
 * (the scene dock lives there), packed right-to-left, shelf by shelf,
 * top-down. The pack is a STARTING ARRANGEMENT, not a prison: the user drags
 * cards anywhere (1:1 with the pointer, never snapped, never re-packed under
 * the pointer), and the only hard rules are
 *   - a card never leaves the scene container (work area minus the dock),
 *   - a card never overlaps a sibling,
 *   - focus NEVER moves geometry (clicking / wheel / closing a card used to
 *     re-spring the whole mosaic = "the desk twitches when I click").
 * The mosaic is rebuilt on demand: tray / Ctrl+Alt+R / scene switch. */
const GALLERY = { gap: 12, marginRight: 84 };
function cardDisplaySize(c) {
  // base ceiling first: a 600px-wide card is a wall, not a card (the "too
  // big" complaint). 340x460 is the sane base box. Focus does NOT scale:
  // focus is a ring + brightness, geometry stays where the user put it.
  const bw = Math.min(c.w, LAYOUT_MAX_W);
  const bh = Math.min(c.h, LAYOUT_MAX_H);
  return { w: Math.max(MIN_W, Math.round(bw)), h: Math.max(MIN_H, Math.round(bh)) };
}
/* pure rect computation for one scene's mosaic (no windows touched). fit
 * scales every card by ONE factor when the stack would run past the bottom of
 * the work area (rounding each card can push the stack back over the edge, so
 * shave until the ROUNDED heights actually fit; the absolute floor here is
 * 120x80 - fitting the screen outranks MIN_W). */
function tetrisRects(scene, fitOverride, excludeId) {
  const target = scene || conf.activeScene;
  const list = conf.cards.filter((c) => (c.scene || 'main') === target && c.id !== excludeId);
  if (!list.length) return [];
  const region = mosaicRegion();
  const regionW = region.right - region.left;
  const regionH = region.bottom - region.top;
  // pack order: the focus first, then biggest-area first
  const order = list.slice().sort((a, b) => {
    if (a.id === conf.activeCard) return -1;
    if (b.id === conf.activeCard) return 1;
    return (b.w * b.h) - (a.w * a.h);
  });
  const pack = (fit) => {
    const sizes = new Map();
    order.forEach((c) => {
      const sz = cardDisplaySize(c);
      sizes.set(c.id, { w: Math.max(120, Math.round(sz.w * fit)), h: Math.max(80, Math.round(sz.h * fit)) });
    });
    const shelves = [];
    order.forEach((c) => {
      const sz = sizes.get(c.id);
      let sh = null;
      // first-fit from the TOP shelf: upper holes fill first = tight mosaic.
      // The gap lives in sh.right (updated after each placement), so the
      // width check here is the bare card width - adding the gap again here
      // is what doubled every mosaic gap to 24px.
      for (let i = 0; i < shelves.length; i++) {
        const s = shelves[i];
        if (s.right - sz.w >= region.left && sz.h <= region.bottom - s.y) { sh = s; break; }
      }
      if (!sh) {
        /* No shelf has room: stack a new one under the last. */
        const prev = shelves[shelves.length - 1];
        const y = prev ? prev.y + prev.h + GALLERY.gap : region.top;
        sh = { y: y, h: 0, right: region.right, items: [] };
        shelves.push(sh);
      }
      const x = sh.right - sz.w;
      sh.items.push({ id: c.id, x: x, y: sh.y, w: sz.w, h: sz.h });
      sh.right = x - GALLERY.gap;
      if (sz.h > sh.h) sh.h = sz.h;
    });
    return shelves;
  };
  const stackH = (ss) => (ss.length ? ss[ss.length - 1].y + ss[ss.length - 1].h - region.top : 0);
  let fit = fitOverride || 1;
  let shelves = pack(fit);
  if (stackH(shelves) > regionH) {
    fit = Math.max(0.2, (fit * regionH) / Math.max(1, stackH(shelves)));
    for (let guard = 0; guard < 80; guard++) {
      shelves = pack(fit);
      if (stackH(shelves) <= regionH) break;
      fit -= 0.004;
    }
  }
  const out = [];
  list.forEach((c) => {
    for (const sh of shelves) {
      const it = sh.items.find((k) => k.id === c.id);
      if (it) { out.push({ id: c.id, x: it.x, y: it.y, w: it.w, h: it.h }); return; }
    }
  });
  return out;
}
/* the focus anchor must always name a living card of the active page -
 * wizard resets and card deletions can orphan it */
function ensureFocusCard() {
  const ok = conf.cards.some((c) => c.id === conf.activeCard && (c.scene || 'main') === conf.activeScene);
  if (ok) return;
  const first = conf.cards.find((c) => (c.scene || 'main') === conf.activeScene);
  conf.activeCard = first ? first.id : '';
}
/* commit the mosaic for one scene; animate = spring each card to its rect */
function layoutScene(scene, animate) {
  if (SHELL_MODE) return;   /* grid cells own placement; no mosaic pack */
  const target = scene || conf.activeScene;
  if (target === conf.activeScene) ensureFocusCard();
  const rects = tetrisRects(target);
  rects.forEach((r) => {
    // x/y are mosaic coordinates; w/h are NOT written back - they stay the
    // user's BASE size, while the window shows the (possibly focus-scaled)
    // display size. Writing the scaled size back made every re-layout
    // multiply it again (260 -> 333 -> 426 -> ...: the "cards keep growing"
    // bug).
    const cfg = conf.cards.find((c) => c.id === r.id);
    if (cfg) { cfg.x = r.x; cfg.y = r.y; }
    const c = cardWins.get(r.id);
    if (!c || c.win.isDestroyed()) return;
    if (animate) animateRect(r.id, r); else commitRect(c.win, r.x, r.y, r.w, r.h);
    // the (re-)packed display size becomes the new authority: a later drag
    // pins it, and a card that grew under the old ratchet shrinks back here
    c.baseW = r.w; c.baseH = r.h;
  });
  saveConf();
  return rects.length;
}
/* fresh-card placement hook (createCard): same mosaic math for the page */
function ensureLayout() { return layoutScene(conf.activeScene, false); }
/* every scene gets its mosaic once at boot: legacy x/y from the old cascade /
 * grid packs are recomputed - the Tetris pack is the only language now */
function layoutAllScenes(animate) {
  (conf.scenes || []).forEach((s) => layoutScene(s.id, animate));
}

/* ---------------- scene container rules (no overlap / no escape) ----------------
 * "卡片不允许重叠" + "卡片边缘不允许超出场景容器边缘": the scene container is
 * the work area minus the scene dock (GALLERY.marginRight) and the layout
 * margins - exactly the region the Tetris pack fills. Every drag / resize /
 * zoom commits through clampRect so a card can never be parked off-screen or
 * under the dock. */
/* the pack region: the work area inset by LAYOUT_MARGIN, minus the dock */
function mosaicRegion() {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    left: wa.x + LAYOUT_MARGIN,
    right: wa.x + wa.width - GALLERY.marginRight,
    top: wa.y + LAYOUT_MARGIN,
    bottom: wa.y + wa.height - LAYOUT_MARGIN,
  };
}
/* the container a card may never leave: the work area (the taskbar is
 * already excluded from workArea) minus the dock strip on the right. The
 * pack inset does NOT apply here - a card parked 8px from the top edge is
 * still inside the container, and screen-edge snapping must keep working. */
function clampRect(x, y, w, h) {
  const wa = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(Math.max(wa.x, Math.min(wa.x + wa.width - GALLERY.marginRight - w, x))),
    y: Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - h, y))),
  };
}
function clampCard(id, x, y, w, h) {
  const c = cardWins.get(id);
  if (!c || c.win.isDestroyed()) return null;
  const b = c.win.getBounds();
  return clampRect(x === undefined ? b.x : x, y === undefined ? b.y : y, w || b.width, h || b.height);
}
function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
         a.y < b.y + b.height && b.y < a.y + a.height;
}
/* would this rect sit on a sibling? */
function rectHitsSibling(id, x, y, w, h) {
  const c = cardWins.get(id);
  if (!c) return false;
  const scene = c.cfg.scene || 'main';
  const probe = { x: x, y: y, width: w, height: h };
  for (const [oid, o] of cardWins) {
    if (oid === id || o.win.isDestroyed()) continue;
    if ((o.cfg.scene || 'main') !== scene) continue;
    if (rectsOverlap(probe, o.win.getBounds())) return true;
  }
  return false;
}
/* nudge the card out of every sibling overlap with the SMALLEST push; if no
 * push keeps it inside the container, fall back to its pack slot. */
function resolveOverlaps(id) {
  const c = cardWins.get(id);
  if (!c || c.win.isDestroyed()) return false;
  lockBounds(c.win);          // the pushes below are ours, not user drags
  const bw = c.baseW, bh = c.baseH;       // authoritative size - never the live read
  const scene = c.cfg.scene || 'main';
  const sibs = conf.cards.filter((k) => (k.scene || 'main') === scene && k.id !== id);
  let moved = false;
  for (let pass = 0; pass < 12; pass++) {
    const b = c.win.getBounds();
    let hit = null;
    for (const s of sibs) {
      const w = cardWins.get(s.id);
      if (!w || w.win.isDestroyed()) continue;
      const sb = w.win.getBounds();
      if (rectsOverlap(b, sb)) { hit = sb; break; }
    }
    if (!hit) break;
    const pushes = [
      { dx: hit.x + hit.width - b.x, dy: 0 },        // right
      { dx: -(b.x + bw - hit.x), dy: 0 },            // left
      { dx: 0, dy: hit.y + hit.height - b.y },       // down
      { dx: 0, dy: -(b.y + bh - hit.y) },            // up
    ].sort((p, q) => (Math.abs(p.dx) + Math.abs(p.dy)) - (Math.abs(q.dx) + Math.abs(q.dy)));
    let placed = null;
    for (const p of pushes) {
      const cl = clampRect(b.x + p.dx, b.y + p.dy, bw, bh);
      if (cl.x !== b.x || cl.y !== b.y) { placed = cl; break; }
    }
    if (!placed) break;                              // boxed in: leave it
    moveWindow(c.win, placed.x, placed.y, bw, bh);
    moved = true;
  }
  return moved;
}
/* keep the pack coordinates of a card in sync with its window after a free
 * move / resize, and re-apply both container rules */
function enforceCardBounds(id) {
  const c = cardWins.get(id);
  if (!c || c.win.isDestroyed()) return;
  lockBounds(c.win);          // clamp / push echoes must never re-snap
  const b = c.win.getBounds();
  const bw = c.baseW, bh = c.baseH;       // authoritative size - never the live read
  const cl = clampRect(b.x, b.y, bw, bh);
  // position clamp AND size snap-back: if the window drifted from the
  // authoritative size (the 1px-per-setBounds ratchet, or any path that
  // forgot to update baseW/baseH), pull it back - a 1px tolerance absorbs
  // the read offset itself so this never fights the display server.
  if (cl.x !== b.x || cl.y !== b.y || Math.abs(b.width - bw) > 1 || Math.abs(b.height - bh) > 1) {
    moveWindow(c.win, cl.x, cl.y, bw, bh);
  }
  resolveOverlaps(id);
  const bb = c.win.getBounds();
  const inConf = conf.cards.find((k) => k.id === id);
  if (inConf) { inConf.x = bb.x; inConf.y = bb.y; }
  c.cfg.x = bb.x; c.cfg.y = bb.y;
  saveConf();
}
/* resolution / taskbar change: the container moved, so every card is pulled
 * back inside it (nothing may be stranded off-screen). Registered from
 * whenReady - the screen module throws before the app is ready. */
/* The shell is a fixed-size fullscreen window created ONCE from the primary
   display bounds. Plugging in a monitor, changing the primary display or
   switching 100% -> 125% used to leave it on the old rectangle forever while
   the renderer recomputed 1U from a different innerWidth: cards and hit rects
   silently drifted apart. Re-fit both windows and ask for fresh hit rects. */
function syncShellBounds() {
  let area;
  try { area = screen.getPrimaryDisplay().bounds; }
  catch (e) { return; }
  try {
    if (shellWin && !shellWin.isDestroyed()) {
      const b = shellWin.getBounds();
      if (b.x !== area.x || b.y !== area.y || b.width !== area.width || b.height !== area.height) {
        shellWin.setBounds({ x: area.x, y: area.y, width: area.width, height: area.height });
        log('shell re-fit ->', area.width + 'x' + area.height);
      }
      pushShellToBottom();
      try { shellWin.webContents.send('os-display-changed', area); } catch (e) {}
    }
    if (dockHitWin && !dockHitWin.isDestroyed() && typeof syncDockHitBounds === 'function') syncDockHitBounds();
  } catch (e) { log('syncShellBounds fail', e.message); }
}

function watchDisplayMetrics() {
  try {
    const onChange = () => {
      cardWins.forEach((_c, id) => {
        try { enforceCardBounds(id); } catch (e) {}
      });
      syncShellBounds();
    };
    screen.on('display-metrics-changed', onChange);
    screen.on('display-added', onChange);
    screen.on('display-removed', onChange);
  } catch (e) { log('display-metrics listener fail', e.message); }
  /* A locked / suspended machine must not keep polling the cursor or let
     timer bursts replay on wake. */
  try {
    powerMonitor.on('suspend', () => {
      systemSuspended = true;
      stopShellHitTest();
      log('system suspend -> shell poller paused');
    });
    powerMonitor.on('resume', () => {
      systemSuspended = false;
      if (desktopMode === 'pico') startShellHitTest();
      syncShellBounds();
      log('system resume -> shell poller resumed');
    });
    powerMonitor.on('lock-screen', () => { systemSuspended = true; });
    powerMonitor.on('unlock-screen', () => {
      systemSuspended = false;
      if (desktopMode === 'pico') startShellHitTest();
    });
  } catch (e) { log('powerMonitor listener fail', e.message); }
}

try {
  app.on('gpu-process-crashed', () => {
    log('gpu-process-crashed');
    /* Do not rebuild immediately: Chromium usually restores the GPU process
       on its own. Only verify the shell is still alive. */
    if (shellWin && !shellWin.isDestroyed()) syncShellBounds();
  });
} catch (e) { log('gpu listener fail', e.message); }

/* ---------------- spring window tweener ----------------
 * setBounds is instant; the mosaic needs cards to GLIDE: slide + re-scale
 * when focus changes, give way when a sibling is dragged past them. A tiny
 * per-card spring tween - 380ms ease-out-back with ~10% overshoot, 16ms
 * ticks, always committing through commitRect so the async 'move' echo is
 * recognised as ours and never edge-snaps mid-flight. moveOnly tweens x/y
 * and PINS the size - used by drag give-way / drop, where a resizing card
 * under the pointer read as the window "convulsing" (field report). */
const cardAnims = new Map();        // id -> pending timeout
let animDepth = 0;                  // tweens in flight: their move echoes must never snap
function springOut(p) {             // easeOutBack: fast start, gentle overshoot
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}
function animateRect(id, to, moveOnly) {
  const c = cardWins.get(id);
  if (!c || c.win.isDestroyed()) return;
  const b = c.win.getBounds();
  const from = { x: b.x, y: b.y, w: b.width, h: b.height };
  if (from.x === to.x && from.y === to.y && (!moveOnly && (from.w === to.w && from.h === to.h))) return;
  if (cardAnims.has(id)) { clearTimeout(cardAnims.get(id)); cardAnims.delete(id); }
  animDepth++;
  const t0 = Date.now();
  const step = () => {
    const cc = cardWins.get(id);
    if (!cc || cc.win.isDestroyed()) { cardAnims.delete(id); animDepth--; return; }
    const p = Math.min(1, (Date.now() - t0) / 380);
    const e = springOut(p);
    commitRect(cc.win,
      Math.round(from.x + (to.x - from.x) * e),
      Math.round(from.y + (to.y - from.y) * e),
      moveOnly ? cc.baseW : Math.max(MIN_W, Math.round(from.w + (to.w - from.w) * e)),
      moveOnly ? cc.baseH : Math.max(MIN_H, Math.round(from.h + (to.h - from.h) * e)));
    if (p < 1) cardAnims.set(id, setTimeout(step, 16));
    else { cardAnims.delete(id); animDepth--; }
  };
  cardAnims.set(id, setTimeout(step, 16));
}
function cancelAnim(id) {
  if (cardAnims.has(id)) {
    clearTimeout(cardAnims.get(id));
    cardAnims.delete(id);
    animDepth--;          // the killed tween will never fire its own completion
  }
}

/* ---------------- gallery focus ----------------
 * One card of the active scene is the focus: it reads as "the active card"
 * through its accent ring + brightness (see card.css). Focus NEVER changes
 * geometry - clicking a side card, rolling the wheel or closing a card used
 * to re-spring the whole mosaic, which read as the desk "twitching"
 * (field report). Cards stay exactly where the user left them; the mosaic is
 * a starting arrangement and is rebuilt on demand (tray / Ctrl+Alt+R). */
function setFocusCard(id, opts) {
  const o = opts || {};
  const cfg = conf.cards.find((c) => c.id === id);
  if (!cfg) return false;
  if (conf.activeCard === id) {
    if (!o.silent) broadcastFocus();
    return true;
  }
  conf.activeCard = id;
  zOrder(id, conf.mode === 'desktop' ? 'bottom' : 'top');
  broadcastFocus();          // ring + brightness only - no re-pack
  saveConf();
  return true;
}
function focusStep(dir) {
  const list = conf.cards.filter((c) => (c.scene || 'main') === conf.activeScene);
  if (list.length < 2) return false;
  let i = list.findIndex((c) => c.id === conf.activeCard);
  if (i < 0) i = 0;
  const j = Math.max(0, Math.min(list.length - 1, i + (dir > 0 ? 1 : -1)));
  if (j === i) return false;
  return setFocusCard(list[j].id);
}
function broadcastFocus() {
  cardWins.forEach((c, id) => {
    if (c.win.isDestroyed()) return;
    try { c.win.webContents.send('card-focus', { id: id, focused: id === conf.activeCard }); } catch (e) {}
  });
}

/* ---------------- drag = free placement ----------------
 * Dragging a card by its grip OR its body moves it 1:1 with the pointer -
 * nothing re-packs under it, nothing snaps it home, no sibling jumps. The
 * only rules are enforced at drop (and during the move): stay inside the
 * scene container, don't overlap a sibling (see enforceCardBounds /
 * resolveOverlaps above). The old "drag = reorder the mosaic" behaviour is
 * exactly what the user described as "移动极其不灵敏，没有紧跟鼠标，还会自动
 * 贴住桌面右上角移不走" - the pack kept stealing the window back. */
/* ---------------- create / show cards ---------------- */
/* ---------------- single-window shell ----------------
 * SHELL_MODE = the phone-style desktop: ONE full-screen BrowserWindow draws the
 * wallpaper, the page grid, the dock and every widget as DOM. Per-card windows
 * are kept for modules that need a window of their own.
 *
 * Why one window: backdrop-filter can only sample content painted in the same
 * window. A per-card BrowserWindow sits on a transparent hole, so blur has
 * nothing to sample and the card reads as flat grey - the original complaint.
 */
const SHELL_MODE = true;
let shellWin = null;
/* true while the shell layer is click-through (cursor over bare desktop) */
let shellIgnoreMouse = true;
/* A tiny always-on-top, invisible window fitted to the dock icon blocks.
   The shell itself is pinned at the bottom of the Z order, so other apps
   would otherwise swallow taskbar clicks. See openDockHitWin(). */
let dockHitWin = null;
let dockHitBoundsTimer = null;

/* Boot used to fire four expensive Windows initialisers in the same frame:
   desktop-shell.ps1, media.ps1 (WinRT Add-Type), the resident taskbar host
   (one-off C# compile) and the first full icon scan. That produced a sharp
   CPU spike right at launch. Only the shell takeover is needed for the first
   paint; everything else is staggered. Timers are unref'd and cancelled when
   the shell closes, so a quick quit never leaves work behind. */
const bootDefers = [];
function deferBoot(fn, ms) {
  const t = setTimeout(() => {
    const i = bootDefers.indexOf(t);
    if (i >= 0) bootDefers.splice(i, 1);
    if (shellWin && !shellWin.isDestroyed()) fn();
  }, ms);
  if (t.unref) t.unref();
  bootDefers.push(t);
}
function clearBootDefers() {
  bootDefers.forEach(clearTimeout);
  bootDefers.length = 0;
}

/* ---------- music widget: Windows SMTC ---------- */
const MEDIA_PS1 = path.join(APP_DIR, 'media.ps1');
let desktopShellHidden = false;
const DESKTOP_SHELL_PS1 = path.join(APP_DIR, 'desktop-shell.ps1');
const { lyricFor } = require('./lyric');
let mediaLyric = [];
let mediaLyricKey = '';
let mediaNow = { ok: false, status: 'NoSession' };
let mediaTimer = null;
let mediaBusy = false;

function readMediaSession(action = 'read') {
  return new Promise((resolve) => {
    if (mediaBusy) return resolve(mediaNow);
    mediaBusy = true;
    const ps = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', MEDIA_PS1, '-Action', action],
      { windowsHide: true });
    let buf = '';
    ps.stdout.on('data', (d) => { buf += d.toString('utf8'); });
    ps.on('error', () => { mediaBusy = false; resolve(mediaNow); });
    ps.on('close', () => {
      mediaBusy = false;
      // PowerShell may still emit a BOM or stray newlines around the JSON
      const jsonStart = buf.indexOf(String.fromCharCode(123));
      const line = jsonStart >= 0 ? buf.slice(jsonStart).trim() : '';
      if (line) {
        try {
          const next = JSON.parse(line);
          if (JSON.stringify(next) !== JSON.stringify(mediaNow)) {
            mediaNow = next;
            log('media ->', mediaNow.status, '|', mediaNow.title || '-', '|', mediaNow.artist || '-');
            const lk = (mediaNow.title || '') + '|' + (mediaNow.artist || '');
            if (lk !== mediaLyricKey) {
              mediaLyricKey = lk;
              mediaLyric = [];
              if (mediaNow.title) {
                lyricFor(mediaNow.title, mediaNow.artist).then((lines) => {
                  if (mediaLyricKey !== lk) return;
                  mediaLyric = lines;
                  log('lyric ->', lines.length, 'lines for', mediaNow.title);
                  pushShellState();
                }).catch(() => {});
              }
            }
            pushShellState();
          }
        } catch { /* leave the previous value alone */ }
      }
      resolve(mediaNow);
    });
  });
}

/* A brand-new powershell.exe per probe (Add-Type + WinRT + reflection) is
 * almost pure startup overhead: process spawn, not the SMTC read, costs the
 * CPU. With no player the session manager just answers "NoSession", so idle
 * probes now run every 40s (was 8s, then 20s); playing recovers to 5s
 * immediately. Every skipped probe is one less powershell.exe + WinRT
 * Add-Type compile - pure win, no visible change when nothing is playing. */
let mediaIdleTicks = 0;
function startMediaPoll() {
  if (mediaTimer) return;
  readMediaSession();
  mediaTimer = setInterval(() => {
    if (!shellWin || shellWin.isDestroyed() || !shellWin.isVisible()) return;
    const playing = !!(mediaNow && mediaNow.ok && mediaNow.status && mediaNow.status !== 'NoSession');
    mediaIdleTicks = playing ? 0 : mediaIdleTicks + 1;
    /* tick 1 is a grace probe; after that only every 8th tick (40s) idle */
    if (mediaIdleTicks > 1 && mediaIdleTicks % 8 !== 0) return;
    readMediaSession();
  }, 5000);
}

function stopMediaPoll() {
  if (mediaTimer) { clearInterval(mediaTimer); mediaTimer = null; }
}

/* ---------------- system monitor + weather ---------------- */
let sysPrev = null;
function cpuPercent() {
  const cpus = os.cpus() || [];
  let idle = 0, total = 0;
  cpus.forEach((c) => {
    const t = c.times || {};
    Object.keys(t).forEach((k) => { total += t[k]; });
    idle += t.idle || 0;
  });
  const cur = { idle, total };
  if (!sysPrev) { sysPrev = cur; return 0; }
  const dIdle = cur.idle - sysPrev.idle;
  const dTotal = cur.total - sysPrev.total;
  sysPrev = cur;
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
}


/* ---- wallpaper palette ----------------------------------------------------
 * The glass used to follow the Windows accent colour, which has nothing to do
 * with the wallpaper: a green desktop got pink glass. Sample the snapshot we
 * already take at startup instead and hand three tones to the renderer. */
function paletteFromWallpaper() {
  const p = path.join(APP_DIR, 'wallpaper-snapshot.png');
  if (!fs.existsSync(p)) return null;
  try {
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return null;
    const small = img.resize({ width: 48, height: 48, quality: 'good' });
    const { width, height } = small.getSize();
    const buf = small.toBitmap(); // BGRA
    const px = [];
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const b = buf[o], g = buf[o + 1], r = buf[o + 2], a = buf[o + 3];
      if (a < 40) continue;
      px.push([r, g, b]);
    }
    if (!px.length) return null;
    const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    px.sort((x, y) => lum(x) - lum(y));
    const dec = Math.max(1, Math.floor(px.length / 10));
    const avgOf = (arr) => {
      let r = 0, g = 0, b = 0;
      for (const c of arr) { r += c[0]; g += c[1]; b += c[2]; }
      const n = arr.length;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    };
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    return {
      avg: hex(avgOf(px)),
      dark: hex(avgOf(px.slice(0, dec))),
      light: hex(avgOf(px.slice(-dec))),
    };
  } catch (e) {
    log('palette failed:', e.message);
    return null;
  }
}

let wallpaperPalette = null;

/* Remember the scene the user last looked at, so a reboot never "loses"
   widgets that happen to live on another page. */
ipcMain.handle('os-set-boot-page', (_e, page) => {
  const n = Math.max(0, Number(page) | 0);
  conf.bootPage = n;
  saveConf();
  /* the bottom scene strip must follow a wheel / swipe page change too */
  refreshDock();
  return n;
});

ipcMain.handle('os-sysinfo', () => {
  const m = process.getSystemMemoryInfo();
  let disk = null;
  try {
    const st = fs.statfsSync(APP_DIR);
    disk = { free: st.bfree * st.bsize, total: st.blocks * st.bsize };
  } catch (err) { disk = null; }
  return {
    cpu: cpuPercent(),
    memUsed: (m.total - m.free) * 1024,
    memTotal: m.total * 1024,
    disk,
    uptime: os.uptime(),
  };
});

/* WMO weather codes, condensed to what a small card can show */
const WMO = {
  0: ['晴', '☀'], 1: ['晴间多云', '⛅'], 2: ['多云', '⛅'], 3: ['阴', '☁'],
  45: ['雾', 'ἲb'], 48: ['雾凇', 'ἲb'],
  51: ['毛毛雨', 'ἲ6'], 53: ['毛毛雨', 'ἲ6'], 55: ['毛毛雨', 'ἲ6'],
  61: ['小雨', 'ἲ7'], 63: ['中雨', 'ἲ7'], 65: ['大雨', 'ἲ7'],
  71: ['小雪', 'ἲ8'], 73: ['中雪', 'ἲ8'], 75: ['大雪', 'ἲ8'],
  80: ['阵雨', 'ἲ6'], 81: ['阵雨', 'ἲ6'], 82: ['强阵雨', 'ἲ6'],
  95: ['雷阵雨', '⛈'], 96: ['雷阵雨', '⛈'], 99: ['雷阵雨', '⛈'],
};

let weatherCache = { at: 0, data: null, city: '' };
async function fetchWeather(city) {
  const now = Date.now();
  const key = city || 'shanghai';
  if (weatherCache.data && weatherCache.city === key && now - weatherCache.at < 20 * 60 * 1000) {
    return weatherCache.data;
  }
  const geo = new URLSearchParams({ name: city || 'Shanghai', count: '1', language: 'zh', format: 'json' });
  const gres = await fetchJson('https://geocoding-api.open-meteo.com/v1/search?' + geo.toString());
  const hit = gres && gres.results && gres.results[0];
  if (!hit) throw new Error('找不到这个城市');
  const q = new URLSearchParams({
    latitude: String(hit.latitude),
    longitude: String(hit.longitude),
    current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
  });
  const w = await fetchJson('https://api.open-meteo.com/v1/forecast?' + q.toString());
  const c = (w && w.current) || {};
  const d = (w && w.daily) || {};
  const code = Number(c.weather_code != null ? c.weather_code : 0);
  const meta = WMO[code] || ['—', '·'];
  const data = {
    city: hit.name || city,
    temp: Math.round(Number(c.temperature_2m)),
    humidity: c.relative_humidity_2m != null ? Math.round(Number(c.relative_humidity_2m)) : null,
    wind: c.wind_speed_10m != null ? Math.round(Number(c.wind_speed_10m)) : null,
    cond: meta[0],
    icon: meta[1],
    hi: d.temperature_2m_max && d.temperature_2m_max[0] != null ? Math.round(Number(d.temperature_2m_max[0])) : null,
    lo: d.temperature_2m_min && d.temperature_2m_min[0] != null ? Math.round(Number(d.temperature_2m_min[0])) : null,
  };
  weatherCache = { at: now, data, city: key };
  return data;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? require('https') : require('http');
    const req = mod.get(url, { headers: { 'User-Agent': 'PicoRamOS/1.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { buf += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('超时')); });
  });
}

ipcMain.handle('os-weather', async (_e, city) => {
  try {
    const data = await fetchWeather(city || '');
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});

/* ---------------- VPN status card (read-only, zero spawned processes) ------
 * The last performance incident came from spawning a fresh PowerShell every
 * 2.5s. This card deliberately spawns nothing at all: Chromium's proxy
 * resolver, Node TCP connects, os.networkInterfaces() and net.fetch() all run
 * inside the main process. Only the explicit "open client" button launches an
 * exe, once, on the user's click. */
const VPN_PORTS = [7890, 7891, 7892, 7897, 1080, 10808, 10809, 2080, 9090, 20171, 33210];
const VPN_CLIENTS = [
  { name: 'FlashVPN', exe: 'C:\\vpnclash\\FlashVPN\\flash_mobile.exe' },
  { name: 'Clash Verge', exe: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Clash Verge', 'Clash Verge.exe') },
  { name: 'Clash for Windows', exe: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Clash for Windows', 'Clash for Windows.exe') },
  { name: 'v2rayN', exe: path.join(process.env.LOCALAPPDATA || '', 'Programs', 'v2rayN', 'v2rayN.exe') },
];

function vpnClient() {
  const cfg = conf.vpn || {};
  if (cfg.clientPath) {
    return {
      name: cfg.clientName || path.basename(cfg.clientPath, path.extname(cfg.clientPath)),
      path: cfg.clientPath,
      installed: fs.existsSync(cfg.clientPath),
    };
  }
  for (const k of VPN_CLIENTS) {
    if (k.exe && fs.existsSync(k.exe)) return { name: k.name, path: k.exe, installed: true };
  }
  return { name: '未检测到客户端', path: '', installed: false };
}

function probePort(port, ms) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (v) => { if (done) return; done = true; s.destroy(); resolve(v); };
    s.setTimeout(ms || 260);
    s.once('connect', () => finish(true));
    s.once('timeout', () => finish(false));
    s.once('error', () => finish(false));
    try { s.connect(port, '127.0.0.1'); } catch (e) { finish(false); }
  });
}

let vpnIpCache = { at: 0, data: null };
let vpnIpTask = null;
let vpnLastProxyKey = '';
function vpnExitIp(force) {
  if (!force && vpnIpCache.data && Date.now() - vpnIpCache.at < 5 * 60 * 1000) {
    return Promise.resolve(vpnIpCache.data);
  }
  if (vpnIpTask) return vpnIpTask;   /* one in-flight lookup, never a pile-up */
  vpnIpTask = (async () => {
    const urls = ['https://api.ip.sb/geoip', 'https://ipapi.co/json/'];
    for (const u of urls) {
      try {
        const r = await electronNet.fetch(u, {
          signal: AbortSignal.timeout(4000),
          headers: { 'User-Agent': 'PicoRamOS/1.0' },
        });
        if (!r.ok) continue;
        const j = await r.json();
        const data = {
          ip: j.ip || j.query || '',
          country: j.country || j.country_name || '',
          city: j.city || '',
          isp: j.isp || j.organization || j.org || j.asn_organization || '',
        };
        if (!data.ip) continue;
        vpnIpCache = { at: Date.now(), data: data };
        return data;
      } catch (e) { /* try the next endpoint */ }
    }
    return vpnIpCache.data || null;
  })().finally(() => { vpnIpTask = null; });
  return vpnIpTask;
}

async function vpnStatus(opts) {
  const force = !!(opts && opts.force);
  const client = vpnClient();
  let proxyRule = 'DIRECT';
  try {
    proxyRule = await session.defaultSession.resolveProxy('https://www.gstatic.com/generate_204');
  } catch (e) { /* keep DIRECT */ }
  proxyRule = String(proxyRule || 'DIRECT');
  const proxyEnabled = !/^DIRECT/i.test(proxyRule);
  const pm = /(?:PROXY|SOCKS5?|HTTPS|QUIC)\s+([^\s;]+)/i.exec(proxyRule);
  const proxyServer = pm ? pm[1] : '';

  let tunName = '';
  try {
    const ifaces = os.networkInterfaces();
    Object.keys(ifaces).forEach((k) => {
      if (!tunName && /wintun|tun|tap|mihomo|clash|wireguard|singbox/i.test(k)) tunName = k;
    });
  } catch (e) { /* no adapter list */ }

  const alive = await Promise.all(VPN_PORTS.map((p) => probePort(p, 260)));
  const openPorts = VPN_PORTS.filter((p, i) => alive[i]);
  const localPort = openPorts[0] || 0;

  let mode = '直连';
  if (proxyEnabled && tunName) mode = 'TUN + 系统代理';
  else if (tunName) mode = 'TUN 全局';
  else if (proxyEnabled) mode = '系统代理';
  else if (localPort) mode = '本地代理就绪';

  let state = 'off';
  if (proxyEnabled || tunName) state = 'connected';
  else if (localPort || client.installed) state = 'standby';

  /* A proxy flip means the previous exit IP is stale: re-check immediately. */
  const key = (proxyEnabled ? 'P' : 'D') + (tunName ? 'T' : '-');
  const ipForce = force || (vpnLastProxyKey !== '' && key !== vpnLastProxyKey);
  vpnLastProxyKey = key;
  /* Never make the card wait on a blocked geo-IP endpoint: reply within
     1.4s with whatever is cached; the lookup keeps running and the next
     30s poll picks up the result. */
  const ipTask = vpnExitIp(ipForce);
  const ip = await Promise.race([
    ipTask.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(vpnIpCache.data), 1400)),
  ]);

  return {
    ok: true,
    state: state,
    mode: mode,
    client: client.name,
    clientInstalled: client.installed,
    proxyEnabled: proxyEnabled,
    proxyServer: proxyServer,
    localPort: localPort,
    openPorts: openPorts,
    tun: !!tunName,
    tunName: tunName,
    ip: ip ? ip.ip : '',
    country: ip ? ip.country : '',
    city: ip ? ip.city : '',
    isp: ip ? ip.isp : '',
    ipStale: !ip,
    checkedAt: Date.now(),
  };
}

ipcMain.handle('os-vpn', async (_e, opts) => {
  try { return await vpnStatus(opts); }
  catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
});

ipcMain.handle('os-vpn-launch', () => {
  const c = vpnClient();
  if (!c.installed) return { ok: false, error: '未找到 VPN 客户端' };
  try {
    const p = spawn(c.path, [], { detached: true, stdio: 'ignore', cwd: path.dirname(c.path) });
    p.unref();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
});


/* ---------------- schedule (per-day todo list, local only) ---------------- */
function scheduleFor(date) {
  const store = conf.schedule || {};
  return Array.isArray(store[date]) ? store[date] : [];
}

ipcMain.handle('os-schedule-get', (_e, date) => ({ ok: true, items: scheduleFor(date) }));

ipcMain.handle('os-schedule-set', (_e, payload) => {
  const p = payload || {};
  const date = String(p.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'bad date' };
  if (!conf.schedule) conf.schedule = {};
  conf.schedule[date] = (Array.isArray(p.items) ? p.items : []).map((it) => ({
    text: String(it.text || '').slice(0, 200),
    done: !!it.done,
  })).filter((it) => it.text);
  saveConf();
  return { ok: true, items: conf.schedule[date] };
});

ipcMain.handle('os-desktop-shell', async (_e, action) => {
  if (!['hide', 'show', 'status'].includes(action)) return { ok: false, error: 'bad action' };
  try {
    const out = await new Promise((resolve, reject) => {
      exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + DESKTOP_SHELL_PS1 + '" -Action ' + action,
        { windowsHide: true, timeout: 15000 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(String(stderr || err.message).trim()));
          resolve(stdout);
        });
    });
    const i = out.indexOf('{');
    if (i < 0) return { ok: false, error: 'no json' };
    const data = JSON.parse(out.slice(i));
    log('desktop-shell ->', action, JSON.stringify(data));
    return data;
  } catch (e) {
    log('desktop-shell failed:', e.message);
    return { ok: false, error: e.message };
  }
});

/* ---------------- glass taskbar host ----------------
 * One long-lived PowerShell owns the Win32 calls. Compiling Add-Type on every
 * poll was a periodic CPU spike; this process compiles once and then answers
 * one JSON line per request. */
let taskbarProc = null;
let taskbarSeq = 0;
let taskbarBuf = '';
const taskbarPending = new Map();
let hostFailStreak = 0;
let hostNextAllowed = 0;

/* A process can be "not killed" and still be dead: exitCode is set on a
   natural exit. Writing to that stdin emits an async EPIPE, which used to be
   an uncaught exception that took the whole Electron main process down. */
function hostAlive(p) {
  return !!(p && !p.killed && p.exitCode === null && p.signalCode === null &&
            p.stdin && !p.stdin.destroyed && p.stdin.writable);
}

function ensureTaskbarHost() {
  if (hostAlive(taskbarProc)) return taskbarProc;
  if (process.platform !== 'win32') return null;
  /* A helper that dies on startup used to be respawned on every poll tick,
     and every spawn paid for a fresh C# compile. Back off exponentially
     (max 30 s) so a broken helper can never cook the CPU again. */
  if (Date.now() < hostNextAllowed) return null;
  try {
    const p = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(APP_DIR, 'taskbar-host.ps1')
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    taskbarProc = p;
    const startedAt = Date.now();
    p.on('error', (e) => { log('taskbar host spawn error:', e && e.message); });
    p.stdin.on('error', () => { /* EPIPE / closed pipe: never crash Electron */ });
    p.stdout.on('data', (chunk) => {
      taskbarBuf += chunk.toString('utf8');
      let nl;
      while ((nl = taskbarBuf.indexOf('\n')) >= 0) {
        const line = taskbarBuf.slice(0, nl).replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
        taskbarBuf = taskbarBuf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { continue; }
        const q = taskbarPending.get(msg.id);
        if (!q) continue;
        taskbarPending.delete(msg.id);
        clearTimeout(q.timer);
        q.resolve(msg.ok ? msg.data : null);
      }
    });
    let errBuf = '';
    p.stderr.on('data', (c) => { errBuf = (errBuf + c.toString('utf8')).slice(-800); });
    p.on('exit', () => {
      if (taskbarProc === p) taskbarProc = null;
      for (const [id, q] of taskbarPending) {
        clearTimeout(q.timer);
        q.resolve(null);
        taskbarPending.delete(id);
      }
      const lived = Date.now() - startedAt;
      if (lived < 10000) {
        hostFailStreak = Math.min(hostFailStreak + 1, 6);
        const wait = Math.min(30000, 500 * Math.pow(2, hostFailStreak));
        hostNextAllowed = Date.now() + wait;
        if (hostFailStreak <= 3) log('taskbar host died early, back off ' + wait + 'ms');
      } else {
        hostFailStreak = 0;
        hostNextAllowed = 0;
      }
      if (errBuf.trim() && hostFailStreak <= 3) log('taskbar-host exit:', errBuf.trim());
    });
    log('taskbar host -> up');
    return p;
  } catch (e) {
    log('taskbar host failed:', e && e.message);
    return null;
  }
}

/* Fire-and-forget variant for the re-hide tick. No pending map entry, no
   8 s timeout timer -- just one stdin line to the resident helper.
   id 0 is ignored when the reply comes back. */
function taskbarFire(cmd) {
  const p = ensureTaskbarHost();
  if (!hostAlive(p)) return;
  try { p.stdin.write(JSON.stringify({ id: 0, cmd: cmd, arg: '' }) + '\n'); }
  catch (e) { /* helper is gone; backoff decides when to respawn */ }
}

function taskbarCmd(cmd, arg) {
  const p = ensureTaskbarHost();
  if (!hostAlive(p)) return Promise.resolve(null);
  const id = ++taskbarSeq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { taskbarPending.delete(id); resolve(null); }, 8000);
    taskbarPending.set(id, { resolve, timer });
    try {
      p.stdin.write(JSON.stringify({ id: id, cmd: cmd, arg: arg == null ? '' : String(arg) }) + '\n');
    } catch (e) {
      clearTimeout(timer);
      taskbarPending.delete(id);
      resolve(null);
    }
  });
}

let taskbarListLogged = false;
ipcMain.handle('os-taskbar', async (_e, cmd, arg) => {
  const c = String(cmd || '');
  if (!['list', 'activate', 'minimize', 'peek', 'start', 'search', 'notify',
         'ime', 'ime-toggle', 'bottom', 'show-shell', 'hide-shell'].includes(c)) return { ok: false, error: 'bad cmd' };
  const data = await taskbarCmd(c, arg);
  if (c === 'list' && Array.isArray(data) && !taskbarListLogged) {
    taskbarListLogged = true;
    log('taskbar list ->', data.length, 'windows');
  }
  return { ok: data !== null, data: data };
});

/* Emergency switch: restore / re-hide the native Windows taskbar. */
ipcMain.handle('os-taskbar-shell', async (_e, on) => {
  if (typeof on !== 'boolean') return { ok: true, on: desktopShellHidden };
  desktopShellHidden = on;
  setShellTakeover(on);
  runDesktopShell(on ? 'hide' : 'show');
  if (on) startDesktopShellWatch(); else stopDesktopShellWatch();
  try { buildTray(); } catch (e) {}
  return { ok: true, on: on };
});

/* ---------------- native desktop <-> Pico RamOS -------------------------
 * Win+D itself cannot be taken over: Windows registers it inside explorer
 * and RegisterHotKey(MOD_WIN,'D') returns 1409 (already registered) for any
 * other process. Win+Shift+D IS free (verified), so that is our toggle.
 * No low-level keyboard hook: a global hook would add latency to every
 * keystroke and make IME switching worse, not better.
 *
 * 'pico'   = glass dock + widgets, native taskbar / desktop icons hidden
 * 'native' = plain Windows desktop, shell window hidden, native shell back
 */
let desktopMode = 'pico';
let imePollTimer = null;
let imeBusy = false;
let lastImeSig = '';

function broadcastDesktopMode() {
  if (shellWin && !shellWin.isDestroyed()) {
    try { shellWin.webContents.send('os-desktop-mode', { mode: desktopMode }); } catch (e) {}
  }
}

let modeSwitchBusy = false;
let modeQueued = null;
async function setDesktopMode(next, source) {
  next = next === 'native' ? 'native' : 'pico';
  /* A switch awaits taskbarCmd (up to 8s if the helper is wedged). Two quick
     presses used to interleave show/hide and leave flag, work area and window
     in three different states. Serialise, and keep ONLY the last intent. */
  if (modeSwitchBusy) { modeQueued = { next: next, source: source }; return next; }
  if (next === desktopMode) return desktopMode;
  modeSwitchBusy = true;
  desktopMode = next;
  const toPico = next === 'pico';
  try {
  /* 1. hand the native shell back / take it away. Prefer the resident Win32
        host (one stdin line); fall back to the one-shot script if it is down. */
  let handled = false;
  try { handled = (await taskbarCmd(toPico ? 'hide-shell' : 'show-shell')) !== null; } catch (e) {}
  if (!handled) runDesktopShell(toPico ? 'hide' : 'show');
  /* 2. Windhawk flag: present = keep the native shell hidden. Deleting it
        makes the mod restore the taskbar within two seconds. */
  setShellTakeover(toPico);
  desktopShellHidden = toPico;
  if (toPico) startDesktopShellWatch(); else stopDesktopShellWatch();
  if (toPico) {
    /* Explorer recomputes its appbar right after SW_HIDE and can put the
       reserved 48 px strip straight back. Re-assert the full work area once
       it settles, or maximized windows keep stopping short of the edge. */
    setTimeout(() => { if (desktopMode === 'pico') taskbarFire('workarea-full'); }, 400);
  }
  /* 3. show / hide the bottom-most shell window and its cursor poller */
  if (shellWin && !shellWin.isDestroyed()) {
    if (toPico) {
      shellWin.showInactive();
      pushShellToBottom();
      startShellHitTest();
      if (dockHitWin && !dockHitWin.isDestroyed()) dockHitWin.showInactive();
    } else {
      stopShellHitTest();
      try { shellWin.setIgnoreMouseEvents(true); } catch (e) {}
      shellIgnoreMouse = true;
      shellWin.hide();
      if (dockHitWin && !dockHitWin.isDestroyed()) dockHitWin.hide();
    }
  }
  broadcastDesktopMode();
  try { buildTray(); } catch (e) {}
  log('desktop mode ->', desktopMode, 'via', source || 'shortcut');
  } finally {
    modeSwitchBusy = false;
    const q = modeQueued;
    modeQueued = null;
    if (q && q.next !== desktopMode) setImmediate(() => setDesktopMode(q.next, q.source));
  }
  return desktopMode;
}

function toggleDesktopMode(source) {
  return setDesktopMode(desktopMode === 'pico' ? 'native' : 'pico', source);
}

ipcMain.handle('os-desktop-toggle', () => toggleDesktopMode('ipc'));
ipcMain.handle('os-desktop-mode', () => ({ ok: true, mode: desktopMode }));

/* IME indicator. The resident host answers over stdin; we only push to the
   renderer when the value actually changes, so idle cost is one tiny line
   every 1200 ms and zero DOM work. */
function startImePoll() {
  if (imePollTimer) return;
  imePollTimer = setInterval(async () => {
    /* No IME indicator to paint while the shell is parked behind the native
       desktop: skip the host round-trip entirely instead of polling 1200ms
       forever for a hidden window. */
    if (imeBusy || desktopMode !== 'pico' || !shellWin || shellWin.isDestroyed()) return;
    imeBusy = true;
    let st = null;
    try { st = await taskbarCmd('ime'); } catch (e) {}
    imeBusy = false;
    if (!st || typeof st !== 'object') return;
    const sig = [st.label, st.lang, st.open, st.name].join('|');
    if (sig === lastImeSig) return;
    lastImeSig = sig;
    try { shellWin.webContents.send('os-ime', st); } catch (e) {}
  }, 1200);
  if (imePollTimer.unref) imePollTimer.unref();
}

/* Store/MSIX builds of 网易云音乐 never register an SMTC session (verified:
 * GetSessions() returns 0). A play button on the card was therefore dead.
 * When there is no session, launch the player instead of doing nothing. */
const NETEASE_PFN = '1F8B0F94.122165AE053F_j2p0p5q0044a6';
ipcMain.handle('os-media-control', async (_e, action) => {
  const a = String(action || '');
  if (!['playpause', 'next', 'prev', 'open-player'].includes(a)) return { ok: false, error: 'bad-action' };
  if (a === 'open-player') {
    try {
      spawn('explorer.exe', ['shell:AppsFolder\\' + NETEASE_PFN + '!App'],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return { ok: true, opened: true };
    } catch (e) { return { ok: false, error: e && e.message }; }
  }
  await readMediaSession(a);
  return { ok: true, media: mediaNow };
});

/* layout.js is a browser script that hangs PicoLayout off `window`; load it
   once in the main process so shell state can re-pack from the card set. */
let _shellLayout = undefined;
function shellLayoutModule() {
  if (_shellLayout !== undefined) return _shellLayout;
  _shellLayout = null;
  try {
    if (typeof global.window === 'undefined') global.window = {};
    require(path.join(APP_DIR, 'shell', 'layout.js'));
    _shellLayout = global.window.PicoLayout || null;
  } catch (e) { _shellLayout = null; }
  return _shellLayout;
}

function shellState() {
  const layout = conf.layout || { cols: 4, rows: 3, pages: [], dock: [] };
  /* Only an explicit opt-in re-packs the three curated pages. The old
     `!== false` default silently re-dealt every card into a 6-column grid
     whenever the flag was missing, which emptied page 2. */
  const single = conf.singlePage === true;
  let pages = (layout.pages || []).map((pg) => ({
    id: pg.id,
    name: pg.name,
    cells: (pg.cells || []).filter((cell) => {
      const card = conf.cards.find((c) => c && c.id === cell.cardId);
      return !!card;
    })
  }));
  /* Single-screen mode is computed, never trusted from disk. The renderer
     writes its packed pages back on every boot, so a stale saved layout used
     to push half the widgets onto a hidden second page. Re-pack from the live
     card set with a 6-column grid, which fits all of them on page 0. */
  if (single) {
    const L = shellLayoutModule();
    const cards = conf.cards.filter(Boolean);
    if (L && L.assignSpans && L.pack && cards.length) {
      try {
        const seed = (layout.seed || 1) >>> 0;
        const spans = L.assignSpans(cards, seed);
        const items = cards.map((c) => ({ id: c.id, w: spans[c.id][0], h: spans[c.id][1] }));
        pages = L.pack(items, 6, 3).map((cells, i) => ({
          id: 'p' + (i + 1), name: '场景' + (i + 1), cells: cells
        }));
      } catch (e) { /* fall back to the saved pages if packing fails */ }
    }
  }
  /* Never paint the desktop snapshot. The shell window is transparent and
   * sits above the real wallpaper layer, so Wallpaper Engine stays live.
   * The snapshot is used only by paletteFromWallpaper() to sample colours. */
  const customWall = (conf.wallpaper && conf.wallpaper.src && conf.wallpaper.type !== 'none')
    ? conf.wallpaper
    : { type: 'none', src: '', blur: 0, dim: 0 };
  return {
    /* wallpaper average/dark/light + the live Windows accent: the renderer
       turns these into every glass/text/accent token, so the shell follows
       the system instead of a hard-coded palette */
    /* No wallpaper snapshot (capture blocked / first boot) must not leave the
       shell on a hard-coded grey: fall back to a neutral palette chosen by the
       Windows light/dark setting, and always pass systemDark explicitly. */
    palette: Object.assign(
      {},
      wallpaperPalette || (systemIsDark()
        ? { avg: '#2b3038', dark: '#151820', light: '#c9d4dc' }
        : { avg: '#e3e9ec', dark: '#3b454b', light: '#ffffff' }),
      { accent: systemAccent() || '', systemDark: systemIsDark() }
    ),
    media: Object.assign({}, mediaNow, { lyric: mediaLyric }),
    pages: pages,
    cards: conf.cards.filter(Boolean),
    dock: (layout.dock || []).filter((id) => conf.cards.some((c) => c && c.id === id)),
    cols: single ? 6 : (layout.cols || 4),
    rows: single ? 3 : (layout.rows || 3),
    /* GridPack: seed replays a layout exactly; sig detects card-set changes */
    seed: (layout.seed || 1) >>> 0,
    layoutSig: layout.sig || '',
    wallpaper: customWall,
    followSystemColor: !!conf.followSystemColor,
    /* the composer only needs labels; credentials stay in main */
    mailAccounts: (conf.mail || []).map((a) => ({ label: a.label || '', user: a.user || '' })),
    current: Math.max(0, Number(conf.bootPage) || 0),
    /* perf mode is the default; glassOn restores backdrop-filter in CSS */
    glassOn: conf.glassOn === true
  };
}

function pushShellState() {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.webContents.send('os-changed', shellState());
  }
}

/* Snapshot the real desktop before the shell window opens, then use it as the
 * shell's wallpaper. This keeps whatever the user runs -- a static image or
 * Wallpaper Engine's live scene -- without needing the window to live in the
 * desktop's WorkerW layer (which Explorer no longer exposes reliably). */
async function captureDesktopOnce() {
  try {
    const d = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: d.bounds.width, height: d.bounds.height },
    });
    if (!sources.length) return null;
    const png = sources[0].thumbnail.toPNG();
    const out = path.join(APP_DIR, 'wallpaper-snapshot.png');
    fs.writeFileSync(out, png);
    log('desktop snapshot -> ' + out + ' (' + png.length + ' bytes)');
    return out;
  } catch (err) {
    log('desktop snapshot failed: ' + (err && err.message));
    return null;
  }
}

/* getSources() can stay pending forever at login (DWM not ready, locked
   session, RDP, screen-recording permission prompt). The old `finally` only
   covered rejections, so the shell was NEVER created while the taskbar was
   already hidden. A wallpaper snapshot is optional; the shell is not. */
function captureDesktop() {
  return Promise.race([
    captureDesktopOnce().catch(() => null),
    new Promise((resolve) => {
      /* deliberately NOT unref'd: this timer must keep the event loop alive
         until the shell has actually been opened */
      setTimeout(() => { log('desktop snapshot timeout -> skip'); resolve(null); }, 2500);
    })
  ]);
}

let desktopSnapshot = null;

/* Parent the shell window into the desktop's WorkerW layer: above the
 * wallpaper (so Wallpaper Engine's live scene keeps playing underneath),
 * below every normal window, and out of the taskbar's way. */
function attachToDesktopLayer() {
  try {
    if (!shellWin || shellWin.isDestroyed()) return;
    const script = path.join(APP_DIR, 'workerw.ps1');
    if (!fs.existsSync(script)) { log('workerw.ps1 missing'); return; }
    /* getNativeWindowHandle returns a Buffer holding the HWND (8 bytes on
     * x64); reading it as BigInt64 handles either width. */
    const buf = shellWin.getNativeWindowHandle();
    const hwnd = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
    log('shell hwnd = ' + String(hwnd) + ' (buffer ' + buf.length + 'B)');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Hwnd', String(hwnd)], { encoding: 'utf8', timeout: 15000 });
    log('desktop layer: ' + ((r.stdout || '').trim() || (r.stderr || '').trim()));
  } catch (err) {
    log('desktop layer failed: ' + (err && err.message));
  }
}


/* Windows keeps a freshly shown window above everything. The shell has to sit at
   the very bottom (cards behind real windows), and Electron has no API for that,
   so hand the HWND to SetWindowPos(HWND_BOTTOM) once per reveal. */
let lastBottomAt = 0;
function pushWinToBottom(win) {
  try {
    if (!win || win.isDestroyed()) return;
    /* 'focus', 'show' and 'restore' fire together on every reveal; each one
       spawning a powershell.exe was another burst of process churn. */
    const now = Date.now();
    if (now - lastBottomAt < 800) return;
    lastBottomAt = now;
    const b = win.getNativeWindowHandle();
    const hwnd = b.length >= 8 ? b.readBigUInt64LE(0).toString() : b.readUInt32LE(0).toString();
    /* A focus event used to spawn a whole powershell.exe just to call
       SetWindowPos. That burst landed on every IME/focus change and was a
       large part of "switching input methods feels laggy". The long-lived
       taskbar host does it over stdin: zero process creation. */
    taskbarCmd('bottom', hwnd).catch(() => {});
  } catch (e) { /* best effort */ }
}

function pushShellToBottom() { pushWinToBottom(shellWin); }

/* ---------- native taskbar skin ----------
 * The real Windows taskbar is NEVER hidden. This small window only paints a
 * row of glass blocks over it, and is fully click-through: start, search,
 * tray, clock and every taskbar button keep working exactly as Windows
 * intended. Nothing here calls ShowWindow on Shell_TrayWnd. */
let skinWin = null;

function taskbarSkinBounds() {
  const area = screen.getPrimaryDisplay().bounds;
  const work = screen.getPrimaryDisplay().workArea;
  const bottomGap = Math.max(0, (area.y + area.height) - (work.y + work.height));
  const h = Math.max(40, Math.min(80, bottomGap || 48));
  return {
    x: area.x,
    y: Math.round(area.y + area.height - h - 4),
    width: area.width,
    height: h + 8,
    taskbarH: h,
  };
}

function sendSkinPalette() {
  if (!skinWin || skinWin.isDestroyed()) return;
  try {
    skinWin.webContents.send('skin-palette',
      Object.assign({}, wallpaperPalette || {}, {
        accent: systemAccent() || lastAccent || '',
        systemDark: systemIsDark(),
      }));
  } catch (e) { /* best effort */ }
}

function refreshTaskbarSkin() {
  if (!skinWin || skinWin.isDestroyed()) return;
  const L = taskbarSkinBounds();
  try {
    skinWin.setBounds({ x: L.x, y: L.y, width: L.width, height: L.height });
    skinWin.webContents.send('skin-config', { width: L.width, taskbarH: L.taskbarH });
  } catch (e) { /* best effort */ }
}

function openTaskbarSkin() {
  /* Retired. A separate 'screen-saver' tier window put Pico RamOS ABOVE real
     applications and forced the native taskbar to stay visible. The glass
     taskbar is now drawn inside shellWin (#dock), which is pinned bottom. */
  return;
}

/* ---------- topmost dock hit window ------------------------------------
 * The desktop shell is intentionally HWND_BOTTOM: cards belong behind real
 * windows. That also means a normal app covering the bottom strip takes the
 * dock's clicks - "the taskbar icons are there but nothing happens". A
 * separate transparent window above those apps, sized to exactly the union
 * of the glass blocks, catches the pointer and injects it into the shell
 * renderer with webContents.sendInputEvent. sendInputEvent bypasses OS hit
 * testing entirely, so WS_EX_TRANSPARENT / a busy cursor poller / Z order
 * can no longer eat a dock click. Nothing is painted: zero visual change. */
function dockHitFallbackBounds() {
  const area = screen.getPrimaryDisplay().bounds;
  const u = area.width / 50;
  return {
    x: area.x,
    y: Math.round(area.y + area.height - 0.8 * u - 64 - 6),
    width: area.width,
    height: 76
  };
}
function openDockHitWin() {
  if (dockHitWin && !dockHitWin.isDestroyed()) return;
  const b = dockHitFallbackBounds();
  dockHitWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
    resizable: false, fullscreenable: false, focusable: false, show: false,
    webPreferences: baseWebPrefs(path.join(APP_DIR, 'preload.js')),
  });
  dockHitWin.setAlwaysOnTop(true, 'floating');
  dockHitWin.loadFile(path.join(APP_DIR, 'shell', 'dock-hit.html'));
  dockHitWin.webContents.once('did-finish-load', () => {
    if (dockHitWin && !dockHitWin.isDestroyed() && desktopMode === 'pico') {
      dockHitWin.showInactive();
    }
    syncDockHitBounds();
  });
  dockHitWin.on('closed', () => { dockHitWin = null; });
}
/* The renderer tags each published rect with kind:'dock'. Fit the catcher to
   those blocks so the empty parts of the strip still pass clicks through to
   the desktop / apps underneath. Debounced: heartbeat republishes every 4s. */
function syncDockHitBounds() {
  if (!dockHitWin || dockHitWin.isDestroyed()) return;
  if (dockHitBoundsTimer) clearTimeout(dockHitBoundsTimer);
  dockHitBoundsTimer = setTimeout(() => {
    dockHitBoundsTimer = null;
    if (!dockHitWin || dockHitWin.isDestroyed() || !shellWin || shellWin.isDestroyed()) return;
    const blocks = shellHitRects.filter((r) => r.kind === 'dock');
    if (!blocks.length) { dockHitWin.setBounds(dockHitFallbackBounds()); return; }
    const sb = shellWin.getBounds();
    const u = sb.width / 50;
    /* Horizontal span still comes ONLY from the icon blocks: windows covering
       the bottom-left/right corners keep their clicks. Vertically we now also
       own 1U above the dock and the whole strip below it (where the page dots
       moved), so wheel-paging and right-click work just outside the taskbar
       instead of silently falling through to the window underneath. */
    /* If the native taskbar strip is still reserved (explorer re-asserted its
       appbar, or the Windhawk lease lapsed), a click anywhere in that dead
       band falls through to a REAL taskbar button and launches the wrong app.
       Own the full width while the gap exists; shrink back to the glass blocks
       as soon as the work area is full again. */
    const disp = screen.getPrimaryDisplay();
    const bottomGap = Math.max(0,
      (disp.bounds.y + disp.bounds.height) - (disp.workArea.y + disp.workArea.height));
    const guardStrip = bottomGap > 4;
    const x0 = guardStrip ? 0 : Math.min.apply(null, blocks.map((r) => r.x)) - 6;
    const x1 = guardStrip ? sb.width : Math.max.apply(null, blocks.map((r) => r.x + r.w)) + 6;
    const y0 = Math.min.apply(null, blocks.map((r) => r.y)) - Math.max(10, Math.round(u));
    const y1 = Math.max(
      Math.max.apply(null, blocks.map((r) => r.y + r.h)) + 4,
      sb.height - 4
    );
    dockHitWin.setBounds({
      x: Math.round(sb.x + x0), y: Math.round(sb.y + y0),
      width: Math.max(1, Math.round(x1 - x0)),
      height: Math.max(1, Math.round(y1 - y0))
    });
  }, 120);
}
function closeDockHitWin() {
  if (dockHitBoundsTimer) { clearTimeout(dockHitBoundsTimer); dockHitBoundsTimer = null; }
  if (dockHitWin && !dockHitWin.isDestroyed()) {
    try { dockHitWin.close(); } catch (e) {}
  }
  dockHitWin = null;
}

function openShell() {
  if (shellWin && !shellWin.isDestroyed()) {
    shellWin.showInactive();
    return shellWin;
  }
  /* full display bounds, not workArea: the shell covers the taskbar too */
  const area = screen.getPrimaryDisplay().bounds;
  shellWin = new BrowserWindow({
    x: area.x, y: area.y, width: area.width, height: area.height,
    frame: false,
    /* transparent so the real desktop shows through -- including Wallpaper
     * Engine's animated wallpaper. The shell never paints its own background. */
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    show: false,
    focusable: false,
    webPreferences: baseWebPrefs(path.join(APP_DIR, 'preload.js')),
  });
  shellWin.setMenuBarVisibility(false);
  /* A click on a glass block must not raise the whole desktop shell. */
  shellWin.on('focus', () => pushShellToBottom());
  shellWin.on('show', () => pushShellToBottom());
  shellWin.on('restore', () => pushShellToBottom());
  shellWin.loadFile(path.join(APP_DIR, 'shell', 'os.html'));
  let revealed = false;
  const reveal = () => {
    /* BOTH ready-to-show and did-finish-load can fire. Running the takeover
       twice used to spawn two hide-shell scripts and two watchers. */
    if (revealed) return;
    revealed = true;
    if (!shellWin || shellWin.isDestroyed()) return;
    /* PICO_HEADLESS: render the shell without putting it on screen, for
       offscreen screenshots. Never affects a normal launch. */
    if (process.env.PICO_HEADLESS === '1') { /* stay hidden */ }
    else shellWin.showInactive();
    if (process.env.PICO_DEBUG_SHELL) log('shell window revealed');
    // WorkerW parenting puts us *under* the wallpaper; keep a normal window instead
    shellWin.setAlwaysOnTop(false);
    pushShellToBottom();
    /* The native taskbar and desktop icons step aside; the glass dock drawn
       INSIDE this bottom-most window becomes the taskbar. A watchdog keeps
       them hidden if Explorer or an older Windhawk mod restores them. */
    setShellTakeover(true);
    desktopShellHidden = true;
    runDesktopShell('hide');
    /* Cold start has the same appbar race as a mode switch. */
    setTimeout(() => { if (desktopMode === 'pico') taskbarFire('workarea-full'); }, 800);
    startDesktopShellWatch();
    /* capture our own contents a few seconds after boot so the layout can be
       inspected without having to bring the window in front of everything */
    if (process.env.PICO_CAPTURE) {
      setTimeout(async () => {
        try {
          const probe = await shellWin.webContents.executeJavaScript(
            '(async () => { const w = Array.from(document.querySelectorAll(".widget")).find(function(x){ return /邮件/.test(x.textContent || ""); }); if (w) { w.dispatchEvent(new MouseEvent("click", {bubbles:true})); await new Promise(function(r){ setTimeout(r, 9000); }); } const t0 = Date.now(); let direct = "n/a"; try { const rr = await window.os.mailFetch(3); direct = "ok " + (Date.now()-t0) + "ms len=" + (Array.isArray(rr) ? rr.length : typeof rr) + " keys=" + JSON.stringify((rr||[]).map(function(x){return Object.keys(x||{});})); } catch (e) { direct = "throw " + (Date.now()-t0) + "ms " + (e && e.message); } return JSON.stringify({ fg: getComputedStyle(document.documentElement).getPropertyValue("--fg").trim(), tint: getComputedStyle(document.documentElement).getPropertyValue("--glass-tint").trim(), onDark: document.body.className, wv: Array.from(document.querySelectorAll("webview")).map(function(v){return {src: v.getAttribute("src"), box: v.getBoundingClientRect().width|0};}), mail: (function(){var m=document.querySelector(".mail");return m ? m.textContent.replace(/\\s+/g," ").slice(0,200) : "no .mail";})(), direct: direct, hasMailFetch: typeof window.os.mailFetch, drawer: (function(){var d=document.getElementById("drawer");return d?{hidden:d.hidden,open:d.classList.contains("open"),w:d.getBoundingClientRect().width|0}:"none";})(), widgets: document.querySelectorAll(".widget").length }); })()'
          ).catch((e) => 'probe failed: ' + (e && e.message));
          log('style probe ->', probe);
          const image = await shellWin.webContents.capturePage();
          const p = path.join(APP_DIR, 'shell-capture.png');
          fs.writeFileSync(p, image.toPNG());
          log('auto capture ->', p, image.getSize());
        } catch (e) {
          log('auto capture failed', e && e.message);
        }
      }, Number(process.env.PICO_CAPTURE) || 6000);
    }
  };
  /* ready-to-show can be skipped (a v8 cached paint, or show:false plus a
   * renderer that finishes before the first composite). did-finish-load is
   * the reliable second chance. */
  shellWin.once('ready-to-show', reveal);
  shellWin.webContents.once('did-finish-load', reveal);
  shellWin.webContents.on('render-process-gone', (_e, details) => {
    log('shell renderer gone:', details && details.reason);
    reviveShell('render-process-gone');
  });
  shellWin.webContents.on('unresponsive', () => {
    log('shell renderer unresponsive');
    reviveShell('unresponsive');
  });
  shellWin.webContents.on('responsive', () => {
    shellReviveCount = 0;              // a healthy long session resets the cap
  });
  shellWin.webContents.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;   // -3 = ERR_ABORTED, normal on reload
    log('shell did-fail-load', code, desc);
    reviveShell('did-fail-load');
  });
  shellWin.on('closed', () => {
    stopShellHitTest(); stopMediaPoll(); stopStartMenuGuard();
    clearBootDefers(); closeDockHitWin();
    shellWin = null;
  });
  /* click-through: the MAIN process polls the cursor (startShellHitTest) and
   * flips this back when the pointer enters a widget. `forward: true` used to
   * install a global low-level mouse hook that intercepted every mouse message
   * on the whole system -- that was the "mouse is sluggish on the bare desktop"
   * complaint. The poller, not a renderer mousemove, owns the switch. */
  shellWin.setIgnoreMouseEvents(true);
  shellIgnoreMouse = true;
  startShellHitTest();
  /* Above every normal window, but only over the dock blocks themselves. */
  openDockHitWin();
  /* First paint only needs hit-testing. IME polling spins up the Win32 host
     and media.ps1 loads WinRT; both land after the window is already up. */
  deferBoot(startImePoll, 1200);
  deferBoot(startMediaPoll, 2400);
  // Guard is parked until the shell's own start panel actually renders and is
  // verified: while it is broken the guard just leaves the user with no start
  // menu at all. Set PICO_START_GUARD=1 to bring it back.
  if (process.env.PICO_START_GUARD === '1') startStartMenuGuard();
  return shellWin;
}

/* Launch one card from inside the shell. Tiles spawn their target; widgets are
 * already visible and just get focused (their page switches in the UI). */
function launchCardFromShell(id) {
  const cfg = conf.cards.find((c) => c && c.id === id);
  if (!cfg) return { ok: false, err: 'unknown card' };
  if (cfg.kind === 'app') {
    if (!cfg.target) return { ok: false, err: 'no target' };
    const useShell = /\.(bat|cmd|lnk|url)$/i.test(cfg.target);
    try {
      spawn(cfg.target, [], { detached: true, stdio: 'ignore', shell: useShell, windowsHide: true }).unref();
      return { ok: true };
    } catch (e) {
      log('shell launch fail', e.message);
      return { ok: false, err: e.message };
    }
  }
  if (cfg.kind === 'folder') {
    try {
      spawn('explorer.exe', [cfg.target || '.'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return { ok: true };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }
  if (cfg.kind === 'module') {
    /* module cards render inside the sheet; nothing to spawn here */
    return { ok: true, inline: true };
  }
  /* web / bili / mail: the widget already renders it in place */
  return { ok: true, inline: true };
}

/* Drop a card onto a grid cell. Swaps with whatever already sits there so a
 * page never ends up with two widgets stacked on one cell. */
function moveCardInGrid(id, pageIndex, col, row) {
  const layout = conf.layout;
  if (!layout || !Array.isArray(layout.pages)) return { ok: false };
  const page = layout.pages[pageIndex];
  if (!page) return { ok: false };
  const cols = layout.cols || 4;
  const rows = layout.rows || 3;
  const cells = page.cells || [];
  const moving = cells.find((c) => c.cardId === id);
  if (!moving) return { ok: false };

  const targetCol = Math.max(0, Math.min(cols - moving.w, col));
  const targetRow = Math.max(0, Math.min(rows - moving.h, row));

  /* pick up every cell the moving card overlaps at its destination */
  const blockers = cells.filter((c) => c !== moving &&
    targetCol < c.x + c.w && c.x < targetCol + moving.w &&
    targetRow < c.y + c.h && c.y < targetRow + moving.h);

  const from = { x: moving.x, y: moving.y };
  moving.x = targetCol;
  moving.y = targetRow;
  /* displaced cards trade places with the origin slot when they fit, otherwise
   * they slide to the first free spot on the page */
  blockers.forEach((b) => {
    if (from.x + b.w <= cols && from.y + b.h <= rows &&
        !cells.some((o) => o !== b && o !== moving &&
          from.x < o.x + o.w && o.x < from.x + b.w &&
          from.y < o.y + o.h && o.y < from.y + b.h)) {
      b.x = from.x;
      b.y = from.y;
    }
  });

  saveConf();
  pushShellState();
  return { ok: true };
}


/* dev helper: capture the shell's own contents, ignoring whatever window the
   user happens to have in front of it */
ipcMain.handle('os-capture', async (_e, outPath) => {
  if (!shellWin || shellWin.isDestroyed()) return { ok: false, error: 'no window' };
  const target = outPath || path.join(APP_DIR, 'shell-capture.png');
  try {
    const image = await shellWin.webContents.capturePage();
    fs.writeFileSync(target, image.toPNG());
    log('captured shell ->', target, image.getSize());
    return { ok: true, path: target };
  } catch (e) {
    log('capture failed', e && e.message);
    return { ok: false, error: String(e && e.message) };
  }
});

ipcMain.handle('os-get-state', () => shellState());
ipcMain.handle('os-launch', (_e, id) => launchCardFromShell(id));

/* launch a bare .lnk from the folder card: no card id involved */
ipcMain.handle('os-launch-path', async (_e, target) => {
  try {
    const t = String(target || '');
    if (!t || !fs.existsSync(t)) return { ok: false, error: '文件不存在' };
    const err = await shell.openPath(t);
    return err ? { ok: false, error: err } : { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('os-move-card', (_e, id, page, col, row) => moveCardInGrid(id, page, col, row));

/* free placement: a card keeps its own pixel rectangle and opacity */
ipcMain.handle('os-card-rect', (_e, id, rect) => {
  const card = conf.cards.find((c) => c && c.id === id);
  if (!card || !rect) return false;
  card.rect = {
    x: Math.round(rect.x), y: Math.round(rect.y),
    w: Math.round(rect.w), h: Math.round(rect.h),
  };
  saveConf();
  return true;
});
ipcMain.handle('os-card-opacity', (_e, id, value) => {
  const card = conf.cards.find((c) => c && c.id === id);
  if (!card) return false;
  card.opacity = Math.max(0.25, Math.min(1, Number(value) || 1));
  saveConf();
  return true;
});

/* GridPack: the renderer packs every card into cells (spans + pages + rects,
   no overlap by construction) and writes the whole layout back in one shot. */
ipcMain.handle('os-set-layout', (_e, payload) => {
  const p = payload || {};
  conf.layout = conf.layout || { cols: 4, rows: 3, pages: [], dock: [] };
  if (p.seed != null) conf.layout.seed = (p.seed >>> 0) || 1;
  conf.layout.sig = String(p.sig || '');
  /* The renderer owns the grid (1U = innerWidth / 50). Honour it with hard
     bounds so a poisoned/corrupt renderer cannot write 10^9 columns. Legacy
     configs that explicitly set singlePage:true keep their fixed 6x3 grid. */
  if (conf.singlePage === false) {
    if (p.cols != null) conf.layout.cols = clampInt(p.cols, 1, 200);
    if (p.rows != null) conf.layout.rows = clampInt(p.rows, 1, 200);
  } else {
    conf.layout.cols = 6;
    conf.layout.rows = 3;
  }
  if (Array.isArray(p.pages) && p.pages.length && p.pages.length <= 32) {
    conf.layout.pages = p.pages.map((pg, i) => ({
      id: String((pg && pg.id) || ('p' + (i + 1))).slice(0, 64),
      name: String((pg && pg.name) || ('场景' + (i + 1))).slice(0, 64),
      cells: (Array.isArray(pg && pg.cells) ? pg.cells : [])
        .filter((c) => c && typeof c.cardId === 'string')
        .slice(0, 256)
        .map((c) => Object.assign({}, c, {
          x: clampInt(c.x, 0, 200), y: clampInt(c.y, 0, 200),
          w: clampInt(c.w, 1, 200), h: clampInt(c.h, 1, 200)
        })),
    }));
  }
  (p.cards || []).forEach((c) => {
    const card = conf.cards.find((x) => x && x.id === c.id);
    if (!card) return;
    card.page = c.page || 0;
    card.spanW = Math.max(1, c.spanW || 1);
    card.spanH = Math.max(1, c.spanH || 1);
    if (c.rect) {
      card.rect = {
        x: Math.round(c.rect.x), y: Math.round(c.rect.y),
        w: Math.round(c.rect.w), h: Math.round(c.rect.h),
      };
    }
  });
  saveConf();
  pushShellState();
  return true;
});

/* ---- click-through ------------------------------------------------------
 * A renderer-side pointermove listener cannot work here: the window ignores
 * the mouse, so pointer events never arrive and nothing can ever flip it back.
 * Instead the renderer just publishes the rectangles that are interactive,
 * and the main process polls the real cursor position. One syscall every
 * 40ms is far cheaper than one IPC per mousemove, and it cannot get stuck. */
let shellHitRects = [];
let shellHitRectsAt = 0;
/* A drag starts on a widget but the pointer can leave every hit rect. Without
   this flag the poller makes the window click-through mid-drag and the
   pointerup never arrives, leaving a card glued to the cursor for up to 20s. */
let shellDragActive = false;   // shell DOM drag (distinct from card-window dragActive)
let systemSuspended = false;
let lastShellReviveAt = 0;
let shellReviveCount = 0;
let quitting = false;
let quitHardExit = null;   // last-resort exit if a hidden window blocks app.quit()

/* Renderer / GPU death used to produce a frozen, invisible "desktop" that
   still renewed the Windhawk lease and kept the native taskbar hidden.
   Rebuild the shell from main, with a cooldown to avoid a crash loop. */
function reviveShell(reason) {
  /* Closing a window also emits render-process-gone. Never resurrect the
     shell while the user (or before-quit) is tearing the app down. */
  if (quitting || (app && app.isQuitting)) return false;
  if (desktopMode !== 'pico') return false;
  const now = Date.now();
  if (now - lastShellReviveAt < 10000) return false;
  lastShellReviveAt = now;
  if (++shellReviveCount > 5) { log('shell revive limit reached', reason); return false; }
  log('shell revive ->', reason, '#' + shellReviveCount);
  try { if (shellWin && !shellWin.isDestroyed()) shellWin.destroy(); }
  catch (e) { log('shell destroy fail', e.message); }
  shellWin = null;
  setTimeout(() => {
    try { openShell(); } catch (e) { log('shell revive fail', e.message); }
  }, 300);
  return true;
}

const MAX_HIT_RECTS = 500;
const SANE_COORD = 100000;
ipcMain.handle('os-set-hit-rects', (_e, rects) => {
  /* Bounded input: the renderer is trusted code, but a wedged or poisoned
     renderer publishing 100k rects used to be able to stall the main process
     inside pointInRects on every 16ms poll tick. */
  shellHitRects = Array.isArray(rects)
    ? rects.slice(0, MAX_HIT_RECTS)
      .filter((r) => r && [r.x, r.y, r.w, r.h].every((n) => Number.isFinite(Number(n))) &&
                     Number(r.w) > 0 && Number(r.h) > 0 && Number(r.w) < SANE_COORD && Number(r.h) < SANE_COORD)
      .map((r) => ({ x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) }))
    : [];
  shellHitRectsAt = Date.now();
  syncDockHitBounds();
  if (process.env.PICO_DEBUG_SHELL) log('hit rects ->', shellHitRects.length, JSON.stringify(shellHitRects.slice(0, 3)));
  return { ok: true, n: shellHitRects.length };
});

ipcMain.handle('config-health', () => configHealth());
ipcMain.on('os-drag-active', (_e, on) => { shellDragActive = !!on; if (shellDragActive) applyShellIgnore(false); });
ipcMain.handle('os-shell-boot-failed', () => { log('shell boot failed -> reviving'); reviveShell('boot-failed'); return true; });

/* Pointer events from the topmost dock catcher. Inject them straight into the
   shell renderer: this path does not depend on the OS hit test, on the shell's
   WS_EX_TRANSPARENT state, or on the cursor poller's timing. */
const DOCK_HIT_TYPES = new Set([
  'mouseDown', 'mouseUp', 'mouseMove', 'mouseEnter', 'mouseLeave',
  'mouseWheel', 'contextMenu'
]);
let dockHitMoveAt = 0, dockHitMoveX = -1, dockHitMoveY = -1;
ipcMain.on('os-dock-hit', (_e, ev) => {
  if (!ev || desktopMode !== 'pico') return;
  if (!DOCK_HIT_TYPES.has(ev.type)) return;
  if (!shellWin || shellWin.isDestroyed() || !dockHitWin || dockHitWin.isDestroyed()) return;
  const hb = dockHitWin.getBounds();
  const sb = shellWin.getBounds();
  const rawX = Number(ev.x), rawY = Number(ev.y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return;
  /* Clamp into the shell window: a stale catcher bound or a DPI change can
     otherwise inject a click far outside any widget. */
  const x = Math.max(0, Math.min(sb.width - 1, hb.x - sb.x + rawX));
  const y = Math.max(0, Math.min(sb.height - 1, hb.y - sb.y + rawY));
  /* Hover injection is the highest-frequency traffic in the whole app. The
     catcher already throttles at 33ms; keep a second guard here so a stray
     or older renderer cannot flood the shell with mousemove events (that
     showed up as input/IME lag). Clicks and wheels are never throttled. */
  if (ev.type === 'mouseMove') {
    const t = Date.now();
    if (t - dockHitMoveAt < 30) return;
    if (Math.abs(x - dockHitMoveX) < 2 && Math.abs(y - dockHitMoveY) < 2) return;
    dockHitMoveAt = t; dockHitMoveX = x; dockHitMoveY = y;
  }
  const packet = {
    type: ev.type, x: x, y: y,
    button: ev.button === 'right' ? 'right' : 'left',
    clickCount: clampInt(ev.clickCount || 1, 1, 4),
    modifiers: []
  };
  if (ev.type === 'mouseWheel') {
    packet.deltaX = clampInt(ev.deltaX, -2000, 2000);
    packet.deltaY = clampInt(ev.deltaY, -2000, 2000);
  }
  try { shellWin.webContents.sendInputEvent(packet); }
  catch (err) { /* renderer went away mid-click */ }
});

/* Right-click: an injected `contextMenu` input event does NOT produce a DOM
   contextmenu in Electron (verified with a real-renderer probe), which is why
   right-clicking the glass taskbar used to do absolutely nothing. The catcher
   now sends a dedicated one-way message; main broadcasts the REAL cursor so
   the shell can draw its own glass-skinned menu at the right place. */
ipcMain.on('os-dock-context-menu', () => {
  if (desktopMode !== 'pico' || !shellWin || shellWin.isDestroyed()) return;
  const sb = shellWin.getBounds();
  const pt = screen.getCursorScreenPoint();
  try {
    shellWin.webContents.send('os-show-glass-menu', {
      x: Math.max(0, Math.min(sb.width - 1, pt.x - sb.x)),
      y: Math.max(0, Math.min(sb.height - 1, pt.y - sb.y))
    });
  } catch (e) { /* shell went away */ }
});

/* Glass menu actions mirror the tray menu, so there is exactly one set of
   behaviours no matter where the user opens it. */
const GLASS_MENU_ACTIONS = {
  manager: () => openManager(),
  reroll: () => { layoutScene(conf.activeScene, true); broadcastFocus(); },
  clickthrough: () => setClickThrough(),
  desktop: () => { toggleDesktopMode('glass-menu'); },
  quit: () => app.quit()
};
ipcMain.handle('os-menu-action', (_e, key) => {
  const fn = GLASS_MENU_ACTIONS[String(key || '')];
  if (!fn) return { ok: false, reason: 'unknown action' };
  try { fn(); return { ok: true }; }
  catch (err) {
    log('glass menu action failed', key, err && err.message);
    return { ok: false };
  }
});

/* Ctrl+Alt+Left/Right page the shell from anywhere, including bare desktop
   areas where a real wheel belongs to the window underneath. Zero hooks,
   zero extra windows, zero stolen clicks. */
function sendPageStep(dir) {
  if (desktopMode !== 'pico' || !shellWin || shellWin.isDestroyed()) return;
  try { shellWin.webContents.send('os-page-step', dir > 0 ? 1 : -1); }
  catch (e) { /* shell went away */ }
}

/* The dock is the one part of the shell that must ALWAYS be clickable. Its band
   is derived from the shell window's own geometry (0.8U inset + 64px dock,
   matching --dock-inset / --dock-h), NOT from renderer hit rects. A renderer
   that hangs, crashes, misses a layout callback or publishes stale coordinates
   can never again leave the taskbar looking alive but swallowing clicks. This
   band used to be a stale-rect fallback only; it is now the primary dock rule. */
function dockFallbackBand() {
  if (!shellWin || shellWin.isDestroyed()) return null;
  const b = shellWin.getBounds();
  const u = b.width / 50;
  const h = 64;
  return { x: b.x, y: b.y + b.height - 0.8 * u - h, w: b.width, h: h };
}
function pointInBand(pt, band) {
  return !!band && pt.x >= band.x && pt.x <= band.x + band.w &&
         pt.y >= band.y && pt.y <= band.y + band.h;
}

function pointInRects(pt, rects) {
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h) return true;
  }
  return false;
}

let shellHitTimer = null;
/* --- start menu guard -----------------------------------------------------
 * Win11's start menu (SearchHost.exe / Windows.UI.Core.CoreWindow) is not
 * reachable through EnumWindows, but it always takes the foreground when it
 * opens. startmenu-guard.ps1 polls GetForegroundWindow and hides it, printing
 * one "SHOWN" per press so we can slide our own panel in instead. */
let startMenuGuard = null;

function startStartMenuGuard() {
  let guardProc = null;
  try { globalThis.__picoGuard = () => { try { guardProc && guardProc.kill(); } catch (e) {} }; } catch (e) {}
  if (startMenuGuard || process.platform !== 'win32') return;
  try {
    const p = spawn(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(APP_DIR, 'startmenu-guard.ps1'), String(process.pid)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    startMenuGuard = p;
    let buf = '';
    p.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r/g, '').trim();
        buf = buf.slice(nl + 1);
        if (line) log('guard line:', line);
        if (line === 'SHOWN' && shellWin && !shellWin.isDestroyed()) {
          log('start menu -> show panel');
          shellWin.webContents.send('os-start-menu');
        }
      }
    });
    p.on('exit', () => { startMenuGuard = null; });
    log('start menu guard -> up');
  } catch (e) {
    log('start menu guard failed:', e && e.message);
  }
}

function stopStartMenuGuard() {
  if (!startMenuGuard) return;
  try { startMenuGuard.kill(); } catch (e) {}
  startMenuGuard = null;
}

let hitOutsideSince = 0;
let lastHitPoint = null;
function applyShellIgnore(want) {
  if (want === shellIgnoreMouse) return;
  shellIgnoreMouse = want;
  try { shellWin.setIgnoreMouseEvents(want); }
  catch (err) { log('ignore-mouse failed', err && err.message); }
}
function startShellHitTest() {
  if (shellHitTimer) clearInterval(shellHitTimer);
  lastHitPoint = null;
  shellHitTimer = setInterval(() => {
    if (!shellWin || shellWin.isDestroyed() || desktopMode !== 'pico' || systemSuspended) return;
    if (shellDragActive) { hitOutsideSince = 0; applyShellIgnore(false); return; }
    const pt = screen.getCursorScreenPoint();
    const moved = !lastHitPoint || pt.x !== lastHitPoint.x || pt.y !== lastHitPoint.y;
    lastHitPoint = pt;
    /* An idle cursor over bare desktop is the common case. Skip all rect
       maths and all Win32 style work; the first movement still flips the
       window on the very next tick (25ms). This halves the poller's cost
       versus 16ms without slowing an entering click. */
    if (!moved && shellIgnoreMouse === true) return;
    /* Dock FIRST: pure window geometry, independent of the renderer. Widget
       rects published by the renderer still cover the cards themselves. */
    const inside = pointInBand(pt, dockFallbackBand()) ||
                   pointInRects(pt, shellHitRects);
    if (inside) {
      /* ENTER a clickable region IMMEDIATELY - no vote, no debounce. A quick
         click used to land while the window was still WS_EX_TRANSPARENT. */
      hitOutsideSince = 0;
      applyShellIgnore(false);
      return;
    }
    /* LEAVE is time-based rather than vote-based: 120ms of continuous outside
       time before going click-through, so crossing the seam between two glass
       blocks cannot momentarily eat a click. Polling at 16ms also narrows the
       window in which a busy main thread can delay the flip. */
    if (!hitOutsideSince) hitOutsideSince = Date.now();
    if (Date.now() - hitOutsideSince < 120) return;
    applyShellIgnore(true);
  }, 25);
}

function stopShellHitTest() {
  if (shellHitTimer) { clearInterval(shellHitTimer); shellHitTimer = null; }
}

async function createCard(cfg) {
  if (cardWins.has(cfg.id)) { showCard(cfg.id); return; }
  /* Shell mode: every card is a DOM node inside shellWin, so there is no
   * per-card BrowserWindow to create. */
  if (SHELL_MODE) return;
  // no saved position -> this card joins the current page's Tetris mosaic.
  // The pack MUST run after the window exists and is registered (commitRect
  // targets cardWins): packing before creation left the window at its raw
  // base size, and the first card writing cfg.x made every later card skip
  // the pack entirely.
  const win = new BrowserWindow({
    width: cfg.w, height: cfg.h, x: cfg.x, y: cfg.y,
    frame: false, transparent: false, backgroundColor: '#00000000',
    // Real frost: Windows 11 draws the acrylic material behind the page, so
    // the desktop actually blurs through the card. backdrop-filter alone
    // cannot - it only samples the page's own content, never the desktop.
    backgroundMaterial: 'acrylic',
    hasShadow: false, alwaysOnTop: false, skipTaskbar: true,
    resizable: false, fullscreenable: false, show: false,
    focusable: false,
    webPreferences: baseWebPrefs(path.join(APP_DIR, 'preload.js')),
  });
  // record the rect we asked for: a fresh window's first (async) move echo
  // is ours, not a user drag, and must not trigger edge snapping
  let baseW = 0, baseH = 0;
  {
    const ib = win.getBounds();
    placedRects.set(win, { x: ib.x, y: ib.y, w: ib.width, h: ib.height });
    baseW = ib.width; baseH = ib.height;
  }
  win.setAlwaysOnTop(false);
  {
    const raw = Number(cfg.opacity);
    const op = Number.isFinite(raw) && raw > 0 ? raw : 0.92;
    win.setOpacity(Math.min(1, Math.max(0.15, op)));
  }
  /* AUTHORITATIVE window size. A transparent frameless window grows ~1px per
   * setBounds on fractional-DPI displays (125% scaling: Windows rounds the
   * rect up). Pinning the live getBounds() read on every move therefore
   * RATCHETED the card bigger on every drag - 206x204 grew to 992x946 in one
   * 72s drag session (field report 2026-10-15: "移动卡片的时候卡片还是会自己
   * 放大"). Every internal move (drag / clamp / snap / give-way) pins THIS
   * value instead; only an explicit resize gesture (resize-to / resize-by /
   * cards-update) or a mosaic re-pack may change it. */
  const c = { win, cfg, baseW, baseH };
  cardWins.set(cfg.id, c);
  // pack the mosaic with THIS window included (fresh cards land at their slot,
  // existing windows are re-committed at their scaled display size)
  ensureLayout();

  win.on('closed', () => { cardWins.delete(cfg.id); });
  win.webContents.on('did-finish-load', () => { win.showInactive(); });
  // Live snap while dragging: guarded against the move events our own snap
  // causes, and latched to one adjustment per drag so cards never oscillate.
  win.on('move', () => {
    if (boundsLockNow(win)) return;                    // our own enforcement echoes
    if (snapping) return;                                   // our own reposition
    if (animDepth > 0) return;                              // a tween is flying
    const pr = placedRects.get(win);                        // async echo of a commit?
    if (pr) {
      const bb = win.getBounds();
      if (bb.x === pr.x && bb.y === pr.y && bb.width === pr.w && bb.height === pr.h) {
        placedRects.delete(win);
        return;
      }
    }
    if (dragActive === cfg.id) return;                       // mosaic drag = reorder: the pack owns position, never snap
    // not an active user drag: only re-snap if the move came from a zoom/resize
    // we didn't trigger (e.g. cards-update setBounds). Keep it cheap.
    snapEdges(cfg.id);
  });
  // widget mode: if anything raises the card, drop it back to the bottom
  win.on('focus', () => { if (conf.mode === 'desktop') zOrder(cfg.id, 'bottom'); });

  if (cfg.kind === 'module') {
    win.loadFile(modulePath(cfg.target));
  } else if (cfg.kind === 'mail') {
    win.loadFile(modulePath('mail'));
  } else {
    win.loadFile(shellPath());
  }
  applyClickThrough(cfg.id);
  return win;
}

function showCard(id) {
  const c = cardWins.get(id);
  if (c && !c.win.isDestroyed()) {
    c.win.showInactive();
    if (conf.mode === 'desktop') zOrder(id, 'bottom');
  }
}
function hideCard(id) {
  const c = cardWins.get(id);
  if (c && !c.win.isDestroyed()) c.win.hide();
}
function closeCard(id) {
  const c = cardWins.get(id);
  if (c && !c.win.isDestroyed()) c.win.close();
  cardWins.delete(id);
}
function showAll() {
  // scene-aware: "show all" means the CURRENT page, not every scene at once
  cardWins.forEach((c, id) => { if (c.cfg.scene === conf.activeScene) showCard(id); });
}
function hideAll() { cardWins.forEach((_c, id) => hideCard(id)); }

/* ---------------- scenes (workspace pages) ----------------
 * The right-edge dock renders one circle per scene (active one enlarged).
 * Switching hides every card of the other scenes and shows this scene's;
 * spawned app processes keep running while their card is hidden. */
function sceneById(id) { return (conf.scenes || []).find((s) => s.id === id) || null; }
function cardsInScene(id) { return conf.cards.filter((c) => c && c.scene === id); }
function sceneIndex(id) { return (conf.scenes || []).findIndex((s) => s.id === id); }

function switchScene(id) {
  const s = sceneById(id);
  if (!s || id === conf.activeScene) return false;
  conf.activeScene = id;
  // the incoming page's first card anchors its mosaic
  const first = conf.cards.find((c) => (c.scene || 'main') === id);
  if (first) conf.activeCard = first.id;
  // stage the mosaic just off the RIGHT edge, then spring it in: cards
  // "unfold from the right" the way the user asked
  const rects = tetrisRects(id);
  const wa = screen.getPrimaryDisplay().workArea;
  cardWins.forEach((c) => {
    if (c.win.isDestroyed()) return;
    if (c.cfg.scene === id) {
      const r = rects.find((k) => k.id === c.cfg.id);
      if (r) commitRect(c.win, wa.x + wa.width - 40, r.y, r.w, r.h);
      c.win.showInactive();
      if (conf.mode === 'desktop') zOrder(c.cfg.id, 'bottom');
    } else {
      c.win.hide();
    }
  });
  layoutScene(id, true);
  broadcastFocus();
  saveConf();
  refreshDock();
  showSceneToast(s);
  return true;
}
function addScene(name) {
  const n = (conf.scenes || []).length;
  const s = {
    id: 'scene-' + Date.now().toString(36),
    name: (typeof name === 'string' && name.trim()) ? name.trim() : '场景 ' + (n + 1),
  };
  conf.scenes.push(s);
  saveConf();
  refreshDock();
  return s;
}
function renameScene(id, name) {
  const s = sceneById(id);
  if (!s) return false;
  s.name = (typeof name === 'string' && name.trim()) ? name.trim() : s.name;
  saveConf();
  refreshDock();
  return true;
}
function deleteScene(id) {
  if ((conf.scenes || []).length <= 1) return false;      // always keep one page
  const idx = sceneIndex(id);
  if (idx < 0) return false;
  const fallback = conf.scenes[(idx + 1) % conf.scenes.length].id;
  conf.scenes.splice(idx, 1);
  // re-home the orphaned cards, then re-sync EVERY card window against the
  // (possibly new) active scene so no card is left hidden on its own page
  conf.cards.forEach((c) => {
    if (!c) return;
    if (c.scene === id) c.scene = fallback;
    const w = cardWins.get(c.id);
    if (w && !w.win.isDestroyed()) {
      if (c.scene === conf.activeScene) w.win.showInactive();
      else w.win.hide();
    }
  });
  if (conf.activeScene === id) conf.activeScene = fallback;
  saveConf();
  refreshDock();
  return true;
}
function moveCardScene(cardId, sceneId) {
  if (!sceneById(sceneId)) return false;
  const cfg = conf.cards.find((c) => c.id === cardId);
  if (!cfg || cfg.scene === sceneId) return false;
  cfg.scene = sceneId;
  const c = cardWins.get(cardId);
  if (c && !c.win.isDestroyed()) {
    if (sceneId === conf.activeScene) c.win.showInactive();
    else c.win.hide();
  }
  // both pages' mosaics changed: the card left one pack and joined another
  layoutAllScenes(false);
  saveConf();
  refreshDock();
  return true;
}
// reorder a card among its scene siblings (drives cascade order + z stacking)
function reorderCardInScene(cardId, dir) {
  const cfg = conf.cards.find((c) => c.id === cardId);
  if (!cfg || !dir) return false;
  const sibs = conf.cards.filter((c) => c.scene === cfg.scene);
  const i = sibs.indexOf(cfg);
  const j = i + (dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= sibs.length) return false;
  const a = conf.cards.indexOf(sibs[i]), b = conf.cards.indexOf(sibs[j]);
  conf.cards[a] = sibs[j]; conf.cards[b] = sibs[i];
  saveConf();
  refreshDock();
  return true;
}

/* ---------- scene dock (right-edge circle pager) ---------- */
let dockWin = null;
/* Horizontal pager directly BELOW the glass taskbar (the taskbar itself was
   lifted 42px to make room). One slot per shell page, not per conf.scenes:
   the shell is the desktop the user actually pages left/right. */
function dockLayout() {
  const n = Math.max(1, (shellState().pages || []).length);
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 22 + n * 30 + 38;
  const h = 40;
  return {
    w, h,
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + wa.height - h - 8)
  };
}
/* manager.js still uses the legacy conf.scenes list through 'scene-list'. */
function dockState() {
  return {
    scenes: (conf.scenes || []).map((s) => ({ id: s.id, name: s.name, count: cardsInScene(s.id).length })),
    active: conf.activeScene,
  };
}
/* scene-dock window uses SHELL pages so its dots match the horizontal paging. */
function pageDockState() {
  const pages = shellState().pages || [];
  const idx = Math.max(0, Math.min(pages.length - 1, Number(conf.bootPage) || 0));
  return {
    scenes: pages.map((p, i) => ({
      id: 'page-' + i,
      name: p.name || ('场景' + (i + 1)),
      count: (p.cells || []).length
    })),
    active: 'page-' + idx
  };
}
function pageGo(id) {
  const m = /^page-(\d+)$/.exec(String(id || ''));
  if (!m) return false;
  const n = (shellState().pages || []).length;
  const i = Math.max(0, Math.min(n - 1, Number(m[1]) | 0));
  conf.bootPage = i;
  saveConf();
  pushShellState();
  refreshDock();
  return true;
}
function pageAdd(name) {
  conf.layout = conf.layout || { cols: 6, rows: 3, pages: [] };
  const pages = conf.layout.pages || (conf.layout.pages = []);
  pages.push({
    id: 'p' + (pages.length + 1),
    name: (typeof name === 'string' && name.trim()) ? name.trim() : ('场景 ' + (pages.length + 1)),
    cells: []
  });
  saveConf();
  pushShellState();
  refreshDock();
  return true;
}
function openDock() {
  if (dockWin && !dockWin.isDestroyed()) return;
  const L = dockLayout();
  dockWin = new BrowserWindow({
    width: L.w, height: L.h, x: L.x, y: L.y,
    frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, alwaysOnTop: false, skipTaskbar: true,
    resizable: false, fullscreenable: false, focusable: false, show: false,
    webPreferences: baseWebPrefs(path.join(APP_DIR, 'preload.js')),
  });
  dockWin.setAlwaysOnTop(false);
  dockWin.loadFile(path.join(APP_DIR, 'scene-dock.html'));
  dockWin.webContents.on('did-finish-load', () => {
    dockWin.showInactive();
    pushWinToBottom(dockWin);
  });
  dockWin.on('closed', () => { dockWin = null; });
}
function refreshDock() {
  if (!dockWin || dockWin.isDestroyed()) return;
  const L = dockLayout();
  dockWin.setBounds({ x: L.x, y: L.y, width: L.w, height: L.h });
  try { dockWin.webContents.send('dock-scenes', pageDockState()); } catch (e) {}
}

/* ---------- scene toast (which page am I on) ---------- */
let toastWin = null;
let toastTimer = null;
function showSceneToast(scene) {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  if (toastWin && !toastWin.isDestroyed()) { toastWin.close(); toastWin = null; }
  const idx = sceneIndex(scene.id);
  const total = (conf.scenes || []).length;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = 260, h = 48;
  toastWin = new BrowserWindow({
    width: w, height: h,
    x: Math.round(wa.x + (wa.width - w) / 2),
    y: Math.round(wa.y + Math.round(wa.height * 0.16)),
    frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, alwaysOnTop: false, skipTaskbar: true,
    resizable: false, fullscreenable: false, focusable: false, show: false,
    webPreferences: baseWebPrefs(path.join(APP_DIR, 'preload.js')),
  });
  toastWin.setAlwaysOnTop(false);
  toastWin.loadFile(path.join(APP_DIR, 'scene-toast.html') +
    '?label=' + encodeURIComponent(scene.name) +
    '&idx=' + encodeURIComponent(String(idx + 1)) +
    '&total=' + encodeURIComponent(String(total)));
  toastWin.webContents.on('did-finish-load', () => {
    toastWin.showInactive();
    pushWinToBottom(toastWin);
  });
  toastWin.on('closed', () => { toastWin = null; });
  toastTimer = setTimeout(() => {
    if (toastWin && !toastWin.isDestroyed()) toastWin.close();
    toastTimer = null;
  }, 1700);
}

/* ---------------- edge snapping ----------------
 * Two independent switches: snapCards (card<->card edges/centers) and
 * snapScreen (work-area edges/centers). For each axis independently, collect
 * the enabled candidate lines; if the closest is within SNAP_PX, glide to it.
 * Far apart -> untouched. Returns true when it moved the window. */
let snapping = false;          // re-entrancy guard: ignore moves we caused
let dragActive = null;         // card id currently dragged by the user
/* per-window silence: a commit on card A must only mute A's own move echo,
 * never the snap of a DIFFERENT card the user is moving at the same moment.
 * A single global ts let one card's commit suppress every card's edge snap
 * for 500ms - exposed by the snapping tests and a real multi-card hazard. */
const boundsLockUntil = new Map();   // win -> ts until which its echoes are ours
function boundsLockNow(win) { return (boundsLockUntil.get(win) || 0) > Date.now(); }
function lockBounds(win) { boundsLockUntil.set(win, Date.now() + 500); }
function snapEdges(id) {
  const c = cardWins.get(id);
  if (!c || c.win.isDestroyed()) return false;
  const live = c.win.getBounds();
  // authoritative rect: position from the live read, size from the card's
  // base (the live width/height may carry the 1px-per-setBounds growth)
  const b = { x: live.x, y: live.y, width: c.baseW, height: c.baseH };
  const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;

  const others = [];
  if (conf.snapCards !== false) {
    cardWins.forEach((o, oid) => {
      if (oid === id || o.win.isDestroyed() || !o.win.isVisible()) return;
      others.push(o.win.getBounds());
    });
  }

  /* candidate alignments, each [target, which of my edges lands there].
   * Card<->card pairs that would sit side-by-side or stacked snap with a
   * SNAP_GAP breathing room - flush-0 gaps made a row of cards read as one
   * ugly slab. Same-edge alignments (left<->left, top<->top: row/column
   * alignment) stay flush, and screen edges stay flush so a card can still
   * dock to the work-area border. */
  const axis = (get, cardCands, screenCands) => {
    const mine = { a: get(b, 'a'), b: get(b, 'b'), c: (get(b, 'a') + get(b, 'b')) / 2 };
    let best = null;
    const consider = (target, key) => {
      const d = target - mine[key];
      // NOTE: best===0 is falsy - must compare against null explicitly,
      // otherwise a perfect (0px) alignment gets overwritten by later candidates.
      if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    };
    others.forEach((o) => cardCands(o).forEach((p) => consider(p[0], p[1])));
    if (conf.snapScreen !== false) screenCands(wa).forEach((p) => consider(p[0], p[1]));
    if (best !== null && Math.abs(best) <= SNAP_PX) return best;
    return 0;
  };

  const xCard = (r) => [
    [r.x, 'a'], [r.x, 'c'],                                   // flush left / center
    [r.x + r.width, 'b'], [r.x + r.width, 'c'],                // flush right / center
    [r.x + r.width + SNAP_GAP, 'a'],                           // my left, SNAP_GAP right of their right
    [r.x - SNAP_GAP, 'b'],                                     // my right, SNAP_GAP left of their left
    [r.x + r.width / 2, 'c'],
  ];
  const yCard = (r) => [
    [r.y, 'a'], [r.y, 'c'],                                   // flush top / center
    [r.y + r.height, 'b'], [r.y + r.height, 'c'],              // flush bottom / center
    [r.y + r.height + SNAP_GAP, 'a'],                          // my top, SNAP_GAP below their bottom
    [r.y - SNAP_GAP, 'b'],                                     // my bottom, SNAP_GAP above their top
    [r.y + r.height / 2, 'c'],
  ];
  const xScreen = (r) => [[r.x, 'a'], [r.x + r.width, 'b'], [r.x + r.width / 2, 'c']];
  const yScreen = (r) => [[r.y, 'a'], [r.y + r.height, 'b'], [r.y + r.height / 2, 'c']];
  const dx = axis((r, k) => (k === 'a' ? r.x : k === 'b' ? r.x + r.width : r.x + r.width / 2), xCard, xScreen);
  const dy = axis((r, k) => (k === 'a' ? r.y : k === 'b' ? r.y + r.height : r.y + r.height / 2), yCard, yScreen);
  if (dx || dy) {
    // round: fractional offsets (e.g. screen midline at 1.5x DPI) make
    // setPosition throw and let Windows grow the window by ~1px.
    const nx = Math.round(b.x + dx), ny = Math.round(b.y + dy);
    // The container rules outrank magnetism: a snap that would push the card
    // out of the scene container or on top of a sibling is NOT applied (the
    // "cards must not overlap / must not leave the container" rules).
    const cl = clampRect(nx, ny, b.width, b.height);
    if (cl.x !== nx || cl.y !== ny) return false;
    if (rectHitsSibling(id, nx, ny, b.width, b.height)) return false;
    snapping = true;
    try { commitRect(c.win, nx, ny, b.width, b.height); } finally { snapping = false; }
    return true;
  }
  return false;
}

/* ---------------- app-card running status ---------------- */
let taskList = '';
let taskListAt = 0;
function refreshTaskList(cb) {
  exec('tasklist /fo csv /nh', (err, out) => {
    if (!err) { taskList = out; taskListAt = Date.now(); }
    if (cb) cb();
  });
}
function isRunning(target) {
  if (!target) return false;
  const name = path.basename(target).replace(/\.[^.]*$/, '') + '.exe';
  return taskList.toLowerCase().indexOf('"' + name.toLowerCase() + '"') >= 0;
}
setInterval(() => {
  /* SHELL_MODE draws every card inside shellWin: there is no app-card
   * BrowserWindow to notify. Spawning cmd.exe + tasklist.exe + conhost.exe
   * every 4s for an empty consumer list was pure process churn. */
  let hasAppWin = false;
  cardWins.forEach((c) => { if (c.cfg.kind === 'app' && !c.win.isDestroyed()) hasAppWin = true; });
  if (!hasAppWin) return;
  refreshTaskList(() => {
    cardWins.forEach((c, id) => {
      if (c.cfg.kind !== 'app' || c.win.isDestroyed()) return;
      c.win.webContents.send('app-status', { running: isRunning(c.cfg.target), target: c.cfg.target });
    });
  });
}, 15000);

function launchTarget(cfg) {
  if (!cfg.target) return { ok: false, err: 'no target' };
  try {
    // .bat/.cmd/.lnk/.url need a shell (shortcuts are resolved by the shell)
    const useShell = /\.(bat|cmd|lnk|url)$/i.test(cfg.target);
    const args = String(cfg.args || '').trim();
    spawn(cfg.target, args ? args.split(/\s+/) : [], {
      detached: true, stdio: 'ignore', shell: useShell, windowsHide: true,
    }).unref();
    log('launched', cfg.target);
    return { ok: true };
  } catch (e) {
    log('launch fail', cfg.target, e.message);
    return { ok: false, err: e.message };
  }
}

/* ---------------- tray ---------------- */
function trayIcon() {
  const cands = [path.join(APP_DIR, 'build', 'margux.ico'),
    'G:\\Desktop\\interest\\ai-agent-desktop\\build\\margux.ico'];
  for (const p of cands) {
    try { if (fs.existsSync(p)) { const img = require('electron').nativeImage.createFromPath(p); if (!img.isEmpty()) return img; } } catch (e) {}
  }
  try { return require('electron').nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='); } catch (e) { return null; }
}
function buildTray() {
  const icon = trayIcon();
  if (!tray) {
    tray = new Tray(icon || require('electron').nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='));
    tray.setToolTip('Pico RamOS · 桌面卡片系统');
    tray.on('double-click', openManager);
  } else if (icon) {
    try { tray.setImage(icon); } catch (e) {}
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '管理面板', click: openManager },
    { label: '首次设置向导…', click: openWizard },
    { label: '显示当前场景', click: showAll },
    { label: '隐藏全部卡片', click: hideAll },
    { type: 'separator' },
    { label: '重新排列当前场景（Ctrl+Alt+R）', click: () => { layoutScene(conf.activeScene, true); broadcastFocus(); } },
    { type: 'separator' },
    { label: '模式：桌面美化（固定最底层）', type: 'radio', checked: true, enabled: false },
    { label: (conf.clickThrough ? '✓ ' : '') + '点击穿透（不影响下方窗口）', click: setClickThrough },
    { label: (moveMode ? '✓ ' : '') + '拖动模式（Ctrl+Alt+D）', click: () => setMoveMode(!moveMode) },
    { label: (desktopMode === 'pico' ? '切到原生桌面' : '切回 Pico RamOS') + '（Win+Shift+D）', click: () => toggleDesktopMode('tray') },
    { label: (desktopShellHidden ? '✓ ' : '') + '隐藏原生任务栏与桌面图标', click: toggleDesktopShell },
    { type: 'separator' },
    { label: conf.autostart ? '开机自启：开' : '开机自启：关', click: toggleAutostart },
    { type: 'separator' },
    { label: '退出 Pico RamOS', click: () => app.quit() },
  ]));
}
let desktopShellTimer = null;

function runDesktopShell(action, done) {
  exec('powershell -NoProfile -ExecutionPolicy Bypass -File "' + DESKTOP_SHELL_PS1 + '" -Action ' + action,
    { windowsHide: true, timeout: 15000 },
    (err, stdout) => {
      if (err) { log('desktop-shell failed:', err.message); if (done) done(err); return; }
      if (done) done(null, stdout);
    });
}

function startDesktopShellWatch() {
  if (desktopShellTimer) return;
  /* With the v1.5 mod the lease does the work, so 10 s is plenty. With a
     stale v1.2 mod (which force-shows the tray every 2 s) tighten to 300 ms
     until the admin installer is run. Both paths are one stdin line, never
     a new powershell.exe. */
  const legacy = legacyModActive();
  /* v1.2 fights back every 2 s, so 1 s is enough to win the race. 300 ms
     kept a broken helper in a permanent respawn loop (each spawn used to
     compile C#). The normal path is 2 s too now: explorer can re-assert its
     appbar at any time, and a 10 s watchdog left the 48 px dead band and a
     live native taskbar visible for most of that window. hide-shell is one
     stdin line and early-outs when nothing changed, so the extra ticks cost
     essentially nothing. */
  const intervalMs = legacy ? 1000 : 2000;
  desktopShellTimer = setInterval(() => {
    if (!desktopShellHidden || desktopMode !== 'pico') return;
    taskbarFire('hide-shell');
  }, intervalMs);
}

function stopDesktopShellWatch() {
  if (!desktopShellTimer) return;
  clearInterval(desktopShellTimer);
  desktopShellTimer = null;
}

function toggleDesktopShell() {
  desktopShellHidden = !desktopShellHidden;
  const action = desktopShellHidden ? 'hide' : 'show';
  setShellTakeover(desktopShellHidden);
  runDesktopShell(action, () => {
    log('desktop-shell ->', action);
    if (desktopShellHidden) startDesktopShellWatch();
    else stopDesktopShellWatch();
    buildTray();
  });
}
function setMode(m) {
  conf.mode = 'desktop';
  saveConf();
  applyMode();
}
function setClickThrough() {
  conf.clickThrough = !conf.clickThrough;
  saveConf();
  applyAllClickThrough();
  buildTray();
  log('clickThrough ->', conf.clickThrough);
}
/* Generates the hidden Startup launcher. Resolves the electron binary at
 * login time (local node_modules first, dev-machine fallback second) and
 * starts the app with its own directory - never a bare electron.exe. */
function autostartVbsContent() {
  const q = (s) => '"' + String(s).replace(/\\/g, '\\\\') + '"';
  const local = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
  const fallback = 'F:\\job\\ai-agent-desktop\\node_modules\\electron\\dist\\electron.exe';
  const lines = [
    "' Pico RamOS autostart launcher (generated by the app; delete this file to disable).",
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    'Set ws = CreateObject("WScript.Shell")',
    'appDir = ' + q(APP_DIR),
    'elec = ""',
    'If fso.FileExists(' + q(local) + ') Then elec = ' + q(local),
  ];
  if (fs.existsSync(fallback)) {
    lines.push('If elec = "" And fso.FileExists(' + q(fallback) + ') Then elec = ' + q(fallback));
  }
  /* The Startup VBS bypasses start.bat, whose only critical job was clearing
     ELECTRON_RUN_AS_NODE. Without this, a globally-leaked dev env var makes
     every login start a headless Node process instead of Pico. */
  lines.push('On Error Resume Next');
  lines.push('Set envP = ws.Environment("PROCESS")');
  lines.push('envP.Remove("ELECTRON_RUN_AS_NODE")');
  lines.push('On Error GoTo 0');
  lines.push('If elec <> "" Then ws.Run elec & " " & appDir, 0, False');
  return lines.join('\r\n') + '\r\n';
}

/* The autostart switch: ON writes the Startup vbs (and clears any stale
 * login-item entry), OFF removes it. Default state is OFF everywhere. */
function setAutostart(on) {
  conf.autostart = !!on;
  saveConf();
  try { app.setLoginItemSettings({ openAtLogin: false }); } catch (e) {}   // legacy path unused
  if (process.platform === 'win32') {
    try {
      if (conf.autostart) {
        fs.mkdirSync(STARTUP_DIR, { recursive: true });
        fs.writeFileSync(AUTOSTART_VBS, autostartVbsContent(), 'utf8');
        log('autostart ON ->', AUTOSTART_VBS);
      } else if (fs.existsSync(AUTOSTART_VBS)) {
        fs.unlinkSync(AUTOSTART_VBS);
        log('autostart OFF -> removed', AUTOSTART_VBS);
      }
    } catch (e) { log('autostart vbs fail', e.message); }
  }
  buildTray();
  return conf.autostart;
}
function toggleAutostart() { return setAutostart(!conf.autostart); }

/* ---------------- manager window ---------------- */
/* ---------------- first-run setup wizard ---------------- */
let wizardWin = null;
function wizardLibrary() {
  // starter templates WITHOUT ids: the wizard assigns ids to the chosen ones
  return seedCards().map((c) => { const o = Object.assign({}, c); delete o.id; return o; });
}
function openWizard() {
  if (wizardWin && !wizardWin.isDestroyed()) { wizardWin.focus(); return; }
  wizardWin = new BrowserWindow({
    width: 580, height: 660,
    frame: false, transparent: true, backgroundColor: '#00000000',
    hasShadow: false, resizable: false, fullscreenable: false, skipTaskbar: true,
    webPreferences: baseWebPrefs(path.join(APP_DIR, 'preload.js')),
  });
  wizardWin.loadFile(path.join(APP_DIR, 'wizard', 'wizard.html'));
  wizardWin.on('closed', () => { wizardWin = null; });
}
function closeWizard() { if (wizardWin && !wizardWin.isDestroyed()) wizardWin.close(); }
ipcMain.on('wizard-move-by', (_e, dx, dy) => {
  if (wizardWin && !wizardWin.isDestroyed()) {
    const b = wizardWin.getBounds();
    // same transparent-window ratchet guard as the cards: the wizard is
    // created 580x660 and never resizes, so that IS its authority
    moveWindow(wizardWin, b.x + (dx | 0), b.y + (dy | 0), 580, 660);
  }
});
ipcMain.handle('open-wizard', () => { openWizard(); return true; });
ipcMain.handle('wizard-state', () => ({
  onboarded: conf.onboarded,
  settings: {
    autostart: conf.autostart,
    mode: conf.mode,
    clickThrough: conf.clickThrough,
    snapCards: conf.snapCards !== false,
    snapScreen: conf.snapScreen !== false,
    defaultOpacity: conf.defaultOpacity,
    defaultColor: conf.defaultColor,
    followSystemColor: conf.followSystemColor,
  },
  mail: conf.mail,
  agentKey: conf.agentKey,
  library: wizardLibrary(),
}));
ipcMain.handle('wizard-pick', async () => {
  const r = await dialog.showOpenDialog({
    title: '选择程序或快捷方式', properties: ['openFile'],
    filters: [
      { name: '程序/快捷方式', extensions: ['exe', 'bat', 'cmd', 'lnk', 'url'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('wizard-done', (_e, payload) => {
  const p = payload || {};
  const s = p.settings || {};
  conf.autostart = !!s.autostart;
  conf.mode = 'desktop';
  conf.clickThrough = !!s.clickThrough;
  conf.snapCards = s.snapCards !== false;
  conf.snapScreen = s.snapScreen !== false;
  conf.defaultOpacity = Math.min(1, Math.max(0.15, Number(s.defaultOpacity) || 0.92));
  conf.defaultColor = (typeof s.defaultColor === 'string' && /^#[0-9a-f]{6}$/i.test(s.defaultColor)) ? s.defaultColor : '#16161c';
  conf.followSystemColor = !!s.followSystemColor;
  const chosen = Array.isArray(p.cards) ? p.cards : [];
  const base = {
    opacity: conf.defaultOpacity, color: conf.defaultColor,
    topMost: conf.mode !== 'desktop', args: '', factor: 1, clickThrough: null,
  };
  const norm = (c, i) => Object.assign({
    id: uid(), w: 300, h: 220,
    // no x/y: createCard packs the card into the current page's Tetris
    // mosaic (right-anchored, focus big / sides own-size) instead of the
    // old 36px cascade / grid / one-row strip packs (superseded by the Tetris mosaic)
    scene: conf.activeScene,          // new cards land on the current page
  }, base, c);
  if (p.reset !== false) {
    cardWins.forEach((c, id) => closeCard(id));    // close existing cards first
    conf.cards = chosen.map(norm);                    // first run: exactly what was picked
  } else {
    // re-run from the manager: ADD the picks, keep the user's existing cards
    chosen.forEach((c) => {
      const dup = conf.cards.some((k) => k.kind === c.kind && k.target === c.target && k.kind !== 'folder');
      if (!dup) conf.cards.push(norm(c, conf.cards.length));
    });
  }
  conf.onboarded = true;
  conf.cards.forEach((cfg) => { if (!Number.isFinite(Number(cfg.x))) delete cfg.x; if (!Number.isFinite(Number(cfg.y))) delete cfg.y; });
  // mail aggregation: store IMAP accounts (email + app-password / auth-code)
  // and the agent API key entered in the unified setup. Stored locally only.
  conf.mail = Array.isArray(p.mail) ? p.mail.map((a) => ({
    provider: a.provider || 'custom', label: a.label || '', host: a.host || '',
    port: Number(a.port) || 993, secure: a.secure !== false,
    user: a.user || '', password: a.password || '',
  })) : [];
  conf.agentKey = typeof p.agentKey === 'string' ? p.agentKey : '';
  saveConf();
  setAutostart(conf.autostart);                       // write/remove the Startup vbs
  if (conf.followSystemColor) broadcastTheme();        // apply the OS tone to new cards
  conf.cards.forEach((cfg) => createCard(cfg));
  layoutAllScenes(false);          // every page's mosaic committed (window sizes = display sizes)
  if (conf.mode === 'desktop') applyMode();
  buildTray();
  refreshDock();
  refreshTaskList(() => {});
  closeWizard();
  log('wizard done ->', conf.cards.length, 'cards; reset=' + (p.reset !== false));
  return { ok: true };
});

function openManager() {
  if (managerWin && !managerWin.isDestroyed()) { managerWin.show(); managerWin.focus(); return; }
  managerWin = new BrowserWindow({
    width: 600, height: 720, show: false,
    frame: false, transparent: false, backgroundColor: '#14141a',
    resizable: false, skipTaskbar: false,
    webPreferences: baseWebPrefs(path.join(APP_DIR, 'preload.js')),
  });
  managerWin.loadFile(path.join(APP_DIR, 'manager', 'manager.html'));
  managerWin.on('closed', () => { managerWin = null; });
}

/* ---------------- IPC ---------------- */
function winToId(sender) {
  for (const [id, c] of cardWins) {
    if (!c.win.isDestroyed() && c.win.webContents === sender) return id;
  }
  return null;
}
function cardById(id) {
  const c = cardWins.get(id);
  return c && !c.win.isDestroyed() ? c : null;
}

/* ---------------- system color following ----------------
 * When conf.followSystemColor is on, every card's surface color is derived
 * from the OS light/dark state instead of the per-card palette: dark keeps
 * the default #16161c, light switches to a warm paper tone. The Windows
 * ACCENT color rides along in the same broadcast (focus ring, dock highlight,
 * accents inside cards) and is polled on a slow interval - the
 * 'accent-color-changed' event does not fire on every path (e.g. picking a
 * color in Settings while no electron window has focus), so both are used.
 * The broadcast only reaches card windows + the dock - webview / app-
 * screenshot content cannot be re-skinned. */
const THEME_DARK_COLOR = '#16161c';
const THEME_LIGHT_COLOR = '#f4f1ea';
function systemIsDark() {
  try { return nativeTheme.shouldUseDarkColors; } catch (e) { return true; }
}
function themeColorFor(dark) { return dark ? THEME_DARK_COLOR : THEME_LIGHT_COLOR; }
/* Windows publishes the live accent as an ABGR DWORD (0xAABBGGRR). Electron
 * exposes it through systemPreferences (DWM colorization color - the value
 * that is actually on screen, which can differ from the registry key). */
function systemAccent() {
  try {
    const raw = systemPreferences.getAccentColor();
    const h = String(raw || '').replace('#', '').toLowerCase();
    if (/^[0-9a-f]{8}$/.test(h)) return '#' + h.slice(6, 8) + h.slice(4, 6) + h.slice(2, 4);
    if (/^[0-9a-f]{6}$/.test(h)) return '#' + h;
  } catch (e) {}
  return '';
}
let lastAccent = '';
function broadcastTheme() {
  if (!conf.followSystemColor) return;
  const dark = systemIsDark();
  const accent = systemAccent() || lastAccent;
  if (accent) lastAccent = accent;
  const payload = { dark: dark, color: themeColorFor(dark), accent: accent, following: true };
  cardWins.forEach((c) => {
    if (!c.win.isDestroyed()) c.win.webContents.send('system-theme', payload);
  });
  if (dockWin && !dockWin.isDestroyed()) {
    try { dockWin.webContents.send('system-theme', payload); } catch (e) {}
  }
  /* the shell derives every glass/text token from the wallpaper sample plus
     the live accent, so an OS theme or accent change re-tints it in place */
  if (shellWin && !shellWin.isDestroyed()) {
    try {
      shellWin.webContents.send('os-palette',
        Object.assign({}, wallpaperPalette || {}, { accent: accent, systemDark: dark }));
    } catch (e) {}
  }
  sendSkinPalette();
  log('system theme ->', payload.dark ? 'dark' : 'light', payload.color,
    'accent', accent || '(none)', '(' + cardWins.size + ' cards)');
}
nativeTheme.on('updated', () => broadcastTheme());
try { systemPreferences.on('accent-color-changed', () => broadcastTheme()); } catch (e) {}
setInterval(() => {                       // belt & braces: Settings changes
  if (!conf.followSystemColor) return;    // the event does not always fire
  const a = systemAccent();
  if (a && a !== lastAccent) broadcastTheme();
}, 6000);

ipcMain.handle('card-get-state', (e) => {
  const id = winToId(e.sender);
  const c = cardById(id);
  return c ? Object.assign({}, c.cfg, {
    running: c.cfg.kind === 'app' ? isRunning(c.cfg.target) : null,
    mode: conf.mode, clickThrough: conf.clickThrough,
    effClickThrough: effectiveClickThrough(c.cfg),
    hints: conf.hints,
    followSystemColor: conf.followSystemColor,
    systemDark: systemIsDark(),
    systemColor: themeColorFor(systemIsDark()),
    systemAccent: lastAccent,
    activeCard: conf.activeCard,
    isFocused: id === conf.activeCard,
  }) : null;
});
ipcMain.handle('set-follow-system-color', (_e, on) => {
  conf.followSystemColor = !!on;
  saveConf();
  // push the new state to every open card so the switch takes effect at once:
  // on -> re-skin to the OS tone; off -> fall back to each card's palette color
  const accent = systemAccent();
  if (accent) lastAccent = accent;
  const payload = { dark: systemIsDark(), color: themeColorFor(systemIsDark()), accent: accent, following: conf.followSystemColor };
  cardWins.forEach((c) => {
    if (!c.win.isDestroyed()) c.win.webContents.send('system-theme', payload);
  });
  if (dockWin && !dockWin.isDestroyed()) {
    try { dockWin.webContents.send('system-theme', payload); } catch (e) {}
  }
  sendSkinPalette();
  return conf.followSystemColor;
});
ipcMain.handle('follow-system-get', () => conf.followSystemColor);
ipcMain.handle('follow-system-accent', () => systemAccent() || lastAccent);
/* mosaic focus: wheel / arrows / clicking a side card re-packs the mosaic */
ipcMain.on('card-focus-next', (e, dir) => { focusStep(dir > 0 ? 1 : -1); });
ipcMain.on('card-focus-set', (e, id) => { if (typeof id === 'string') setFocusCard(id); });
ipcMain.on('card-drag-start', (e) => {
  const id = winToId(e.sender);
  dragActive = id;
  const c = cardById(id);
  if (c) {
    cancelAnim(id);                     // the pointer owns this card now
    // widget mode: a bottomed-out non-focusable card cannot be dragged at all.
    // Lift it (focusable + top) for the drag; drag-end puts it back down.
    if (conf.mode === 'desktop') {
      try { c.win.setFocusable(true); } catch (err) {}
      c.win.setAlwaysOnTop(true, 'screen-saver');
      zOrder(id, 'top');
    }
  }
});
ipcMain.on('card-drag-end', (e) => {
  const id = winToId(e.sender);
  if (dragActive === id) dragActive = null;
  const c = cardById(id);
  if (!c) return;
  // drop = STAY where it was dropped. Free placement: the window is never
  // sprung back into a pack slot (that snap was the "card teleports home /
  // sticks to the top-right corner" bug). The two container rules are then
  // applied: inside the scene container, not overlapping a sibling.
  enforceCardBounds(id);
  if (conf.mode === 'desktop') {                    // back to the widget pile
    try { c.win.setFocusable(false); } catch (err) {}
    c.win.setAlwaysOnTop(false);
    zOrder(id, 'bottom');
    setTimeout(() => { if (!c.win.isDestroyed()) zOrder(id, 'bottom'); }, 400);
  }
});
ipcMain.on('card-move-by', (e, dx, dy) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) return;
  const b = c.win.getBounds();
  cancelAnim(id);
  // 1:1 with the pointer, clamped so the card can never be dragged out of
  // the scene container. Nothing else moves.
  // The size is the card's AUTHORITATIVE base - pinning the live read is
  // what ratcheted the card bigger on every drag (transparent-window
  // +1px-per-setBounds growth at fractional DPI).
  const cl = clampRect(b.x + (dx | 0), b.y + (dy | 0), c.baseW, c.baseH);
  moveWindow(c.win, cl.x, cl.y, c.baseW, c.baseH);
});
/* synchronous bounds read: the 8-way resize gesture needs the window rect at
   pointerdown without awaiting a promise (a drag cannot suspend) */
ipcMain.on('card-bounds', (e) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) { e.returnValue = null; return; }
  // the authoritative rect: a resize gesture snapshots THIS, so its math
  // starts from the clean size - the live read carries the 1px growth
  const b = c.win.getBounds();
  e.returnValue = { x: b.x, y: b.y, width: c.baseW, height: c.baseH };
});
ipcMain.on('card-resize-by', (e, dw, dh) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) return;
  const [w, h] = c.win.getSize();
  const nw = Math.max(MIN_W, w + (dw | 0)), nh = Math.max(MIN_H, h + (dh | 0));
  c.win.setSize(nw, nh);
  c.baseW = nw; c.baseH = nh;            // the user's gesture is the new authority
});
/* 8-way resize: the renderer computes absolute bounds per direction (the edge
   opposite the drag stays anchored), so a diagonal drag can never grow the
   window "in a random direction" the way the old relative dw/dh did. */
ipcMain.on('card-resize-to', (e, b) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c || !b) return;
  const w = Math.max(MIN_W, Math.round(Number(b.width) || 0));
  const h = Math.max(MIN_H, Math.round(Number(b.height) || 0));
  // clamp ONLY while the gesture runs: pushing the card out of an overlap
  // MID-resize would make the window convulse under the pointer. The full
  // rules (no overlap + persist) run at gesture end (card-save).
  const cl = clampRect(Math.round(Number(b.x) || 0), Math.round(Number(b.y) || 0), w, h);
  commitRect(c.win, cl.x, cl.y, w, h);
  c.baseW = w; c.baseH = h;            // the user's gesture is the new authority
  lockBounds(c.win);          // the clamp echoes are ours, never snap
});
ipcMain.handle('scene-layout', () => {
  layoutScene(conf.activeScene, true);      // spring the mosaic back into shape
  broadcastFocus();
  return true;
});
ipcMain.handle('card-save', (e, patch) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) return null;
  const b = c.win.getBounds();
  // persist the AUTHORITATIVE size, not the live read: the live width can
  // carry the 1px-per-setBounds growth, and saving it is how a dragged card
  // came back 992x946 after booting at 206x204
  c.cfg.x = b.x; c.cfg.y = b.y; c.cfg.w = c.baseW; c.cfg.h = c.baseH;
  if (patch) Object.assign(c.cfg, patch);
  const inConf = conf.cards.find((k) => k.id === id);
  if (inConf) Object.assign(inConf, c.cfg); else conf.cards.push(c.cfg);
  enforceCardBounds(id);          // same container rules as a drag/resize
  return Object.assign({}, c.cfg);
});
ipcMain.handle('card-opacity', (e, o) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) return;
  c.cfg.opacity = Math.min(1, Math.max(0.15, Number(o)));
  c.win.setOpacity(c.cfg.opacity);
  saveConf();
});
ipcMain.handle('card-color', (e, color) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) return;
  c.cfg.color = color;
  saveConf();
});
ipcMain.handle('card-topmost', (e, on) => {
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) return;
  c.cfg.topMost = !!on;
  c.win.setAlwaysOnTop(false); zOrder(id, 'bottom');
  saveConf();
});
ipcMain.handle('card-clickthrough', (e, v) => {
  // per-card override: true = force pass-through, false = force interactive, null = follow global
  const id = winToId(e.sender); const c = cardById(id);
  if (!c) return null;
  c.cfg.clickThrough = v === true ? true : v === false ? false : null;
  const inConf = conf.cards.find((k) => k.id === id);
  if (inConf) inConf.clickThrough = c.cfg.clickThrough;
  saveConf();
  applyClickThrough(id);
  return effectiveClickThrough(c.cfg);
});
ipcMain.handle('card-close', (e) => {
  const id = winToId(e.sender); if (id) closeCard(id);
});
ipcMain.handle('card-launch', (e) => {
  const id = winToId(e.sender); const c = cardById(id);
  return c ? launchTarget(c.cfg) : { ok: false, err: 'no card' };
});
ipcMain.handle('launch-app', (_e, target) => {
  if (typeof target !== 'string' || !target) return { ok: false, err: 'no target' };
  const useShell = /\.(bat|cmd|lnk|url)$/i.test(target);
  try {
    spawn(target, [], { detached: true, stdio: 'ignore', shell: useShell, windowsHide: true }).unref();
    return { ok: true };
  } catch (e2) { return { ok: false, err: e2.message }; }
});
ipcMain.handle('card-open-manager', () => openManager());
ipcMain.handle('card-open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

/* ---------- global switches ---------- */
ipcMain.handle('mode-get', () => conf.mode);
ipcMain.handle('mode-set', (_e, m) => {
  conf.mode = 'desktop'; saveConf(); applyMode();
  return conf.mode;
});
ipcMain.handle('clickthrough-get', () => conf.clickThrough);
ipcMain.handle('clickthrough-set', (_e, on) => {
  conf.clickThrough = !!on; saveConf(); applyAllClickThrough(); buildTray();
  return conf.clickThrough;
});
ipcMain.handle('snap-get', () => ({ cards: conf.snapCards !== false, screen: conf.snapScreen !== false }));
ipcMain.handle('snap-set', (_e, v) => {
  if (v && typeof v.cards === 'boolean') conf.snapCards = v.cards;
  if (v && typeof v.screen === 'boolean') conf.snapScreen = v.screen;
  saveConf();
  return { cards: conf.snapCards, screen: conf.snapScreen };
});

/* ---------- mail aggregation (IMAP) ----------
 * Pulls recent messages from the user's configured IMAP accounts. The node-imap
 * dependency is required lazily so app startup and the test harness stay free
 * of it until a fetch actually runs. */
let _mailMod = null;
function mailMod() { if (!_mailMod) _mailMod = require('./mail'); return _mailMod; }
ipcMain.handle('mail-fetch', async (_e, limit) => {
  try {
    const r = await mailMod().fetchAll(conf.mail, limit || 12);
    // surface per-account failures in the log: the card only shows a red dot,
    // and an auth problem (wrong IMAP auth code, IMAP not enabled) is invisible
    // without the server's own error text
    r.forEach((x) => { if (x && x.error) log('imap fail:', x.account || '(unknown)', x.error); });
    return r;
  }
  catch (e) { return [{ account: '(错误)', error: String((e && e.message) || e) }]; }
});
ipcMain.handle('mail-accounts', () => (conf.mail || []).map((a) => Object.assign({}, a)));

/* ---------------------------------------------------------------------------
 * Bilibili feed: pulls the public popular / ranking list (no login, no WBI
 * signing needed) and returns a normalized list the bili card renders as
 * cover + title + UP + stats. Cover URLs arrive protocol-relative
 * (//i0.hdslb.com/...); we prefix https: so the renderer can load them.
 * ------------------------------------------------------------------------- */
function biliGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bilibili.com',
        'Accept': 'application/json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = /^https?:/.test(res.headers.location)
          ? res.headers.location
          : ('https://api.bilibili.com' + res.headers.location);
        biliGetJson(next, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { raw += d; });
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 10000, () => { try { req.destroy(new Error('timeout')); } catch (e) {} });
  });
}

function biliFmtCount(n) {
  n = Number(n) || 0;
  if (n >= 1e8) return (n / 1e8).toFixed(1) + '亿';
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万';
  return String(n);
}
function biliFmtDur(sec) {
  sec = Number(sec) || 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}
function biliFmtAgo(unixSec) {
  if (!unixSec) return '';
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  const d = new Date(unixSec * 1000);
  return (d.getMonth() + 1) + '-' + d.getDate();
}
function biliNormalize(list) {
  return (list || []).map((v) => ({
    bvid: v.bvid,
    title: v.title || '(无标题)',
    desc: v.desc || '',
    cover: v.pic ? ('https:' + v.pic.replace(/^https?:/, '')) : '',
    author: (v.owner && v.owner.name) ? v.owner.name : '—',
    view: biliFmtCount(v.stat && v.stat.view),
    danmaku: biliFmtCount(v.stat && v.stat.danmaku),
    duration: biliFmtDur(v.duration),
    pub: biliFmtAgo(v.pubdate),
    url: v.bvid ? ('https://www.bilibili.com/video/' + v.bvid) : '',
  }));
}

/* The renderer must never show a bare "timeout": try both endpoints, then
 * fall back to the last good result on disk. Bili's API is a plain GET and
 * occasionally stalls inside Electron's network stack even when curl is fine. */
const BILI_CACHE_FILE = path.join(APP_DIR, 'bili-cache.json');
let biliCache = null;
try {
  const saved = JSON.parse(fs.readFileSync(BILI_CACHE_FILE, 'utf8'));
  if (saved && Array.isArray(saved.items) && saved.items.length) biliCache = saved;
} catch (e) { /* first run */ }

ipcMain.handle('bili-fetch', async (_e, opts) => {
  const mode = (opts && opts.mode) || 'hot';
  const popular = 'https://api.bilibili.com/x/web-interface/popular?ps=12&pn=1';
  const ranking = 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all';
  const urls = mode === 'ranking' ? [ranking, popular] : [popular, ranking];
  let lastErr = '';
  for (const url of urls) {
    try {
      const data = await biliGetJson(url, 6000);
      if (data && data.code === 0) {
        const items = biliNormalize(data.data && data.data.list);
        if (items.length) {
          biliCache = { at: Date.now(), mode: mode, items: items };
          try { fs.writeFileSync(BILI_CACHE_FILE, JSON.stringify(biliCache), 'utf8'); } catch (e) {}
          return { ok: true, mode: mode, items: items };
        }
      }
      lastErr = 'code ' + (data && data.code);
    } catch (e) { lastErr = String((e && e.message) || e); }
  }
  if (biliCache) return { ok: true, mode: biliCache.mode, items: biliCache.items, cached: true };
  return { ok: false, error: 'B站暂时连不上（' + (lastErr || 'unknown') + '），点刷新重试' };
});

/* SMTP send. The renderer never sees the auth code: it names the account by
   index and main looks up the credentials it already holds. */
ipcMain.handle('mail-send', async (_e, payload) => {
  try {
    const list = conf.mail || [];
    const acc = list[Number(payload && payload.account)];
    if (!acc) return { ok: false, error: '没有这个邮箱账号，请先在设置里添加' };
    const to = String((payload && payload.to) || '').trim();
    if (!to || to.indexOf('@') < 0) return { ok: false, error: '收件人地址不合法' };
    const r = await mailMod().sendMail(acc, {
      to: to,
      cc: payload.cc, bcc: payload.bcc,
      subject: payload.subject, text: payload.text, html: payload.html,
    });
    log('mail sent ->', to, r.messageId || '');
    return r;
  } catch (e) {
    const msg = String((e && e.message) || e);
    log('mail send fail:', msg);
    return { ok: false, error: msg };
  }
});

/* one-time UI hints: the card shell asks which hints are still unseen and
   reports back once one has been shown, so guidance never nags twice */
ipcMain.handle('hint-seen', (_e, key) => {
  if (key === 'cardOps') { conf.hints.cardOps = true; saveConf(); return true; }
  return false;
});

/* manager + card registry IPC */
ipcMain.handle('cards-list', () => conf.cards.map((c) => Object.assign({}, c)));
ipcMain.handle('cards-open', (_e, id) => {
  const cfg = conf.cards.find((c) => c.id === id);
  if (!cfg) return;
  // opening a card from another scene jumps to that scene first, so the
  // "only the active page is visible" invariant always holds
  if (cfg.scene && cfg.scene !== conf.activeScene) switchScene(cfg.scene);
  createCard(cfg);
});
ipcMain.handle('cards-hide', (_e, id) => hideCard(id));
ipcMain.handle('cards-delete', (_e, id) => {
  closeCard(id);
  conf.cards = conf.cards.filter((c) => c.id !== id);
  saveConf();
  refreshDock();
});
ipcMain.handle('cards-update', (_e, id, patch) => {
  const cfg = conf.cards.find((c) => c.id === id);
  if (!cfg) return null;
  Object.assign(cfg, patch);
  const c = cardWins.get(id);
  if (c && !c.win.isDestroyed()) {
    c.cfg = Object.assign(c.cfg, patch);
    c.win.setBounds({ x: cfg.x, y: cfg.y, width: cfg.w, height: cfg.h });
    c.baseW = cfg.w; c.baseH = cfg.h;    // manager edit = new authority
    c.win.setOpacity(Math.min(1, Math.max(0.15, Number(cfg.opacity) || 0.92)));
    c.win.setAlwaysOnTop(false);
    c.win.setFocusable(false);
    zOrder(id, 'bottom');
    applyClickThrough(id);
    // kind / target changes need a fresh page
    if (patch.kind || patch.target) c.win.webContents.reload();
  }
  saveConf();
  return Object.assign({}, cfg);
});
ipcMain.handle('cards-add', (_e, card) => {
  const cfg = Object.assign({
    id: uid(), w: 300, h: 220, opacity: 0.92, color: '#16161c',
    topMost: true, args: '', factor: 1, clickThrough: null,
    // no x/y on purpose: createCard packs the new card into the free space
    // of the current page (Russian-block layout) instead of piling at 140,140
    scene: conf.activeScene,          // manager-added cards join the current page
  }, card || {});
  conf.cards.push(cfg);
  saveConf();
  refreshDock();
  createCard(cfg);
  return cfg;
});
ipcMain.handle('cards-show-scene', () => showAll());       // current page only
ipcMain.handle('cards-hide-all', () => hideAll());         // every page

/* scene (workspace page) IPC - consumed by the right-edge dock + manager */
/* the bottom horizontal scene strip speaks in shell pages */
ipcMain.handle('page-list', () => pageDockState());
ipcMain.handle('page-go', (_e, id) => pageGo(id));
ipcMain.handle('page-add', (_e, name) => pageAdd(name));
ipcMain.handle('scene-list', () => dockState());
ipcMain.handle('scene-switch', (_e, id) => switchScene(id));
ipcMain.handle('scene-add', (_e, name) => {
  const s = addScene(name);
  switchScene(s.id);                 // creating a page lands you on it
  return dockState();
});
ipcMain.handle('scene-rename', (_e, id, name) => renameScene(id, name));
ipcMain.handle('scene-delete', (_e, id) => deleteScene(id));
ipcMain.handle('scene-move-card', (_e, cardId, sceneId) => moveCardScene(cardId, sceneId));
ipcMain.handle('scene-reorder-card', (_e, cardId, dir) => reorderCardInScene(cardId, dir));
ipcMain.handle('pick-file', async () => {
  const r = await dialog.showOpenDialog({
    title: '选择程序或快捷方式', filters: [
      { name: '程序/快捷方式', extensions: ['exe', 'bat', 'cmd', 'lnk', 'url'] },
      { name: '所有文件', extensions: ['*'] },
    ], properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('autostart-get', () => conf.autostart);
ipcMain.handle('autostart-set', (_e, on) => setAutostart(!!on));
ipcMain.handle('manager-close', () => { if (managerWin) managerWin.close(); });
ipcMain.handle('quit', () => app.quit());

/* ---------------- boot ---------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  /* Put Windows back BEFORE the process dies. will-quit used to fire an async
     exec that was killed together with the main process, so the native
     taskbar sometimes stayed hidden and the work area stayed full-height.
     before-quit can hold the quit open; wait for the restore with a 3s cap. */
  app.on('before-quit', (e) => {
    if (quitting) return;               // second pass from our own app.quit()
    quitting = true;
    e.preventDefault();
    stopStartMenuGuard();
    setShellTakeover(false);
    stopDesktopShellWatch();
    desktopMode = 'native';
    let settled = false;
    /* A hidden BrowserWindow can swallow app.quit(): no window ever reaches
       "closed", so all Electron processes stay alive with the taskbar already
       restored. The user sees a normal desktop and thinks PROS is off, while
       the GPU keeps burning. If will-quit never fires, force an exit once the
       restore has had time to land. */
    quitHardExit = setTimeout(() => {
      log('quit hard-exit fallback');
      try { if (taskbarProc && !taskbarProc.killed) taskbarProc.kill(); } catch (e) {}
      app.exit(0);
    }, 1500);
    const finish = () => {
      if (settled) return;
      settled = true;
      log('desktop-shell -> restored on quit');
      app.quit();
    };
    /* Prefer the resident Win32 host (one stdin line, zero process creation),
       but a dead host resolves to null rather than rejecting: in that case the
       one-shot script MUST still run or the taskbar stays hidden. A 600ms cap
       is enough once the flag has been deleted; the old 3s hold was pure lag. */
    const oneShotRestore = () => new Promise((res) => {
      try { runDesktopShell('show', res); } catch (e) { res(); }
    });
    try {
      Promise.resolve()
        .then(() => taskbarCmd('show-shell'))
        .then((r) => (r === null ? oneShotRestore() : undefined))
        .catch(oneShotRestore)
        .then(finish)
        .catch(finish);
    } catch (err) {
      oneShotRestore().then(finish).catch(finish);
    }
    setTimeout(finish, 600);
  });
  app.on('will-quit', () => {
    /* Normal quit arrived: cancel the last-resort exit. An already-exiting
       process never gets here, so the fallback only fires when quit hung. */
    if (quitHardExit) { clearTimeout(quitHardExit); quitHardExit = null; }
    stopStartMenuGuard();
    try { if (taskbarProc && !taskbarProc.killed) taskbarProc.kill(); } catch (e) {}
    if (skinWin && !skinWin.isDestroyed()) {
      try { skinWin.close(); } catch (e) {}
    }
    /* belt and braces: synchronous flag delete, no async script here (it
       would race the before-quit restore and be killed mid-flight) */
    try { setShellTakeover(false); } catch (e) {}
    stopDesktopShellWatch();
    desktopMode = 'native';
  });

app.whenReady().then(() => {
    /* A flag left by a hard-killed previous instance makes Windhawk hide the
       taskbar at login BEFORE our shell is on screen. Clear a stale lease at
       boot; reveal() re-arms it only once the window is actually visible. */
    try {
      if (fs.existsSync(SHELL_FLAG)) {
        const age = Date.now() - fs.statSync(SHELL_FLAG).mtimeMs;
        if (age > FLAG_TOUCH_MS * 3) {
          fs.unlinkSync(SHELL_FLAG);
          log('stale takeover flag cleared at boot, age=' + age + 'ms');
        }
      }
    } catch (e) { log('stale flag clear fail', e.message); }
    /* The glass dock lists real running windows. Warm the Win32 helper now so
       Add-Type compiles while the shell page loads and icons appear at once. */
    try { ensureTaskbarHost(); } catch (e) {}
    // autostart is a switch, default OFF: clear stale login items, and
    // self-heal the Startup vbs if it was enabled but the file went missing
    try { app.setLoginItemSettings({ openAtLogin: false }); } catch (e) {}
    if (conf.autostart && process.platform === 'win32' && !fs.existsSync(AUTOSTART_VBS)) {
      try {
        fs.mkdirSync(STARTUP_DIR, { recursive: true });
        fs.writeFileSync(AUTOSTART_VBS, autostartVbsContent(), 'utf8');
        log('autostart self-heal -> vbs rewritten');
      } catch (e) { log('autostart self-heal fail', e.message); }
    }
    if (conf.onboarded) {
      /* pull the desktop's .lnk shortcuts in as launcher cards before the
         grid is rebuilt, so a fresh desktop icon just shows up next start */
      if (conf.importDesktopShortcuts !== false) {
        // async now (it pulls real shell icons); layout must wait for it
        syncDesktopShortcuts().then(() => {
          rebuildLayoutFromCards();
          pushShellState();
        });
      }
      conf.cards.forEach((cfg) => createCard(cfg));
      if (SHELL_MODE) {
        /* snapshot the live desktop first so the shell can show the user's
         * real wallpaper (static or Wallpaper Engine's) as its backdrop.
         * openOnce is idempotent and has a hard 3s guard: no capture path,
         * not even a permanently pending getSources(), may block the shell. */
        let opened = false;
        const openOnce = () => {
          if (opened) return;
          opened = true;
          try { openShell(); } catch (e) { log('openShell fail', e.message); }
        };
        const bootGuard = setTimeout(() => { log('shell boot guard fired'); openOnce(); }, 3000);
        captureDesktop().then(() => {
          wallpaperPalette = paletteFromWallpaper();
          log('palette ->', JSON.stringify(wallpaperPalette));
        }).catch((e) => log('capture chain fail', e && e.message)
        ).finally(() => { clearTimeout(bootGuard); openOnce(); });
      }
      // Tetris mosaics: every page laid out once (legacy cascade/grid x/y are
      // recomputed - the right-anchored mosaic is the only language now)
      layoutAllScenes(false);
      broadcastFocus();
      if (conf.followSystemColor) broadcastTheme();   // first paint of the OS tone
    } else {
      openWizard();     // first run: setup wizard instead of dumping every card on screen
      log('first run -> wizard');
    }
    buildTray();
    /* the right-edge scene pager is off: the shell has its own paging and
       the floating ①/+ strip was reported as an unexplained always-on-top
       overlay. Re-enable by restoring this call. */
    refreshTaskList(() => {});
    watchDisplayMetrics();           // screen module is only legal after ready
    try {
      globalShortcut.register('Control+Alt+D', () => setMoveMode(!moveMode));
      // on-demand Tetris re-pack of the active scene: focus/click/drag never
      // re-layout any more, so this is the explicit "tidy up" gesture
      globalShortcut.register('Control+Alt+R', () => {
        layoutScene(conf.activeScene, true);
        broadcastFocus();
      });
      /* Win+D is owned by explorer (RegisterHotKey -> 1409). Win+Shift+D
         is free on this machine and is the desktop toggle. */
      const okToggle = globalShortcut.register('Super+Shift+D', () => toggleDesktopMode('hotkey'));
      log('shortcut Super+Shift+D ->', okToggle ? 'registered' : 'FAILED (in use)');
      /* Page from anywhere on the desktop. A real wheel over bare desktop
         belongs to whatever window is underneath (a click-through window
         cannot receive it), so these are the reliable global equivalent. */
      globalShortcut.register('Control+Alt+Left', () => sendPageStep(-1));
      globalShortcut.register('Control+Alt+Right', () => sendPageStep(1));
    } catch (e) { log('shortcut register fail', e.message); }
    if (conf.mode === 'desktop') applyMode();
    log('Pico RamOS up with', conf.cards.length, 'cards; mode=' + conf.mode);
  });
  app.on('window-all-closed', (e) => {
    /* Tray app: closing the manager / wizard is not a quit. BUT if the shell
       itself is gone (renderer crash, external kill) nothing is left to run,
       while the lease would keep hiding the native taskbar forever. */
    if (conf.onboarded && SHELL_MODE && (!shellWin || shellWin.isDestroyed())) {
      log('shell gone with no windows left -> releasing desktop and quitting');
      try { setShellTakeover(false); } catch (err) {}
      try { runDesktopShell('show'); } catch (err) {}
      app.quit();
      return;
    }
    e.preventDefault();
  });
  app.on('second-instance', () => {
    /* explorer.exe restarts re-run start.bat via the Windhawk mod. Popping
       the manager over the user's work every time was an intrusion; just make
       sure the shell still exists and sits at the bottom. */
    try {
      /* The user left with Win+Shift+D (shell hidden, process still resident)
         and launched again. Just showing the hidden window under Explorer's
         taskbar looked exactly like "PROS won't start". Re-arm the takeover. */
      if (desktopMode !== 'pico') {
        setDesktopMode('pico', 'second-instance');
        log('second-instance -> re-armed pico mode');
        return;
      }
      if (!shellWin || shellWin.isDestroyed()) openShell();
      else { shellWin.showInactive(); pushShellToBottom(); }
      log('second-instance -> shell verified, no manager popup');
    } catch (e) { log('second-instance fail', e.message); }
  });
}
