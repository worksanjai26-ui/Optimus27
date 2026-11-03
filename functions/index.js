'use strict';
/* ------------------------------------------------------------------ *
 *  OPTIMUS '27 backend (Firebase Cloud Functions, 2nd gen).
 *
 *  - issueOptimusId        first Google sign-in: the server hands out the next Optimus ID
 *  - checkMembers          is this teammate real, spelled right and still free?
 *  - submitRegistration    creates the registration, one place per person per event
 *  - adminDeleteRegistration  frees the team's places again (admins only)
 *  - sheet triggers        keep a Google Sheet copy for the organisers
 *
 *  The website never writes registrations or profiles itself (firestore.rules
 *  forbid it), so every number, price and ID below is decided on the server.
 * ------------------------------------------------------------------ */
const { onCall, HttpsError } = require('firebase-functions/https');
const { onDocumentCreated, onDocumentDeleted } = require('firebase-functions/firestore');
const { setGlobalOptions } = require('firebase-functions/options');
const { defineString, defineBoolean } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { sheets: sheetsApi, auth: googleAuth } = require('@googleapis/sheets');
const { PASSES, slotKey, profileError, memberStatus, normalizeName, isOptimusId } = require('./rules');

initializeApp();
const db = getFirestore();

// Same Google accounts as ADMIN_EMAILS in src/backend.ts and firestore.rules.
const ADMINS = new Set(['srsanthosh7117@gmail.com', 'work.sanjai26@gmail.com']);

// Keep this region next to the Firestore database (Mumbai). Change both together.
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 });

// Set to true (functions/.env) once Firebase App Check is switched on for the website.
const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: false });
// The Google Sheet that mirrors the data. Leave empty to skip the sheet copy.
const SHEET_ID = defineString('SHEET_ID', { default: '' });

const callable = (handler) => onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, handler);

/* ------------------------------ helpers ------------------------------ */
const requireUser = (req) => {
  const t = req.auth && req.auth.token;
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in with Google first.');
  if (!t.email || t.email_verified !== true) throw new HttpsError('permission-denied', 'Your Google email is not verified.');
  return { uid: req.auth.uid, email: String(t.email).toLowerCase() };
};

const requireAdmin = (req) => {
  const user = requireUser(req);
  if (!ADMINS.has(user.email)) throw new HttpsError('permission-denied', 'Admins only.');
  return user;
};

const myProfile = async (uid) => {
  const snap = await db.doc(`profiles/${uid}`).get();
  if (!snap.exists) throw new HttpsError('failed-precondition', 'Get your Optimus ID first (My Pass page).');
  return snap.data();
};

/** Optimus ID -> { uid, name } for the IDs that exist. */
const loadByOptimusId = async (ids) => {
  const found = new Map();
  const unique = [...new Set(ids)];
  if (!unique.length) return found;
  const idSnaps = await db.getAll(...unique.map((id) => db.doc(`optimusIds/${id}`)));
  const owners = idSnaps.map((s, i) => (s.exists ? { id: unique[i], uid: s.data().uid } : null)).filter(Boolean);
  if (!owners.length) return found;
  const profSnaps = await db.getAll(...owners.map((o) => db.doc(`profiles/${o.uid}`)));
  profSnaps.forEach((s, i) => { if (s.exists) found.set(owners[i].id, { uid: owners[i].uid, name: s.data().name }); });
  return found;
};

const memberIds = (members) => (Array.isArray(members) ? members : []).map((m) => String((m && m.id) || '').trim().toUpperCase());

/* --------------------------- Optimus ID issue --------------------------- */
exports.issueOptimusId = callable(async (req) => {
  const user = requireUser(req);
  const name = normalizeName(req.data && req.data.name);
  const phone = String((req.data && req.data.phone) || '').trim();
  const college = String((req.data && req.data.college) || '').trim();

  const existing = await db.doc(`profiles/${user.uid}`).get();
  if (existing.exists) return existing.data();       // signing in again never makes a second ID

  const bad = profileError({ name, phone, college });
  if (bad) throw new HttpsError('invalid-argument', bad);

  const profileRef = db.doc(`profiles/${user.uid}`);
  const counterRef = db.doc('counters/optimusId');
  return db.runTransaction(async (tx) => {
    const [mine, counter] = await Promise.all([tx.get(profileRef), tx.get(counterRef)]);
    if (mine.exists) return mine.data();
    const next = (counter.exists ? counter.data().value : 0) + 1;
    const optimusId = `OPT27-${String(next).padStart(5, '0')}`;
    const profile = { uid: user.uid, optimusId, name, email: user.email, phone, college, createdAt: new Date().toISOString() };
    tx.set(counterRef, { value: next });
    tx.set(profileRef, profile);
    tx.set(db.doc(`optimusIds/${optimusId}`), { uid: user.uid });
    return profile;
  });
});

/* ----------------------------- team checks ------------------------------ */
exports.checkMembers = callable(async (req) => {
  const user = requireUser(req);
  const me = await myProfile(user.uid);
  const { pass, members } = req.data || {};
  const cfg = PASSES[pass];
  if (!cfg || !cfg.team) throw new HttpsError('invalid-argument', 'This pass has no team.');
  if (!Array.isArray(members) || members.length > cfg.team.max - 1) throw new HttpsError('invalid-argument', 'Too many team members.');

  const ids = memberIds(members);
  const known = await loadByOptimusId(ids.filter(isOptimusId));
  const seen = [me.optimusId];
  const results = [];
  for (let i = 0; i < members.length; i++) {
    let status = memberStatus(members[i], seen, (id) => known.get(id) || null);
    if (status === 'ok' && (await db.doc(`teamSlots/${slotKey(pass, null, ids[i])}`).get()).exists) status = 'busy';
    seen.push(ids[i]);
    results.push(status);
  }
  return { results };
});

/* ----------------------------- registration ----------------------------- */
exports.submitRegistration = callable(async (req) => {
  const user = requireUser(req);
  const me = await myProfile(user.uid);
  const { pass, day, teamName, members } = req.data || {};
  const cfg = PASSES[pass];
  if (!cfg) throw new HttpsError('invalid-argument', 'Unknown pass.');

  let dayN = null;
  if (cfg.pickDay) {
    if (day !== 0 && day !== 1) throw new HttpsError('invalid-argument', 'Choose Feb 4 or Feb 5.');
    dayN = day;
  }

  let team = String(teamName || '').trim();
  const list = Array.isArray(members) ? members : [];
  if (cfg.team) {
    if (team.length < 2 || team.length > 60) throw new HttpsError('invalid-argument', 'Please enter a team name (2 to 60 characters).');
    if (list.length < cfg.team.min - 1 || list.length > cfg.team.max - 1) {
      throw new HttpsError('invalid-argument', `A team has ${cfg.team.min} to ${cfg.team.max} members, including the leader.`);
    }
  } else {
    if (list.length) throw new HttpsError('invalid-argument', 'This pass is for one person.');
    team = '';
  }

  // Every teammate must exist, be spelled exactly as registered, and appear once.
  const ids = memberIds(list);
  const known = await loadByOptimusId(ids.filter(isOptimusId));
  const seen = [me.optimusId];
  const mates = list.map((m, i) => {
    const status = memberStatus(m, seen, (id) => known.get(id) || null);
    if (status !== 'ok') throw new HttpsError('failed-precondition', `Member ${i + 2}: ${status === 'duplicate' ? 'this ID is already in the team' : 'the Optimus ID and name do not match a participant'}.`);
    seen.push(ids[i]);
    return { id: ids[i], uid: known.get(ids[i]).uid, name: known.get(ids[i]).name };
  });

  const everyone = [{ id: me.optimusId, uid: me.uid, name: me.name }, ...mates];
  const slotRefs = everyone.map((p) => db.doc(`teamSlots/${slotKey(pass, dayN, p.id)}`));
  const regRef = db.collection('registrations').doc();
  const teamSize = everyone.length;

  await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(...slotRefs);
    const taken = snaps.findIndex((s) => s.exists);
    if (taken !== -1) {
      throw new HttpsError('already-exists', taken === 0
        ? 'You are already registered for this.'
        : `${everyone[taken].name} (${everyone[taken].id}) is already in another team for this event.`);
    }
    tx.set(regRef, {
      createdAt: new Date().toISOString(),
      pass, day: dayN, teamName: team || null, teamSize,
      leaderUid: me.uid, leaderId: me.optimusId, leaderName: me.name,
      memberIds: mates.map((m) => m.id), memberNames: mates.map((m) => m.name),
      memberUids: everyone.map((p) => p.uid),            // lets each member read their own registration
      email: me.email, phone: me.phone, college: me.college,
      amount: cfg.price * teamSize,                       // decided here, never by the browser
      status: 'payment-pending',
      slotKeys: slotRefs.map((r) => r.id)
    });
    slotRefs.forEach((r, i) => tx.set(r, { regId: regRef.id, uid: everyone[i].uid, optimusId: everyone[i].id, pass }));
  });
  return { id: regRef.id, amount: cfg.price * teamSize };
});

exports.adminDeleteRegistration = callable(async (req) => {
  requireAdmin(req);
  const id = String((req.data && req.data.id) || '');
  if (!id) throw new HttpsError('invalid-argument', 'Missing registration id.');
  const regRef = db.doc(`registrations/${id}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(regRef);
    if (!snap.exists) return;
    (snap.data().slotKeys || []).forEach((k) => tx.delete(db.doc(`teamSlots/${k}`)));
    tx.delete(regRef);
  });
  return { ok: true };
});

/* ----------------------------- Google Sheet ------------------------------ */
// The sheet is a read-only copy for organisers; Firestore stays the source of truth.
// Share the sheet (Editor) with this project's functions service account — see README-FIREBASE.md.
const PARTICIPANT_HEADERS = ['Optimus ID', 'Name', 'Email', 'Phone', 'College', 'Joined'];
const TEAM_HEADERS = ['Reg ID', 'Registered', 'Team name', 'Leader ID', 'Leader', 'Member 2', 'Member 3', 'Member 4',
  'Email', 'Phone', 'College', 'Day', 'Team size', 'Amount (INR)', 'Status'];
const DAY_LABEL = (r) =>
  r.pass === 'oneday' ? ['FEB 4', 'FEB 5'][r.day] || '' : r.pass === 'hackathon' ? 'FEB 4-5 (24 HOURS)' : 'FEB 4 & 5';

let sheetClient = null;
const sheetsClient = () => (sheetClient ??= sheetsApi({
  version: 'v4',
  auth: new googleAuth.GoogleAuth({ scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
}));
const knownTabs = new Set();

const ensureTab = async (spreadsheetId, title, headers) => {
  if (knownTabs.has(title)) return;
  const api = sheetsClient();
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  if (!meta.data.sheets.some((s) => s.properties.title === title)) {
    await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] } });
    await api.spreadsheets.values.update({
      spreadsheetId, range: `'${title}'!A1`, valueInputOption: 'RAW', requestBody: { values: [headers] }
    });
  }
  knownTabs.add(title);
};

const appendRow = async (title, headers, row) => {
  const spreadsheetId = SHEET_ID.value();
  if (!spreadsheetId) return;
  await ensureTab(spreadsheetId, title, headers);
  // RAW keeps every value as plain text, so nothing a participant types can run as a formula.
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId, range: `'${title}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] }
  });
};

const removeRowById = async (title, id) => {
  const spreadsheetId = SHEET_ID.value();
  if (!spreadsheetId) return;
  const api = sheetsClient();
  const col = await api.spreadsheets.values.get({ spreadsheetId, range: `'${title}'!A:A` });
  const index = (col.data.values || []).findIndex((r) => r[0] === id);
  if (index < 1) return;                                  // 0 is the header row
  const meta = await api.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties(sheetId,title)' });
  const tab = meta.data.sheets.find((s) => s.properties.title === title);
  if (!tab) return;
  await api.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ deleteDimension: { range: { sheetId: tab.properties.sheetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 } } }] }
  });
};

exports.sheetOnProfile = onDocumentCreated('profiles/{uid}', async (event) => {
  const p = event.data && event.data.data();
  if (!p) return;
  try {
    await appendRow('Participants', PARTICIPANT_HEADERS, [p.optimusId, p.name, p.email, p.phone, p.college, p.createdAt]);
  } catch (e) { logger.error('Sheet copy of a profile failed', e); }
});

exports.sheetOnRegistration = onDocumentCreated('registrations/{regId}', async (event) => {
  const r = event.data && event.data.data();
  if (!r) return;
  const cfg = PASSES[r.pass];
  if (!cfg) return;
  const mates = (r.memberIds || []).map((id, i) => `${r.memberNames[i]} (${id})`);
  try {
    await appendRow(cfg.tab, TEAM_HEADERS, [
      event.params.regId, r.createdAt, r.teamName || '', r.leaderId, r.leaderName,
      mates[0] || '', mates[1] || '', mates[2] || '',
      r.email, r.phone, r.college, DAY_LABEL(r), r.teamSize, r.amount, r.status
    ]);
  } catch (e) { logger.error('Sheet copy of a registration failed', e); }
});

exports.sheetOnRegistrationDeleted = onDocumentDeleted('registrations/{regId}', async (event) => {
  const r = event.data && event.data.data();
  const cfg = r && PASSES[r.pass];
  if (!cfg) return;
  try { await removeRowById(cfg.tab, event.params.regId); } catch (e) { logger.error('Removing a sheet row failed', e); }
});
