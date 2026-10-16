// Palm Tree Pet — test data collection (for user research)
//
// What it records: how long the app runs, how often the tree is moved, settings, trims,
// onboarding progress, worker methods, regrowth. NO screen content, files, names or typing.
//
// Where it goes:
//   1. Always saved locally:  ~/Library/Application Support/palm-tree-pet/analytics/
//        events.jsonl   one line per event
//        sessions.json  each app run: start, last seen, awake minutes
//   2. Uploaded to your Google Sheet every few minutes (if UPLOAD_URL in analytics-config.json is set)
//   3. "Export test data…" in the menu writes everything to one .json file on the Desktop (backup / AirDrop)

const { app, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const HEARTBEAT_MS = 60 * 1000;      // count awake minutes once a minute
const UPLOAD_EVERY_MS = 10 * 60 * 1000;

let dir, eventsFile, sessionsFile, metaFile;
let meta = {};        // { testerId, enabled, uploadedLines, firstSeen }
let session = null;   // current run
let seq = 0;
let config = { uploadUrl: '' };
let awake = true;
let uploading = false;

const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJSON = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v, null, 2)); } catch (e) { console.error('[analytics]', e.message); } };
const localTime = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function init(appDir) {
  dir = path.join(app.getPath('userData'), 'analytics');
  fs.mkdirSync(dir, { recursive: true });
  eventsFile = path.join(dir, 'events.jsonl');
  sessionsFile = path.join(dir, 'sessions.json');
  metaFile = path.join(dir, 'meta.json');
  config = { uploadUrl: '', ...readJSON(path.join(appDir, 'analytics-config.json'), {}) };

  meta = readJSON(metaFile, {});
  const firstRun = !meta.testerId;
  if (firstRun) {
    meta = { testerId: crypto.randomBytes(3).toString('hex'), enabled: true, uploadedLines: 0, firstSeen: new Date().toISOString() };
    writeJSON(metaFile, meta);
  }

  session = { id: crypto.randomBytes(4).toString('hex'), start: new Date().toISOString(), lastSeen: new Date().toISOString(), awakeMin: 0, locked: 0, sleeps: 0 };
  saveSession();
  track('app_start', { firstRun, version: app.getVersion(), os: process.platform, osVersion: process.getSystemVersion?.() || '' });

  // awake vs. asleep / locked screen
  powerMonitor.on('suspend', () => { awake = false; session.sleeps++; track('computer_sleep'); });
  powerMonitor.on('resume', () => { awake = true; track('computer_wake'); });
  powerMonitor.on('lock-screen', () => { awake = false; session.locked++; track('screen_lock'); });
  powerMonitor.on('unlock-screen', () => { awake = true; track('screen_unlock'); });

  setInterval(() => {
    session.lastSeen = new Date().toISOString();
    if (awake) session.awakeMin++;
    saveSession();
  }, HEARTBEAT_MS);
  setInterval(() => upload(), UPLOAD_EVERY_MS);
  setTimeout(() => upload(), 30 * 1000); // first upload shortly after launch
  return { firstRun };
}

function saveSession() {
  const all = readJSON(sessionsFile, []);
  const i = all.findIndex((s) => s.id === session.id);
  if (i >= 0) all[i] = session; else all.push(session);
  writeJSON(sessionsFile, all);
}

// Record one event. data: small plain object.
function track(type, data = {}) {
  if (!meta.enabled || !eventsFile) return;
  const d = new Date();
  const ev = { id: `${session.id}-${seq++}`, t: d.toISOString(), local: localTime(d), hour: d.getHours(), s: session.id, type, d: data };
  try { fs.appendFileSync(eventsFile, JSON.stringify(ev) + '\n'); } catch (e) { console.error('[analytics]', e.message); }
}

function readEvents() {
  try { return fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

// Everything your advisor asked for, rolled up per tester.
function summary(prefs = {}) {
  const ev = readEvents();
  const sessions = readJSON(sessionsFile, []);
  const count = (type) => ev.filter((e) => e.type === type).length;
  const trims = ev.filter((e) => e.type === 'trim');
  const by = (arr, key, keys) => Object.fromEntries(keys.map((k) => [k, arr.filter((e) => e.d[key] === k).length]));
  const waits = trims.map((e) => e.d.waitedMin).filter((v) => typeof v === 'number');
  const onbDone = ev.filter((e) => e.type === 'onboarding_done');
  const cards = ev.filter((e) => e.type === 'onboarding_card').map((e) => e.d.card);
  const minutes = (s) => Math.max(0, (new Date(s.lastSeen) - new Date(s.start)) / 60000);
  const hours = Array(24).fill(0); trims.forEach((e) => hours[e.hour]++);
  const moves = ev.filter((e) => e.type === 'move');
  return {
    testerId: meta.testerId,
    appVersion: app.getVersion(),
    firstSeen: meta.firstSeen,
    lastSeen: sessions.length ? sessions[sessions.length - 1].lastSeen : '',
    daysUsed: new Set(sessions.map((s) => s.start.slice(0, 10))).size,
    // time on desktop
    sessions: sessions.length,
    totalRunMinutes: Math.round(sessions.reduce((a, s) => a + minutes(s), 0)),
    awakeMinutes: sessions.reduce((a, s) => a + (s.awakeMin || 0), 0),
    avgSessionMinutes: sessions.length ? Math.round(sessions.reduce((a, s) => a + minutes(s), 0) / sessions.length) : 0,
    // moving the tree
    moves: moves.length,
    moveDistancePx: Math.round(moves.reduce((a, e) => a + (e.d.distance || 0), 0)),
    // trimming
    leafClicks: count('leaf_click'),
    trims: trims.length,
    trimsByLeaf: [1, 2, 3, 4, 5].map((n) => trims.filter((e) => e.d.leaf === n).length).join(' / '),
    trimsByMethod: by(trims, 'method', ['back', 'side', 'bucket']),
    workerVisits: count('worker_visit'),
    trimsByHour: hours.join(' '),
    // regrowth
    leavesRegrown: count('leaf_regrown'),
    regrowAllUsed: count('regrow_all'),
    avgMinutesBeforeTrim: waits.length ? Math.round((waits.reduce((a, v) => a + v, 0) / waits.length) * 10) / 10 : '',
    maxMinutesBeforeTrim: waits.length ? Math.round(Math.max(...waits) * 10) / 10 : '',
    // onboarding
    onboardingMaxCard: cards.length ? Math.max(...cards) : (count('onboarding_start') ? 1 : 0),
    onboardingCompleted: onbDone.length > 0,
    onboardingClosedBy: onbDone.length ? onbDone[0].d.via : '',
    onboardingSeconds: onbDone.length ? onbDone[0].d.seconds : '',
    onboardingRestarts: ev.filter((e) => e.type === 'onboarding_start' && e.d.restart).length,
    // menu bar 🌴 icon
    ...menuStats(ev),
    // preferences (current) + how often changed
    prefSize: prefs.size, prefRegrowSpeed: prefs.regrowSpeed, prefSound: prefs.sound,
    settingChanges: count('setting'),
    sizeChanges: ev.filter((e) => e.type === 'setting' && e.d.name === 'size').length,
    regrowSpeedChanges: ev.filter((e) => e.type === 'setting' && e.d.name === 'regrowSpeed').length,
    soundChanges: ev.filter((e) => e.type === 'setting' && e.d.name === 'sound').length,
  };
}

// Menu bar usage: icon hovers, menu opens (and how long), opens with no click, clicks per item.
const MENU_ITEMS = ['regrowSpeed_fast', 'regrowSpeed_normal', 'regrowSpeed_slow', 'size_1x', 'size_2x', 'size_3x', 'sound',
  'testing_restartOnboarding', 'testing_regrowAll', 'testing_method_random', 'testing_method_back', 'testing_method_side', 'testing_method_bucket',
  'data_share', 'data_sendNow', 'data_export', 'quit'];
const SUBMENUS = ['regrowSpeed', 'size', 'testing', 'testing_workerMethod', 'testData'];
function menuStats(ev) {
  const hovers = ev.filter((e) => e.type === 'tray_hover');
  const opens = ev.filter((e) => e.type === 'menu_open');
  const clicks = ev.filter((e) => e.type === 'menu_click');
  const subs = ev.filter((e) => e.type === 'submenu_open');
  const sec = (arr) => Math.round(arr.reduce((a, e) => a + (e.d.ms || 0), 0) / 100) / 10;
  // each click belongs to the most recent menu open before it (clicks are reported just after the menu closes)
  const shown = opens.map((o) => new Date(o.d.shownAt).getTime()).sort((x, y) => x - y);
  const used = new Set();
  clicks.forEach((c) => {
    const t = new Date(c.t).getTime();
    let k = -1; shown.forEach((v, i) => { if (v <= t) k = i; });
    if (k >= 0) used.add(k);
  });
  const noClick = shown.length - used.size;
  return {
    trayHovers: hovers.length,
    trayHoverSeconds: sec(hovers),
    trayAvgHoverSeconds: hovers.length ? Math.round((sec(hovers) / hovers.length) * 10) / 10 : '',
    menuOpens: opens.length,
    menuOpenSeconds: sec(opens),
    menuAvgOpenSeconds: opens.length ? Math.round((sec(opens) / opens.length) * 10) / 10 : '',
    menuOpensWithoutClick: noClick,
    menuClicks: clicks.length,
    menuClicksByItem: Object.fromEntries(MENU_ITEMS.map((k) => [k, clicks.filter((c) => c.d.item === k).length])),
    submenuOpensByName: Object.fromEntries(SUBMENUS.map((k) => [k, subs.filter((x) => x.d.name === k).length])),
    submenuOpenSeconds: Object.fromEntries(SUBMENUS.map((k) => [k, sec(subs.filter((x) => x.d.name === k))])),
  };
}

// Send new events + the summary to the Google Sheet. Safe to call often; resends on failure.
async function upload(prefs, timeoutMs = 15000) {
  if (!meta.enabled || !config.uploadUrl || uploading) return false;
  uploading = true;
  try {
    const ev = readEvents();
    const fresh = ev.slice(meta.uploadedLines || 0);
    const body = { testerId: meta.testerId, version: app.getVersion(), events: fresh, summary: summary(prefs || lastPrefs), sessions: readJSON(sessionsFile, []) };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(config.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    meta.uploadedLines = ev.length; meta.lastUpload = new Date().toISOString();
    writeJSON(metaFile, meta);
    return true;
  } catch (e) {
    console.log('[analytics] upload failed (will retry):', e.message);
    return false;
  } finally { uploading = false; }
}

let lastPrefs = {};
function setPrefs(p) { lastPrefs = { ...lastPrefs, ...p }; }

// One file with everything, saved to the Desktop. Returns the path.
function exportFile() {
  const file = path.join(app.getPath('desktop'), `PalmTreePet-data-${meta.testerId}-${localTime().slice(0, 10)}.json`);
  writeJSON(file, { exportedAt: new Date().toISOString(), summary: summary(lastPrefs), sessions: readJSON(sessionsFile, []), events: readEvents() });
  return file;
}

function setEnabled(on) {
  if (!on) track('data_sharing', { on: false });
  meta.enabled = on; writeJSON(metaFile, meta);
  if (on) track('data_sharing', { on: true });
}

function end() {
  if (!session) return;
  session.lastSeen = new Date().toISOString();
  saveSession();
  track('app_quit', { minutes: Math.round((new Date(session.lastSeen) - new Date(session.start)) / 60000) });
}

module.exports = {
  init, track, upload, exportFile, end, setPrefs, setEnabled, summary,
  get testerId() { return meta.testerId; }, get enabled() { return meta.enabled; },
  get uploadConfigured() { return !!config.uploadUrl; }, get lastUpload() { return meta.lastUpload; },
};
