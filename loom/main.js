// Keystroke Loom — Electron main process
// A transparent, frameless, always-on-top loom on the desktop (same setup as Palm Tree Pet).
// Keystrokes from every app are read with uiohook-napi and woven into cells.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, shell, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

// If the Terminal that started the app is closed, console writes throw "write EIO". Ignore them.
for (const s of [process.stdout, process.stderr]) if (s && s.on) s.on('error', () => {});
for (const k of ['log', 'warn', 'error']) { const o = console[k].bind(console); console[k] = (...a) => { try { o(...a); } catch {} }; }

// Window size in loom units. The page reports its height: 380 for the square loom,
// taller when the whole cloth is shown (double-click).
const VIEW_W = 440;
let viewH = 380;

let hook = null;
try { hook = require('uiohook-napi'); } catch (e) { console.log('[keys] uiohook-napi not loaded:', e.message); }

let win = null, tray = null;
let scale = 0.5;
let hookActive = false;   // true = weaving from every app
let paused = false;
let started = false;      // the first click on the loom ties the knot; nothing is woven before that
let expanded = false;     // double-click shows the whole cloth
let cells = [];            // compact cell codes, see src/loom.js
let dragOffset = null;

// ---------- state ----------
const statePath = () => path.join(app.getPath('userData'), 'state.json');
function readState() { try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; } }
function writeState(patch) {
  try { fs.writeFileSync(statePath(), JSON.stringify({ ...readState(), ...patch })); } catch (e) { console.error(e); }
}
let saveTimer = null;
function saveCells() { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeState({ cells }), 400); }

// ---------- key map (from the Figma "test2" frame) ----------
// Colour = column (0-9), shape = keyboard row.
// b = bar (number row), s = square (Q row), c = circle (A row), d = diagonal "\" (Z row).
// The Z row is shifted one column: the ⌘ key sits in column 0, Z is column 1 ... "." is column 9.
// Codes are the standard scancodes uiohook reports (they don't change with keyboard language).
const ROWS = [
  { shape: 'b', names: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], codes: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { shape: 's', names: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], codes: [16, 17, 18, 19, 20, 21, 22, 23, 24, 25] },
  { shape: 'c', names: ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Semicolon'], codes: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39] },
  { shape: 'd', names: [null, 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Comma', 'Period'], codes: [null, 44, 45, 46, 47, 48, 49, 50, 51, 52] },
];
const SPACE_CODE = 57;
const SPACE_COL = 9;            // space is #fbbb01, the column-9 colour
const byCode = {}, byDomCode = {};
const domName = (n) => (/^[0-9]$/.test(n) ? 'Digit' + n : /^[A-Z]$/.test(n) ? 'Key' + n : n);
for (const r of ROWS) r.names.forEach((n, col) => {
  if (!n) return;
  const v = { shape: r.shape, col };
  byCode[r.codes[col]] = v;
  byDomCode[domName(n)] = v;
});

// One keystroke -> one cell, or two cells when ⌘ / Ctrl / Shift is held:
// first a square in the key's colour with the white modifier glyph, then the key's own cell.
function weave(v, mods) {
  if (paused || !started || !v) return;
  const col = v === 'space' ? SPACE_COL : v.col;
  const mod = mods.meta ? 'M' : mods.ctrl ? 'C' : mods.shift ? 'S' : null;
  const add = [];
  if (mod) add.push(mod + col);
  add.push(v === 'space' ? '_' : v.shape + v.col);
  cells.push(...add);
  saveCells();
  if (win) win.webContents.send('weave', add);
}

// Backspace weaves nothing new: it turns the colour of the last keystroke light grey.
// A keystroke woven as two cells (modifier + key) turns grey as one. White glyphs stay white.
// Grey cells are stored with a "~" in front of their code.
const KEY_CELL = /^[bscd_]/, MOD_CELL = /^[MCS]/;
function unweave() {
  if (paused || !started) return;
  let i = cells.length - 1;
  while (i >= 0 && (cells[i][0] === '~' || !KEY_CELL.test(cells[i]))) i--;
  if (i < 0) return;
  const greyed = [i];
  if (i > 0 && MOD_CELL.test(cells[i - 1])) greyed.push(i - 1);
  for (const j of greyed) cells[j] = '~' + cells[j];
  saveCells();
  if (win) win.webContents.send('grey', greyed);
}

// ---------- reading keys from every app ----------
const BACKSPACE_CODE = 14;
const held = new Set(); // holding a key down weaves it once, not on every auto-repeat
function startHook() {
  if (!hook || hookActive) return hookActive;
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) return false;
  try {
    hook.uIOhook.on('keydown', (e) => {
      // Backspace follows the real deletion, so holding it keeps greying cells
      if (e.keycode === BACKSPACE_CODE) { unweave(); return; }
      if (held.has(e.keycode)) return;
      held.add(e.keycode);
      weave(e.keycode === SPACE_CODE ? 'space' : byCode[e.keycode], { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey });
    });
    hook.uIOhook.on('keyup', (e) => held.delete(e.keycode));
    hook.uIOhook.start();
    hookActive = true;
    console.log('[keys] weaving from every app');
  } catch (e) {
    console.log('[keys] could not start the keyboard listener:', e.message);
  }
  if (win) win.webContents.send('command', 'mode', hookActive ? 'global' : 'local');
  if (tray) buildMenu();
  return hookActive;
}

// Fallback when the global listener isn't running: the page sends keys typed while the loom is focused.
ipcMain.on('key', (_e, k) => {
  if (hookActive || !k) return;
  if (k.code === 'Backspace') { unweave(); return; }
  weave(k.code === 'Space' ? 'space' : byDomCode[k.code], k);
});

function askForPermission() {
  if (process.platform !== 'darwin' || !hook) return;
  systemPreferences.isTrustedAccessibilityClient(true); // shows the macOS prompt
  const timer = setInterval(() => { if (startHook()) clearInterval(timer); }, 2000);
}
function openAccessibilitySettings() {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
}

// ---------- window ----------
function createWindow() {
  const st = readState();
  scale = st.scale || 0.5;
  const wa = screen.getPrimaryDisplay().workArea;
  const w = Math.round(VIEW_W * scale), h = Math.round(viewH * scale);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = clamp(st.winX ?? wa.x + wa.width - w - 20, wa.x, wa.x + wa.width - w);
  const y = clamp(st.winY ?? wa.y + wa.height - h, wa.y, wa.y + wa.height - h);

  win = new BrowserWindow({
    x, y, width: w, height: h,
    transparent: true, frame: false, resizable: false, alwaysOnTop: true, hasShadow: false,
    skipTaskbar: true, fullscreenable: false, focusable: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Clicks pass through to the desktop; the page turns this off while the mouse is over the loom itself.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('console-message', (e) => console.log('[page]', e.message));
  win.on('moved', () => { const [wx, wy] = win.getPosition(); writeState({ winX: wx, winY: wy }); });
}

// Resize the window to the loom, keeping its bottom edge (the knot) where it is.
// The whole-cloth view shrinks to fit when it is taller than the screen.
function fitWindow() {
  if (!win) return;
  const [x, y] = win.getPosition();
  const [, oldH] = win.getSize();
  const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
  const s = Math.min(scale, wa.height / viewH);
  const w = Math.round(VIEW_W * s), h = Math.round(viewH * s);
  const bottom = y + oldH;
  win.setBounds({ x: x + Math.round((win.getSize()[0] - w) / 2), y: Math.max(wa.y, bottom - h), width: w, height: h });
}
function setScale(s) {
  scale = s;
  fitWindow();
  writeState({ scale: s });
  buildMenu();
}

// ---------- menu bar ----------
function buildMenu() {
  const status = hookActive ? 'Weaving from every app'
    : hook ? 'Needs permission to read typing…'
    : 'Weaving only while the loom is focused';
  const template = [
    { label: 'Keystroke Loom', enabled: false },
    { label: status, enabled: !hookActive && !!hook, click: () => { askForPermission(); openAccessibilitySettings(); } },
    { type: 'separator' },
    { label: 'Weaving', type: 'checkbox', checked: !paused, click: (m) => { paused = !m.checked; writeState({ paused }); } },
    // shown while the whole cloth is open (double-click on the loom)
    ...(expanded ? [
      { label: 'Download PDF', click: () => win && win.webContents.send('command', 'export') },
      { label: 'Back to the square', click: () => win && win.webContents.send('command', 'collapse') },
    ] : []),
    { label: 'Save image to Desktop', enabled: cells.length > 0, click: () => win && win.webContents.send('command', 'export-png') },
    { label: 'Clear loom…', enabled: started, click: clearLoom },
    { type: 'separator' },
    { label: 'Size', submenu: [['Small', 0.35], ['Medium', 0.5], ['Large', 0.75]].map(([label, s]) => ({
      label, type: 'radio', checked: Math.abs(scale - s) < 0.01, click: () => setScale(s),
    })) },
    { type: 'separator' },
    { label: 'Testing', submenu: [
      { label: 'Save backup to Desktop', enabled: cells.length > 0, click: saveBackup },
      { label: 'Open backup…', click: openBackup },
    ] },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

async function clearLoom() {
  const { response } = await dialog.showMessageBox({
    type: 'question', buttons: ['Download PDF and clear', 'Clear', 'Cancel'], defaultId: 0, cancelId: 2,
    message: 'Clear the loom?', detail: `This removes all ${cells.length} woven cells and unties the knot. Click the loom to start a new cloth.`,
  });
  if (response === 2) return;
  if (response === 0) win.webContents.send('command', 'export');
  setTimeout(() => {
    cells = []; started = false; writeState({ cells, started });
    win.webContents.send('command', 'clear');
    buildMenu();
  }, response === 0 ? 1500 : 0);
}

// ---------- lightweight backup ----------
// A .loom file is plain text (JSON): the cell codes, about 3 bytes per cell.
// 10,000 keystrokes ≈ 30 KB. Open it again with "Open backup…" to get the same cloth back.
const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
};
function saveBackup() {
  const file = path.join(app.getPath('desktop'), `Loom ${stamp()}.loom`);
  const data = { app: 'keystroke-loom', format: 1, saved: new Date().toISOString(), cellCount: cells.length, cells: cells.join(' ') };
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  shell.showItemInFolder(file);
}
async function openBackup() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Open a loom backup', defaultPath: app.getPath('desktop'),
    filters: [{ name: 'Loom backup', extensions: ['loom'] }], properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return;
  let loaded;
  try {
    const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    loaded = String(data.cells || '').split(' ').filter((c) => /^~?([bscdMCS]\d|_)$/.test(c));
  } catch (e) {
    dialog.showErrorBox('Could not open the backup', 'This file is not a loom backup, or it is damaged.');
    return;
  }
  if (cells.length) {
    const { response } = await dialog.showMessageBox({
      type: 'question', buttons: ['Open backup', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'Replace the cloth on the loom?',
      detail: `The loom has ${cells.length} cells. The backup has ${loaded.length}. Save a backup of the current cloth first if you want to keep it.`,
    });
    if (response !== 0) return;
  }
  cells = loaded; started = true;
  writeState({ cells, started });
  win.webContents.send('command', 'load', cells);
  buildMenu();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
  tray = new Tray(icon);
  tray.setToolTip('Keystroke Loom');
  if (process.platform === 'win32') tray.on('click', () => tray.popUpContextMenu());
  buildMenu();
}

// ---------- glyph SVGs exported from Figma (assets/glyphs/*.svg) ----------
const GLYPHS = ['cmd', 'ctrl', 'shift', 'space', 'knot'];
const glyphDir = path.join(__dirname, 'assets', 'glyphs');
ipcMain.handle('glyphs', () => {
  const out = {};
  for (const g of GLYPHS) {
    try { out[g] = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(glyphDir, g + '.svg')).toString('base64'); }
    catch { out[g] = null; }
  }
  return out;
});
// drop new SVGs into the folder and the loom picks them up right away
try {
  let t = null;
  fs.watch(glyphDir, () => { clearTimeout(t); t = setTimeout(() => win && win.webContents.send('command', 'glyphs-changed'), 300); });
} catch {}

// ---------- IPC from the page ----------
ipcMain.handle('init', () => ({ cells, started, mode: hookActive ? 'global' : 'local' }));
ipcMain.on('tie-knot', () => {
  if (started) return;
  started = true; writeState({ started });
  win.webContents.send('command', 'started');
  buildMenu();
});
ipcMain.on('set-expanded', (_e, on) => { expanded = !!on; buildMenu(); });
ipcMain.on('set-height', (_e, h) => {
  if (typeof h !== 'number' || h < 100) return;
  viewH = h; fitWindow();
});
ipcMain.on('click-through', (_e, on) => { if (win) win.setIgnoreMouseEvents(on, { forward: true }); });
ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint(); const [wx, wy] = win.getPosition();
  dragOffset = { x: c.x - wx, y: c.y - wy };
});
ipcMain.on('drag-move', () => {
  if (!dragOffset) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(Math.round(c.x - dragOffset.x), Math.round(c.y - dragOffset.y));
});
ipcMain.on('drag-end', () => { dragOffset = null; });
// Save image: PNG of the whole cloth at 2×, rendered by the page.
ipcMain.on('save-png', (_e, dataUrl) => {
  const file = path.join(app.getPath('desktop'), `Loom ${stamp()}.png`);
  fs.writeFileSync(file, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
  shell.showItemInFolder(file);
});

// Download PDF: the page sends the whole cloth as SVG; a hidden window prints it to a PDF on the Desktop.
ipcMain.on('save-pdf', async (_e, svgText, w, h) => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const name = `Loom ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.pdf`;
  const file = path.join(app.getPath('desktop'), name);
  const pdfWin = new BrowserWindow({ show: false, width: Math.ceil(w), height: Math.ceil(h) });
  try {
    const html = `<!DOCTYPE html><html><head><style>@page{margin:0}html,body{margin:0}svg{display:block}</style></head><body>${svgText}</body></html>`;
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await pdfWin.webContents.printToPDF({
      printBackground: true, margins: { marginType: 'none' },
      pageSize: { width: w / 96, height: h / 96 }, // inches; 1 loom unit = 1 CSS pixel
    });
    fs.writeFileSync(file, pdf);
    shell.showItemInFolder(file);
  } catch (e) {
    dialog.showErrorBox('Could not save the PDF', String(e.message || e));
  } finally {
    pdfWin.destroy();
  }
});

// ---------- start / quit ----------
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const st = readState();
  cells = Array.isArray(st.cells) ? st.cells : [];
  paused = !!st.paused;
  started = !!st.started || cells.length > 0;
  createWindow();
  createTray();
  if (!startHook() && hook) askForPermission();
});
app.on('before-quit', () => {
  clearTimeout(saveTimer); writeState({ cells });
  if (hookActive) try { hook.uIOhook.stop(); } catch {}
});
app.on('window-all-closed', () => app.quit());
