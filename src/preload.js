// Pico RamOS preload - bridges the card shell (and the whale pet page) to main.
// Exposes three APIs:
//   window.card    - generic card chrome (drag/resize/settings/close/launch)
//   window.electron.pet - pet-page compatible API (same shape the hub uses),
//                    so the whale page runs inside a Pico RamOS card unchanged.
//   window.manager - manager panel API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('card', {
  getState: () => ipcRenderer.invoke('card-get-state'),
  moveBy: (dx, dy) => ipcRenderer.send('card-move-by', dx, dy),
  resizeBy: (dw, dh) => ipcRenderer.send('card-resize-by', dw, dh),
  resizeTo: (b) => ipcRenderer.send('card-resize-to', b),   // 8-way: absolute bounds
  boundsSync: () => ipcRenderer.sendSync('card-bounds'),    // sync snapshot for drags
  dragStart: () => ipcRenderer.send('card-drag-start'),
  dragEnd: () => ipcRenderer.send('card-drag-end'),
  save: (patch) => ipcRenderer.invoke('card-save', patch || {}),
  setOpacity: (o) => ipcRenderer.invoke('card-opacity', o),
  setColor: (c) => ipcRenderer.invoke('card-color', c),
  setTopMost: (on) => ipcRenderer.invoke('card-topmost', on),
  setClickThrough: (v) => ipcRenderer.invoke('card-clickthrough', v),   // true/false/null
  close: () => ipcRenderer.invoke('card-close'),
  launch: () => ipcRenderer.invoke('card-launch'),
  launchApp: (target) => ipcRenderer.invoke('launch-app', target),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  openManager: () => ipcRenderer.invoke('card-open-manager'),
  openExternal: (url) => ipcRenderer.invoke('card-open-external', url),
  mailFetch: () => ipcRenderer.invoke('mail-fetch'),
  mailSend: (payload) => ipcRenderer.invoke('mail-send', payload),
  hintSeen: (key) => ipcRenderer.invoke('hint-seen', key),
  onConfig: (cb) => ipcRenderer.on('card-config', (_e, c) => cb(c)),
  onAppStatus: (cb) => ipcRenderer.on('app-status', (_e, s) => cb(s)),
  // system color following: main pushes the OS tone whenever it flips
  onSystemTheme: (cb) => ipcRenderer.on('system-theme', (_e, t) => cb(t)),
  setFollowSystem: (on) => ipcRenderer.invoke('set-follow-system-color', on),
  // gallery: wheel/arrows slide the strip focus; main broadcasts who owns it
  focusNext: (dir) => ipcRenderer.send('card-focus-next', dir),
  focusSet: (id) => ipcRenderer.send('card-focus-set', id),
  onCardFocus: (cb) => ipcRenderer.on('card-focus', (_e, f) => cb(f)),
});

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  version: process.versions.electron,
});

contextBridge.exposeInMainWorld('os', {
  getState: () => ipcRenderer.invoke('os-get-state'),
  launchCard: (id) => ipcRenderer.invoke('os-launch', id),
  launchPath: (target) => ipcRenderer.invoke('os-launch-path', target),
  moveCard: (id, page, col, row) => ipcRenderer.invoke('os-move-card', id, page, col, row),
  setHitRects: (rects) => ipcRenderer.invoke('os-set-hit-rects', rects),
  /* keep the shell clickable while a card is being dragged: the pointer can
     leave every published hit rect, and losing pointerup strands the card */
  setDragActive: (on) => ipcRenderer.send('os-drag-active', !!on),
  /* boot() retries getState; if all retries fail, ask main to rebuild the
     shell instead of leaving a blank transparent window over the desktop */
  shellBootFailed: () => ipcRenderer.invoke('os-shell-boot-failed'),
  onDisplayChanged: (cb) => ipcRenderer.on('os-display-changed', (_e, area) => cb(area)),
  configHealth: () => ipcRenderer.invoke('config-health'),
  /* one-way and fire-and-forget: the topmost dock hit window forwards real
     pointer events to main, which injects them straight into the shell
     renderer. invoke() would add a round trip to every mouse move. */
  dockHit: (ev) => ipcRenderer.send('os-dock-hit', ev),
  /* A right-click is NOT forwarded as a synthetic contextMenu event: Electron
     does not turn that injected type into a DOM contextmenu (verified with a
     real Electron probe). Send a dedicated one-way message instead; main
     broadcasts the real cursor position and the shell draws its glass menu. */
  dockContextMenu: (p) => ipcRenderer.send('os-dock-context-menu', p || {}),
  menuAction: (key) => ipcRenderer.invoke('os-menu-action', String(key || '')),
  onGlassMenu: (cb) => ipcRenderer.on('os-show-glass-menu', (_e, p) => cb(p)),
  onPageStep: (cb) => ipcRenderer.on('os-page-step', (_e, d) => cb(d)),
  mediaControl: (action) => ipcRenderer.invoke('os-media-control', action),
  desktopShell: (action) => ipcRenderer.invoke('os-desktop-shell', action),
  /* glass taskbar: list / activate / minimize real Windows, and toggle the
     native taskbar without fighting the Windhawk flag */
  taskbar: (cmd, arg) => ipcRenderer.invoke('os-taskbar', cmd, arg),
  taskbarShell: (on) => ipcRenderer.invoke('os-taskbar-shell', on),
  capture: (outPath) => ipcRenderer.invoke('os-capture', outPath),
  sysinfo: () => ipcRenderer.invoke('os-sysinfo'),
  vpn: (opts) => ipcRenderer.invoke('os-vpn', opts || {}),
  vpnLaunch: () => ipcRenderer.invoke('os-vpn-launch'),
  weather: (city) => ipcRenderer.invoke('os-weather', city),
  scheduleGet: (date) => ipcRenderer.invoke('os-schedule-get', date),
  scheduleSet: (payload) => ipcRenderer.invoke('os-schedule-set', payload),
  setCardRect: (id, rect) => ipcRenderer.invoke('os-card-rect', id, rect),
  setLayout: (payload) => ipcRenderer.invoke('os-set-layout', payload),
  setCardOpacity: (id, value) => ipcRenderer.invoke('os-card-opacity', id, value),
  onChanged: (cb) => ipcRenderer.on('os-changed', (_e, s) => cb(s)),
  onPalette: (cb) => ipcRenderer.on('os-palette', (_e, p) => cb(p)),
  setBootPage: (page) => ipcRenderer.invoke('os-set-boot-page', page),
  mailSend: (payload) => ipcRenderer.invoke('mail-send', payload),
  mailFetch: (limit) => ipcRenderer.invoke('mail-fetch', limit),
  biliFetch: (opts) => ipcRenderer.invoke('bili-fetch', opts || {}),
  /* the Win11 start menu was swallowed by startmenu-guard.ps1 -- show our panel */
  onStartMenu: (cb) => ipcRenderer.on('os-start-menu', () => cb()),
  /* native desktop <-> Pico, plus the live IME indicator */
  desktopToggle: () => ipcRenderer.invoke('os-desktop-toggle'),
  desktopMode: () => ipcRenderer.invoke('os-desktop-mode'),
  onDesktopMode: (cb) => ipcRenderer.on('os-desktop-mode', (_e, s) => cb(s)),
  onIme: (cb) => ipcRenderer.on('os-ime', (_e, s) => cb(s)),
});

contextBridge.exposeInMainWorld('dock', {
  /* bottom strip = shell pages, not the legacy per-window conf.scenes */
  state: () => ipcRenderer.invoke('page-list'),
  switch: (id) => ipcRenderer.invoke('page-go', id),
  add: (name) => ipcRenderer.invoke('page-add', name),
  onScenes: (cb) => ipcRenderer.on('dock-scenes', (_e, s) => cb(s)),
  onSystemTheme: (cb) => ipcRenderer.on('system-theme', (_e, t) => cb(t)),
});

/* The taskbar skin is a paint-only window. It listens, never calls back:
   all input goes straight through to the real Windows taskbar. */
contextBridge.exposeInMainWorld('skin', {
  onConfig: (cb) => ipcRenderer.on('skin-config', (_e, c) => cb(c)),
  onPalette: (cb) => ipcRenderer.on('skin-palette', (_e, p) => cb(p)),
});

contextBridge.exposeInMainWorld('manager', {
  list: () => ipcRenderer.invoke('cards-list'),
  open: (id) => ipcRenderer.invoke('cards-open', id),
  hide: (id) => ipcRenderer.invoke('cards-hide', id),
  remove: (id) => ipcRenderer.invoke('cards-delete', id),
  update: (id, patch) => ipcRenderer.invoke('cards-update', id, patch),
  add: (card) => ipcRenderer.invoke('cards-add', card),
  pickFile: () => ipcRenderer.invoke('pick-file'),
  autostartGet: () => ipcRenderer.invoke('autostart-get'),
  autostartSet: (on) => ipcRenderer.invoke('autostart-set', on),
  modeGet: () => ipcRenderer.invoke('mode-get'),
  modeSet: (m) => ipcRenderer.invoke('mode-set', m),
  ctGet: () => ipcRenderer.invoke('clickthrough-get'),
  ctSet: (on) => ipcRenderer.invoke('clickthrough-set', on),
  followSystemGet: () => ipcRenderer.invoke('follow-system-get'),
  followSystemSet: (on) => ipcRenderer.invoke('set-follow-system-color', on),
  followSystemAccent: () => ipcRenderer.invoke('follow-system-accent'),
  snapGet: () => ipcRenderer.invoke('snap-get'),
  snapSet: (v) => ipcRenderer.invoke('snap-set', v),
  openWizard: () => ipcRenderer.invoke('open-wizard'),
  scenes: () => ipcRenderer.invoke('scene-list'),
  sceneSwitch: (id) => ipcRenderer.invoke('scene-switch', id),
  sceneAdd: (name) => ipcRenderer.invoke('scene-add', name),
  sceneLayout: () => ipcRenderer.invoke('scene-layout'),
  sceneRename: (id, name) => ipcRenderer.invoke('scene-rename', id, name),
  sceneDelete: (id) => ipcRenderer.invoke('scene-delete', id),
  sceneMoveCard: (id, sceneId) => ipcRenderer.invoke('scene-move-card', id, sceneId),
  sceneReorder: (id, dir) => ipcRenderer.invoke('scene-reorder-card', id, dir),
  showScene: () => ipcRenderer.invoke('cards-show-scene'),
  hideAll: () => ipcRenderer.invoke('cards-hide-all'),
  wizardMoveBy: (dx, dy) => ipcRenderer.send('wizard-move-by', dx, dy),
  wizardState: () => ipcRenderer.invoke('wizard-state'),
  wizardPick: () => ipcRenderer.invoke('wizard-pick'),
  wizardDone: (payload) => ipcRenderer.invoke('wizard-done', payload),
  close: () => ipcRenderer.invoke('manager-close'),
  quit: () => ipcRenderer.invoke('quit'),
});
