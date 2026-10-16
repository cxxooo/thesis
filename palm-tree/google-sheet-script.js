// Palm Tree Pet — receiver for test data (paste this into Google Apps Script)
//
// Setup (once, ~5 minutes):
//  1. Make a new Google Sheet (e.g. "Palm Tree Pet – test data").
//  2. In the sheet: Extensions → Apps Script. Delete what's there, paste this whole file, click Save.
//  3. Deploy → New deployment → gear icon → "Web app".
//       Execute as: Me        Who has access: Anyone
//     Click Deploy, allow the permissions, and copy the "Web app URL" (ends in /exec).
//  4. Put that URL in the app's analytics-config.json:  { "uploadUrl": "https://script.google.com/macros/s/.../exec" }
//
// The sheet gets three tabs, filled automatically:
//   summary  — one row per tester (time open, moves, trims, onboarding, preferences…), updated on every upload
//   events   — one row per thing that happened (trim, move, setting change…)
//   sessions — one row per app run (start, last seen, awake minutes)

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const id = String(body.testerId || 'unknown');

    // events: append new rows, skip any already received (same event id)
    const ev = sheet_(ss, 'events', ['received', 'testerId', 'version', 'eventId', 'time (UTC)', 'local time', 'hour', 'session', 'type', 'details']);
    const seen = new Set(ev.getLastRow() > 1 ? ev.getRange(2, 4, ev.getLastRow() - 1, 1).getValues().map((r) => r[0]) : []);
    const rows = (body.events || []).filter((x) => !seen.has(x.id)).map((x) => [
      new Date(), id, body.version, x.id, x.t, x.local, x.hour, x.s, x.type, JSON.stringify(x.d || {}),
    ]);
    if (rows.length) ev.getRange(ev.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    // summary: one row per tester (upsert)
    upsert_(ss, 'summary', 'testerId', id, Object.assign({ lastUpload: new Date() }, flatten_(body.summary || {})));

    // sessions: one row per app run (upsert by session id)
    (body.sessions || []).forEach((s) => upsert_(ss, 'sessions', 'sessionId', s.id, {
      testerId: id, start: s.start, lastSeen: s.lastSeen, awakeMin: s.awakeMin, screenLocks: s.locked, sleeps: s.sleeps,
      runMinutes: Math.round((new Date(s.lastSeen) - new Date(s.start)) / 60000),
    }));

    return ContentService.createTextOutput(JSON.stringify({ ok: true, added: rows.length })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// Visiting the URL in a browser shows this — handy to check the deployment works.
function doGet() {
  return ContentService.createTextOutput('Palm Tree Pet receiver is running.');
}

function sheet_(ss, name, header) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (header && sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
  return sh;
}

function upsert_(ss, name, keyName, key, obj) {
  const sh = sheet_(ss, name);
  const data = Object.assign({}, { [keyName]: key }, obj);
  let header = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].filter(String) : [];
  if (!header.length) header = [keyName];
  Object.keys(data).forEach((k) => { if (header.indexOf(k) < 0) header.push(k); });
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.setFrozenRows(1);
  const keys = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
  const idx = keys.indexOf(String(key));
  const row = idx < 0 ? sh.getLastRow() + 1 : idx + 2;
  sh.getRange(row, 1, 1, header.length).setValues([header.map((h) => (data[h] === undefined ? (idx < 0 ? '' : sh.getRange(row, header.indexOf(h) + 1).getValue()) : data[h]))]);
}

function flatten_(o, prefix, out) {
  out = out || {};
  Object.keys(o).forEach((k) => {
    const v = o[k], key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten_(v, key, out);
    else out[key] = Array.isArray(v) ? v.join(' / ') : v;
  });
  return out;
}
