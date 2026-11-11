import io, re, sys

P = r"F:\job\pico-ramos-showcase\src\main.js"
s = io.open(P, encoding="utf-8").read()
lines = s.split("\n")
miss = []

def rep(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        miss.append((label, n))
        return
    s = s.replace(old, new)

def cut(start_sub, end_sub, new_text="", label=""):
    """remove from the line containing start_sub up to (excluding) the line containing end_sub"""
    global s
    L = s.split("\n")
    a = next((i for i, l in enumerate(L) if start_sub in l), None)
    b = next((i for i, l in enumerate(L) if a is not None and i > a and end_sub in l), None)
    if a is None or b is None:
        miss.append((label or start_sub, -1))
        return
    L[a:b] = new_text.split("\n") if new_text else []
    s = "\n".join(L)

# 1. header comment
rep("//   module : built-in page (study card, custom pet page ...)\n"
    "//   pet    : the whale pet page served by the local hub, OR a user-imported\n"
    "//            pet asset (3D glb / Live2D / image) rendered by modules/pet.html\n",
    "//   module : built-in page (study card, mail card, ...)\n", "header")

# 2. constants
rep("const PET_ASSETS_DIR = path.join(ASSETS_DIR, 'pet');\n", "", "PET_ASSETS_DIR")
rep("const PET_URL = 'http://127.0.0.1:' + HUB_PORT + '/pet';\n"
    "const PET_HTTP_PORT = 8855;            // serves APP_DIR for custom pet assets\n"
    "const PET_BASE_W = 460, PET_BASE_H = 580;\n"
    "const PET_MIN_F = 0.5, PET_MAX_F = 1.8;\n", "", "PET consts")
rep("// packer: size ceiling (pets exempt)", "// packer: size ceiling", "ceiling comment")

# 3. filters
rep("return conf.cards.filter((c) => c && c.kind !== 'pet')", "return conf.cards.filter(Boolean)", "sig")
rep("const live = conf.cards.filter((c) => c && c.kind !== 'pet');", "const live = conf.cards.filter(Boolean);", "live")
rep("return card && card.kind !== 'pet';", "return !!card;", "cell filter")
rep("const cards = conf.cards.filter((c) => c && c.kind !== 'pet');", "const cards = conf.cards.filter(Boolean);", "cards")
rep("cards: conf.cards.filter((c) => c && c.kind !== 'pet'),", "cards: conf.cards.filter(Boolean),", "snapshot cards")
rep("dock: (layout.dock || []).filter((id) => conf.cards.some((c) => c && c.id === id && c.kind !== 'pet')),",
    "dock: (layout.dock || []).filter((id) => conf.cards.some((c) => c && c.id === id)),", "dock")

# 4. pet migrations
cut("  // pets used to force pass-through", "  conf = migrateShellLayout(conf);", "", "migrations")

# 5. notice path
rep("function petNoticePath() { return path.join(APP_DIR, 'shell', 'pet-notice.html'); }\n", "", "notice path")

# 6. local asset server
cut("/* ---------- local asset server", "function portOpen(port) {", "", "asset server")

# 7. clampRectWork
cut("function clampRectWork(x, y, w, h) {", "function clampCard(id, x, y, w, h) {", "", "clampRectWork")

# 8. click-through
rep("  // no per-card override: every card (pets included) follows the global switch",
    "  // no per-card override: every card follows the global switch", "ct comment")
rep("  try {\n    if (c.cfg.kind === 'pet') c.win.setIgnoreMouseEvents(on, { forward: true });\n"
    "    else c.win.setIgnoreMouseEvents(on);\n  } catch (e) {}",
    "  try { c.win.setIgnoreMouseEvents(on); } catch (e) {}", "ct apply")

# 9. display size
rep("  // pets are cut-out characters: they NEVER scale (not by the focus factor,\n"
    "  // not by the ceiling) - a resized pet reads as \"the card changes size on\n"
    "  // its own\", and the user's manual pet resize is authoritative\n"
    "  if (c.kind === 'pet') return { w: Math.max(MIN_W, Math.round(c.w)), h: Math.max(MIN_H, Math.round(c.h)) };\n",
    "", "display size")

# 10. scene container comment
rep(" * zoom commits through clampRect so a card can never be parked off-screen or\n"
    " * under the dock; pets are exempt from the mosaic region (they roam the whole\n"
    " * work area on purpose) but still never leave the screen. */",
    " * zoom commits through clampRect so a card can never be parked off-screen or\n"
    " * under the dock. */", "container comment")

# 11. clampCard
rep("  const r = c.cfg.kind === 'pet'\n    ? b\n"
    "    : clampRect(x === undefined ? b.x : x, y === undefined ? b.y : y, w || b.width, h || b.height);\n  return r;",
    "  return clampRect(x === undefined ? b.x : x, y === undefined ? b.y : y, w || b.width, h || b.height);",
    "clampCard")

# 12. siblings
rep("/* would this rect sit on a sibling? (pets never count - they overlap on purpose) */",
    "/* would this rect sit on a sibling? */", "sibling comment")
rep("    if (oid === id || o.win.isDestroyed() || o.cfg.kind === 'pet') continue;",
    "    if (oid === id || o.win.isDestroyed()) continue;", "sibling loop")
rep("/* nudge the card out of every sibling overlap with the SMALLEST push; if no\n"
    " * push keeps it inside the container, fall back to its pack slot. Pets never\n"
    " * take part (a pet standing on a card is the whole point of a pet). */",
    "/* nudge the card out of every sibling overlap with the SMALLEST push; if no\n"
    " * push keeps it inside the container, fall back to its pack slot. */", "resolve comment")
rep("  if (!c || c.win.isDestroyed() || c.cfg.kind === 'pet') return false;",
    "  if (!c || c.win.isDestroyed()) return false;", "resolve guard")
rep("  const sibs = conf.cards.filter((k) => (k.scene || 'main') === scene && k.id !== id && k.kind !== 'pet');",
    "  const sibs = conf.cards.filter((k) => (k.scene || 'main') === scene && k.id !== id);", "sibs")

# 13. enforce bounds
rep("  const cl = c.cfg.kind === 'pet'\n    ? b\n    : clampRect(b.x, b.y, bw, bh);",
    "  const cl = clampRect(b.x, b.y, bw, bh);", "enforce clamp")
rep("  if (c.cfg.kind !== 'pet') resolveOverlaps(id);", "  resolveOverlaps(id);", "enforce resolve")

# 14. shell comment
rep(" * stay only for pets (a cut-out character has to float above other apps).",
    " * are kept for modules that need a window of their own.", "shell comment")

# 15. createCard shell guard + pet sizing
cut("  /* Shell mode: everything except the pet is a DOM node", "  // no saved position -> this card joins",
    "  /* Shell mode: every card is a DOM node inside shellWin, so there is no\n"
    "   * per-card BrowserWindow to create. */\n  if (SHELL_MODE) return;", "shell guard")

rep("const op = Number.isFinite(raw) && raw > 0 ? raw : (cfg.kind === 'pet' ? 1 : 0.92);",
    "const op = Number.isFinite(raw) && raw > 0 ? raw : 0.92;", "opacity default")
rep(" * pet-zoom / cards-update) or a mosaic re-pack may change it. */",
    " * cards-update) or a mosaic re-pack may change it. */", "authoritative comment")

# 16. load branch
rep("  if (cfg.kind === 'module') {\n    win.loadFile(modulePath(cfg.target));\n"
    "  } else if (cfg.kind === 'pet') {\n    const pet = cfg.pet || {};\n"
    "    // Both branches serve over the local asset server (no external dependency\n"
    "    // for the page/model). ensurePetServer is idempotent.\n    ensurePetServer();\n"
    "    if (pet.type && pet.type !== 'hub') {\n"
    "      // user-imported asset (3D / Live2D / image): local renderer over http\n"
    "      win.loadURL('http://127.0.0.1:' + PET_HTTP_PORT + '/modules/pet.html?card=' + encodeURIComponent(cfg.id));\n"
    "    } else {\n"
    "      // hub whale: now bundled under /pet/ and served by this same asset\n"
    "      // server (self-contained 3D model). The 素材 card data is proxied from\n"
    "      // 文枢 when it is running and degrades gracefully (\"文枢没起来\") when not.\n"
    "      win.loadURL('http://127.0.0.1:' + PET_HTTP_PORT + '/pet/pet.html?t=' + Date.now());\n"
    "    }\n  } else if (cfg.kind === 'mail') {",
    "  if (cfg.kind === 'module') {\n    win.loadFile(modulePath(cfg.target));\n  } else if (cfg.kind === 'mail') {",
    "load branch")

# 17. snap / drag / resize clamps
rep("    const cl = c.cfg.kind === 'pet'\n      ? b\n      : clampRect(nx, ny, b.width, b.height);",
    "    const cl = clampRect(nx, ny, b.width, b.height);", "snap clamp")
rep("    if (c.cfg.kind !== 'pet' && rectHitsSibling(id, nx, ny, b.width, b.height)) return false;",
    "    if (rectHitsSibling(id, nx, ny, b.width, b.height)) return false;", "snap sibling")
rep("  const cl = c.cfg.kind === 'pet'\n    ? b\n    : clampRect(b.x + (dx | 0), b.y + (dy | 0), c.baseW, c.baseH);",
    "  const cl = clampRect(b.x + (dx | 0), b.y + (dy | 0), c.baseW, c.baseH);", "drag clamp")
rep("  const cl = c.cfg.kind === 'pet'\n    ? b\n    : clampRect(Math.round(Number(b.x) || 0), Math.round(Number(b.y) || 0), w, h);",
    "  const cl = clampRect(Math.round(Number(b.x) || 0), Math.round(Number(b.y) || 0), w, h);", "resize clamp")
rep("  // the scene container (or off-screen for pets). Nothing else moves.",
    "  // the scene container. Nothing else moves.", "drag comment")
rep(" * screenshot / pet-asset content cannot be re-skinned. */",
    " * screenshot content cannot be re-skinned. */", "skin comment")

# 18. pet IPC + asset import
cut("/* pet-card IPC (same channel names", "/* ---------- mail aggregation (IMAP)", "", "pet ipc")

# 19. cards-update reload
rep("    // pet asset / kind changes need a fresh page\n"
    "    if (patch.pet || patch.kind || patch.target) c.win.webContents.reload();",
    "    // kind / target changes need a fresh page\n"
    "    if (patch.kind || patch.target) c.win.webContents.reload();", "reload guard")

io.open(P, "w", encoding="utf-8", newline="\n").write(s)

left = [ (i+1, l) for i, l in enumerate(s.split("\n")) if re.search(r"\bpet", l, re.I) ]
print("MISSED:", miss)
print("LEFT", len(left))
for n, l in left[:20]:
    print(n, l.strip()[:110])
