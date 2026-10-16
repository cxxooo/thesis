// Palm Tree Pet — Electron main process
// Makes a transparent, frameless, always-on-top window that sits on the desktop.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, shell } = require('electron');

// If the Terminal that started the app (npm start) is closed, writing to the console throws "write EIO".
// Ignore those errors so logging can never crash the app.
for (const s of [process.stdout, process.stderr]) if (s && s.on) s.on('error', () => {});
for (const k of ['log', 'warn', 'error', 'info']) { const orig = console[k].bind(console); console[k] = (...a) => { try { orig(...a); } catch {} }; }
const analytics = require('./analytics');
const path = require('path');
const fs = require('fs');

// Must match VIEW_W / VIEW_H in src/game.js (in source pixels)
const VIEW_W = 280; // tree (left) + onboarding text column (right)
const VIEW_H = 340;

let win = null;
let tray = null;
let scale = 2;
let dragOffset = null;
let dragFrom = null;
let quitting = false;
let workerMethod = 'random'; // menu only, for testing (resets to Random on restart)

const statePath = () => path.join(app.getPath('userData'), 'state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}
function writeState(s) {
  try { fs.writeFileSync(statePath(), JSON.stringify(s, null, 2)); } catch (e) { console.error(e); }
}

function defaultScale() {
  const h = screen.getPrimaryDisplay().workAreaSize.height;
  return Math.max(1, Math.min(3, Math.floor((h * 0.95) / VIEW_H)));
}

function createWindow() {
  const saved = readState();
  scale = saved.scale || defaultScale();
  const wa = screen.getPrimaryDisplay().workArea;
  const w = VIEW_W * scale, h = VIEW_H * scale;
  // keep the window fully on screen (it got wider for the onboarding text)
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const x = clamp(saved.winX ?? wa.x + wa.width - w - 20, wa.x, wa.x + wa.width - w);
  const y = clamp(saved.winY ?? wa.y + wa.height - h, wa.y, wa.y + wa.height - h);

  win = new BrowserWindow({
    x, y, width: w, height: h,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'floating');
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); // Mac: stay on every Space
  // Start click-through; the page turns it off while the mouse is over the tree.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.send('command', 'scale', scale));
  // Print page errors/logs in the Terminal so problems are visible
  win.webContents.on('console-message', (e) => console.log('[page]', e.message));
  win.webContents.on('render-process-gone', (_e, d) => console.log('[page crashed]', d.reason));
  if (process.env.PET_DEBUG_SHOT) setTimeout(async () => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(process.env.PET_DEBUG_SHOT, img.toPNG());
    console.log('[debug] bounds', JSON.stringify(win.getBounds()), 'visible', win.isVisible());
    app.quit();
  }, 3000);
  win.on('moved', () => {
    const [wx, wy] = win.getPosition();
    writeState({ ...readState(), winX: wx, winY: wy });
  });
}

function setScale(s) {
  scale = s;
  const [x, y] = win.getPosition();
  const oldH = win.getSize()[1];
  const w = VIEW_W * s, h = VIEW_H * s;
  win.setBounds({ x, y: y + oldH - h, width: w, height: h }); // keep feet on the same spot
  win.webContents.send('command', 'scale', s);
  writeState({ ...readState(), scale: s });
  analytics.track('setting', { name: 'size', value: s });
  analytics.setPrefs({ size: s });
  buildMenu();
}

function send(cmd, arg) { if (win) win.webContents.send('command', cmd, arg); }

// ---- Collection: dims the whole screen 10% and shows the ASCII palm poster sitting on top of the Dock ----
const COLLECTION_WIDTH = 0.436; // poster width as a share of the screen width (from the Figma reference)
let collectionWin = null, collectionLayout = null, collectionOpenedAt = 0;
function openCollection() {
  if (collectionWin) { collectionWin.focus(); return; }
  const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const b = disp.bounds, wa = disp.workArea;
  // bottom = height of the Dock / taskbar at the bottom, so the poster's bottom edge sits right on it
  collectionLayout = { width: Math.round(b.width * COLLECTION_WIDTH), bottom: Math.max(0, (b.y + b.height) - (wa.y + wa.height)) };
  collectionWin = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    alwaysOnTop: true, hasShadow: false, skipTaskbar: true, fullscreenable: false, enableLargerThanScreen: true,
    show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  collectionWin.setAlwaysOnTop(true, 'screen-saver'); // above the menu bar, Dock and the tree
  if (process.platform !== 'win32') collectionWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  collectionWin.setBounds(b); // macOS may push a new window below the menu bar; put it back over the whole screen
  collectionWin.loadFile(path.join(__dirname, 'src', 'collection.html'));
  collectionWin.once('ready-to-show', () => {
    collectionWin.show(); collectionWin.focus(); collectionOpenedAt = Date.now();
    petAboveCollection(true);
  });
  // close when the user goes to another app - but NOT when they click the palm tree (it stays playable)
  collectionWin.on('blur', () => setTimeout(() => {
    const f = BrowserWindow.getFocusedWindow();
    if (collectionWin && f !== collectionWin && f !== win) closeCollection('blur');
  }, 80));
  collectionWin.on('closed', () => { collectionWin = null; });
}
function closeCollection(via) {
  if (!collectionWin) return;
  analytics.track('collection_close', { via, ms: collectionOpenedAt ? Date.now() - collectionOpenedAt : null });
  const w = collectionWin; collectionWin = null; collectionOpenedAt = 0;
  petAboveCollection(false);
  w.destroy();
}
// keep the palm tree on top of the darker layer so it can still be clicked / dragged while the Collection is open
function petAboveCollection(on) {
  if (!win) return;
  if (on) { win.setAlwaysOnTop(true, 'screen-saver', 1); win.moveTop(); }
  else win.setAlwaysOnTop(true, 'floating');
}
ipcMain.handle('collection-data', () => {
  const st = readState();
  return { unlocked: (st.game && st.game.treesTrimmed) || 0, seen: st.collectionSeen || 0, layout: collectionLayout };
});
ipcMain.on('collection-seen', (_e, n) => { writeState({ ...readState(), collectionSeen: n }); });
ipcMain.on('collection-close', (_e, via) => closeCollection(via || 'click'));

// ---- menu bar (tray) ----
// Every item has an id; instrument() records each click as a 'menu_click' event,
// and each (sub)menu records how long it was open.
let menuShownAt = 0;

function buildMenu() {
  const st = readState();
  const speed = st.regrow || 'normal';
  const setSpeed = (v) => { send('regrow-speed', v); analytics.track('setting', { name: 'regrowSpeed', value: v }); analytics.setPrefs({ regrowSpeed: v }); setTimeout(buildMenu, 100); };
  const template = [
    { label: 'Palm Tree Pet', enabled: false },
    { type: 'separator' },
    { id: 'collection', label: 'Collection', click: () => openCollection() },
    { type: 'separator' },
    { id: 'regrowSpeed', label: 'Regrow speed', submenu: [
      { id: 'regrowSpeed_fast', label: 'Fast (1 min)', type: 'radio', checked: speed === 'fast', click: () => setSpeed('fast') },
      { id: 'regrowSpeed_normal', label: 'Normal (10 min)', type: 'radio', checked: speed === 'normal', click: () => setSpeed('normal') },
      { id: 'regrowSpeed_slow', label: 'Slow (1 hour)', type: 'radio', checked: speed === 'slow', click: () => setSpeed('slow') },
    ] },
    { id: 'size', label: 'Size', submenu: [1, 2, 3].map((s) => ({ id: `size_${s}x`, label: `${s}x`, type: 'radio', checked: scale === s, click: () => setScale(s) })) },
    { id: 'sound', label: 'Sound', type: 'checkbox', checked: st.sound !== false, click: (m) => {
      send('sound', m.checked); analytics.track('setting', { name: 'sound', value: m.checked }); analytics.setPrefs({ sound: m.checked });
    } },
    { type: 'separator' },
    { id: 'testing', label: 'Testing', submenu: [
      { id: 'testing_restartOnboarding', label: 'Restart onboarding', click: () => send('restart-onboarding') },
      { id: 'testing_regrowAll', label: 'Regrow all old leaves now', click: () => send('regrow-all') },
      { id: 'testing_collectionAdd', label: 'Collection: +1 trimmed tree', click: () => send('collection-add') },
      { id: 'testing_collectionReset', label: 'Collection: reset to grey', click: () => { send('collection-reset'); writeState({ ...readState(), collectionSeen: 0 }); } },
      { id: 'testing_workerMethod', label: 'Worker method', submenu: [['random', 'Random'], ['back', 'Climb (back view)'], ['side', 'Climb (side view)'], ['bucket', 'Bucket truck']]
        .map(([id, label]) => ({ id: `testing_method_${id}`, label, type: 'radio', checked: workerMethod === id, click: () => {
          workerMethod = id; send('method', id); analytics.track('debug', { name: 'workerMethod', value: id });
        } })) },
    ] },
    { id: 'testData', label: 'Test data', submenu: [
      { label: `Tester ID: ${analytics.testerId}`, enabled: false },
      { label: analytics.uploadConfigured ? (analytics.lastUpload ? `Last sent: ${new Date(analytics.lastUpload).toLocaleString()}` : 'Not sent yet') : 'Upload not set up (export only)', enabled: false },
      { id: 'data_share', label: 'Share test data', type: 'checkbox', checked: analytics.enabled, click: (m) => { analytics.setEnabled(m.checked); buildMenu(); } },
      { id: 'data_sendNow', label: 'Send now', enabled: analytics.uploadConfigured && analytics.enabled, click: async () => { await analytics.upload(); buildMenu(); } },
      { id: 'data_export', label: 'Export test data to Desktop…', click: () => {
        analytics.track('export');
        const f = analytics.exportFile();
        shell.showItemInFolder(f);
      } },
    ] },
    { type: 'separator' },
    { id: 'quit', label: 'Quit', click: () => app.quit() },
  ];
  instrumentTemplate(template);
  const menu = Menu.buildFromTemplate(template);
  instrumentMenu(menu, 'main');
  tray.setContextMenu(menu);
  global.__pet = { tray, menu }; // handle for automated tests
}

// wrap each click so it is also recorded
function instrumentTemplate(items) {
  for (const it of items) {
    if (it.submenu) instrumentTemplate(it.submenu);
    if (it.id && typeof it.click === 'function') {
      const orig = it.click;
      it.click = (mi, ...rest) => {
        analytics.track('menu_click', {
          item: it.id,
          value: mi && (mi.type === 'checkbox' || mi.type === 'radio') ? mi.checked : undefined,
          msAfterOpen: menuShownAt ? Date.now() - menuShownAt : null,
        });
        return orig(mi, ...rest);
      };
    }
  }
}

// how long the main menu / each submenu stays open
function instrumentMenu(menu, name) {
  let shownAt = 0;
  menu.on('menu-will-show', () => {
    shownAt = Date.now();
    if (name === 'main') menuShownAt = shownAt;
  });
  menu.on('menu-will-close', () => {
    if (!shownAt) return;
    analytics.track(name === 'main' ? 'menu_open' : 'submenu_open', { name, ms: Date.now() - shownAt, shownAt: new Date(shownAt).toISOString() });
    shownAt = 0;
  });
  for (const it of menu.items) if (it.submenu) instrumentMenu(it.submenu, it.id || it.label);
}

function createTray() {
  // tray-icon.png (22px) + tray-icon@2x.png (44px, used on Retina screens automatically)
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray-icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('Palm Tree Pet');
  // Windows: left-click on the tray icon opens the menu too (Mac does this by itself)
  if (process.platform === 'win32') tray.on('click', () => tray.popUpContextMenu());
  // hovering the 🌴 icon in the menu bar (macOS/Windows). Quick fly-overs under 0.3 s are ignored.
  let hoverStart = 0;
  tray.on('mouse-enter', () => { hoverStart = Date.now(); });
  tray.on('mouse-leave', () => {
    if (!hoverStart) return;
    const ms = Date.now() - hoverStart; hoverStart = 0;
    if (ms >= 300) analytics.track('tray_hover', { ms });
  });
  buildMenu();
}

// ---- IPC from the page ----
ipcMain.on('click-through', (_e, on) => {
  if (win) win.setIgnoreMouseEvents(on, { forward: true });
});
ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  dragFrom = [wx, wy];
  dragOffset = { x: c.x - wx, y: c.y - wy };
});
ipcMain.on('drag-move', () => {
  if (!dragOffset) return;
  const c = screen.getCursorScreenPoint();
  win.setPosition(Math.round(c.x - dragOffset.x), Math.round(c.y - dragOffset.y));
});
ipcMain.on('drag-end', () => {
  if (!dragFrom || !win) return;
  const [x, y] = win.getPosition();
  const distance = Math.hypot(x - dragFrom[0], y - dragFrom[1]);
  if (distance > 3) {
    const d = screen.getDisplayNearestPoint({ x, y }).workArea;
    analytics.track('move', { distance: Math.round(distance), from: dragFrom, to: [x, y],
      // where on screen it ended up, 0..1 (left/top -> right/bottom)
      screenX: Math.round(((x - d.x) / d.width) * 100) / 100, screenY: Math.round(((y - d.y) / d.height) * 100) / 100 });
  }
  dragFrom = null;
});
ipcMain.on('track', (_e, type, data) => {
  if (typeof type === 'string' && /^[a-z_]+$/.test(type)) analytics.track(type, data || {});
});
ipcMain.handle('font', () => {
  const buf = fs.readFileSync(path.join(__dirname, 'assets', 'fonts', 'pixelify-sans-600.woff2'));
  return 'data:font/woff2;base64,' + buf.toString('base64');
});
ipcMain.handle('asset', (_e, name) => {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const buf = fs.readFileSync(path.join(__dirname, 'assets', name + '.png'));
  return 'data:image/png;base64,' + buf.toString('base64');
});
ipcMain.handle('load-state', () => readState().game || null);
ipcMain.on('save-state', (_e, game) => {
  const before = (readState().game || {}).treesTrimmed || 0;
  writeState({ ...readState(), game, regrow: game.regrowSpeed, sound: game.sound });
  // trimmed a whole tree while the Collection is open -> color the next palm right away
  if (collectionWin && (game.treesTrimmed || 0) !== before) collectionWin.webContents.send('collection-update', game.treesTrimmed || 0);
  analytics.setPrefs({ regrowSpeed: game.regrowSpeed, sound: game.sound });
});

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const { firstRun } = analytics.init(__dirname);
  const st = readState();
  createWindow();
  analytics.setPrefs({ size: scale, regrowSpeed: st.regrow || 'normal', sound: st.sound !== false });
  createTray();
  if (firstRun && !process.env.PET_DEBUG_SHOT) {
    dialog.showMessageBox({
      type: 'info',
      message: 'Thanks for testing Palm Tree Pet! 🌴',
      detail: 'This test version records how you use the palm tree (how long it stays open, when you move it, trim leaves, '
        + 'and change settings) for Cici\'s thesis research at ArtCenter.\n\n'
        + 'It does not see your screen, your files, or anything you type.\n\n'
        + `You can turn this off anytime: palm icon in the ${process.platform === 'win32' ? 'system tray (bottom-right, near the clock)' : 'menu bar'} → Test data → Share test data.`,
      buttons: ['OK'],
    });
  }
});
// on Quit: note the end of the session and try one last upload (max 4 s)
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault(); quitting = true;
  analytics.end();
  analytics.upload(undefined, 4000).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
