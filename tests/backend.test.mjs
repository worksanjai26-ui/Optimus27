// Runs supabase/schema.sql in an in-process Postgres (PGlite) and checks the rules that matter:
// access control, one place per person per event, pass limits, QR scanning and attendance.
// Supabase's own pieces (the auth schema, the anon / authenticated roles) are stood in for below.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });

const SHIM = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create schema extensions;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, auth, extensions to anon, authenticated;
  -- no default privileges: like a new Supabase project, the schema must grant table access itself
`;

const users = {};
let n = 0;
const addUser = async (key, email) => {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  await db.query('insert into auth.users (id) values ($1)', [id]);
  users[key] = { id, email };
};

// Runs a query as a signed-in Supabase user (or as nobody when `who` is null).
const as = async (who, sql, params = []) => {
  await db.exec('reset role');
  if (who) {
    const u = users[who];
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: u.id, email: u.email, role: 'authenticated' })]);
    await db.exec('set role authenticated');
  } else {
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
    await db.exec('set role anon');
  }
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
};
const rpc = async (who, fn, ...args) => {
  const ph = args.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await as(who, `select public.${fn}(${ph}) as r`, args);
  return rows[0].r;
};
const fails = (promise, re) => assert.rejects(promise, re);

before(async () => {
  await db.exec(SHIM);
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.exec(`insert into public.staff values
    ('gate@kpr.test', 'gate', '{}'),
    ('quiz@kpr.test', 'coordinator', '{quiz-fun}'),
    ('hack@kpr.test', 'coordinator', '{hackathon}')`);
  for (const [k, e] of [['asha', 'asha@x.test'], ['ben', 'ben@x.test'], ['cara', 'cara@x.test'], ['dev', 'dev@x.test'], ['eli', 'eli@x.test'],
    ['admin', 'srsanthosh7117@gmail.com'], ['gate', 'gate@kpr.test'], ['quiz', 'quiz@kpr.test'], ['hack', 'hack@kpr.test'], ['rando', 'rando@x.test']]) {
    await addUser(k, e);
  }
  for (const [k, name] of [['asha', 'ASHA R'], ['ben', 'BEN K'], ['cara', 'CARA S'], ['dev', 'DEV P'], ['eli', 'ELI M']]) {
    await rpc(k, 'issue_optimus_id', name, '9876543210', 'KPR');
  }
});

const idOf = async (k) => (await as('admin', 'select optimus_id from public.profiles where user_id = $1', [users[k].id]))[0].optimus_id;

test('Optimus IDs are issued once, in order, and names must be capitals', async () => {
  assert.equal(await idOf('asha'), 'OPT27-00001');
  assert.equal((await rpc('asha', 'issue_optimus_id', 'SOMEONE ELSE', '1234567', 'X')).optimus_id, 'OPT27-00001');
  await addUser('zed', 'zed@x.test');
  await fails(rpc('zed', 'issue_optimus_id', 'lower case', '9876543210', 'KPR'), /CAPITAL/);
  await fails(as(null, `select public.issue_optimus_id('A','1','K')`), /permission denied/);   // signed-out callers cannot call it
});

test('strangers see nothing; people see only their own rows; admins see all', async () => {
  assert.deepEqual(await as(null, 'select * from public.events limit 1').then((r) => r.length), 1);   // events are public
  await fails(as(null, 'select * from public.profiles'), /permission denied/);
  await fails(as(null, 'select * from public.attendance'), /permission denied/);
  await fails(as(null, 'select * from public.staff'), /permission denied/);
  assert.equal((await as('asha', 'select * from public.profiles')).length, 1);
  assert.equal((await as('admin', 'select * from public.profiles')).length, 5);
  await fails(as('asha', `update public.profiles set name = 'X'`), /permission denied/);
  await fails(as('asha', `insert into public.attendance (user_id, kind, day, scanned_by) values ($1, 'entry', 0, 'me')`, [users.asha.id]), /permission denied/);
  await fails(as('asha', 'select * from public.app_secrets'), /permission denied/);
  await fails(as('asha', 'select * from public.staff where email = $1', ['x']).then(() => as('asha', `insert into public.staff values ('asha@x.test','admin','{}')`)), /row-level security/);
});

test('hackathon: team of 2-4, names must match, one team per person', async () => {
  const [b, c] = [await idOf('ben'), await idOf('cara')];
  assert.deepEqual(await rpc('asha', 'check_members', 'hackathon', JSON.stringify([{ id: b, name: 'BEN K' }, { id: c, name: 'WRONG' }, { id: 'nope', name: '' }])),
    ['ok', 'name-mismatch', 'bad-format']);
  await fails(rpc('asha', 'submit_registration', 'hackathon', null, 'Solo', '[]', null), /2 to 4/);
  await fails(rpc('asha', 'submit_registration', 'hackathon', null, 'Bad', JSON.stringify([{ id: b, name: 'NOT BEN' }]), null), /do not match/);
  await fails(rpc('asha', 'submit_registration', 'hackathon', null, 'X', JSON.stringify([{ id: b, name: 'BEN K' }]), null), /team name/);
  const reg = await rpc('asha', 'submit_registration', 'hackathon', null, 'Cyber Knights', JSON.stringify([{ id: b, name: 'BEN K' }, { id: c, name: 'CARA S' }]), null);
  assert.equal(reg.amount, 1500);   // price is worked out on the server: 3 x 500
  assert.equal((await as('ben', 'select * from public.registrations')).length, 1);   // a member can see the team
  assert.equal((await as('dev', 'select * from public.registrations')).length, 0);
  // ben is already in a team: neither he nor anyone adding him can double-book
  assert.deepEqual(await rpc('dev', 'check_members', 'hackathon', JSON.stringify([{ id: b, name: 'BEN K' }])), ['busy']);
  await fails(rpc('dev', 'submit_registration', 'hackathon', null, 'Other', JSON.stringify([{ id: b, name: 'BEN K' }]), null), /already in a team/);
  await fails(rpc('ben', 'submit_registration', 'hackathon', null, 'Again', JSON.stringify([{ id: await idOf('dev'), name: 'DEV P' }]), null), /already in a team/);
  // every member is booked into the hackathon
  const mine = await rpc('cara', 'my_pass');
  assert.deepEqual(mine.events.map((e) => e.event_id), ['hackathon']);
});

test('one-day pass: pick events on your day, one of each kind', async () => {
  await fails(rpc('dev', 'submit_registration', 'oneday', 0, null, null, []), /Pick the events/);
  await fails(rpc('dev', 'submit_registration', 'oneday', null, null, null, ['paper']), /Choose your day/);
  await fails(rpc('dev', 'submit_registration', 'oneday', 0, null, null, ['poster']), /chosen day/);
  await fails(rpc('dev', 'submit_registration', 'oneday', 0, null, null, ['paper', 'project']), /at most 1 presentation/);
  await fails(rpc('dev', 'submit_registration', 'oneday', 0, null, null, ['hackathon']), /not available/);
  await fails(rpc('dev', 'submit_registration', 'oneday', 0, null, JSON.stringify([{ id: 'x', name: 'y' }]), ['paper']), /Only the hackathon/);
  const reg = await rpc('dev', 'submit_registration', 'oneday', 0, null, null, ['paper', 'workshop-core', 'quiz-fun']);
  assert.equal(reg.amount, 300);
  const mine = await rpc('dev', 'my_pass');
  assert.deepEqual(mine.events.map((e) => e.event_id).sort(), ['paper', 'quiz-fun', 'workshop-core']);
  await fails(rpc('dev', 'submit_registration', 'twoday', null, null, null, ['paper']), /already hold a fest pass/);
});

test('two-day pass: two of each kind; exclusive: everything but the hackathon', async () => {
  await fails(rpc('eli', 'submit_registration', 'twoday', null, null, null, ['paper', 'project', 'poster']), /at most 2 presentation/);
  const two = await rpc('eli', 'submit_registration', 'twoday', null, null, null, ['paper', 'poster', 'gaming', 'quiz-fun', 'workshop-core', 'workshop-track-2']);
  assert.equal(two.amount, 400);
  await addUser('fay', 'fay@x.test');
  await rpc('fay', 'issue_optimus_id', 'FAY T', '9876543210', 'KPR');
  const ex = await rpc('fay', 'submit_registration', 'exclusive', null, null, null, null);
  assert.equal(ex.amount, 500);
  assert.equal((await rpc('fay', 'my_pass')).events.length, 10);
});

test('admin delete frees the places again', async () => {
  const reg = (await as('admin', `select id from public.registrations where pass = 'hackathon'`))[0].id;
  await fails(rpc('asha', 'admin_delete_registration', reg), /Not allowed/);
  await rpc('admin', 'admin_delete_registration', reg);
  assert.deepEqual(await rpc('dev', 'check_members', 'hackathon', JSON.stringify([{ id: await idOf('ben'), name: 'BEN K' }])), ['ok']);
  // put the team back for the scanning tests below
  await rpc('asha', 'submit_registration', 'hackathon', null, 'Cyber Knights', JSON.stringify([{ id: await idOf('ben'), name: 'BEN K' }]), null);
});

test('QR tokens: signed, short-lived, and the scan rules hold', async () => {
  const token = await rpc('dev', 'qr_token');
  assert.match(token, /^OPTIMUS27\|OPT27-\d{5}\|\d+\|[A-Z0-9,]*\|[0-9a-f]{20}$/);
  // the QR itself carries the booked events (dev booked Paper, Technical Workshop, Quiz & Fun), in day order
  assert.deepEqual(token.split('|')[3].split(',').sort(), ['PA', 'QZ', 'W1']);
  assert.equal((await rpc('ben', 'qr_token')).split('|')[3], 'HK');

  // only staff can scan; coordinators only their own events
  await fails(rpc('rando', 'scan', token, 'entry', null, 0), /not on the staff list/);
  await fails(rpc('dev', 'scan', token, 'entry', null, 0), /not on the staff list/);
  await fails(rpc('quiz', 'scan', token, 'event', 'paper', 0), /not assigned/);

  // forged and expired codes are refused
  const parts = token.split('|');
  await fails(rpc('gate', 'scan', `${parts[0]}|${parts[1]}|${parts[2]}|${parts[3]}|${'0'.repeat(20)}`, 'entry', null, 0), /not valid/);
  await fails(rpc('gate', 'scan', `${parts[0]}|OPT27-00001|${parts[2]}|${parts[3]}|${parts[4]}`, 'entry', null, 0), /not valid/);
  // adding an event to the QR by hand breaks the signature
  await fails(rpc('gate', 'scan', `${parts[0]}|${parts[1]}|${parts[2]}|${parts[3]},GM|${parts[4]}`, 'entry', null, 0), /not valid/);
  const old = (await db.query(`select 'OPTIMUS27|' || $1 || '|' || (extract(epoch from now())::bigint - 5) || '||' ||
      substr(encode(extensions.hmac($1 || '|' || (extract(epoch from now())::bigint - 5) || '|', (select value from public.app_secrets where name = 'qr_key'), 'sha256'), 'hex'), 1, 20) as t`,
    [await idOf('dev')])).rows[0].t;
  await fails(rpc('gate', 'scan', old, 'entry', null, 0), /expired/);

  // event scan before the gate: allowed, with a warning (require_gate is off)
  const first = await rpc('quiz', 'scan', token, 'event', 'quiz-fun', 0);
  assert.equal(first.status, 'marked');
  assert.deepEqual(first.warnings, ['no-gate-entry']);
  assert.equal((await rpc('quiz', 'scan', token, 'event', 'quiz-fun', 0)).status, 'already');

  // gate entry, twice
  assert.equal((await rpc('gate', 'scan', token, 'entry', null, 0)).status, 'marked');
  assert.equal((await rpc('gate', 'scan', token, 'entry', null, 0)).status, 'already');

  // an event the person never booked, and the wrong day
  assert.equal((await rpc('admin', 'scan', token, 'event', 'gaming', 0)).status, 'not-registered');
  const nr = await rpc('admin', 'scan', token, 'event', 'gaming', 0);
  assert.deepEqual(nr.registered.sort(), ['Paper Presentation', 'Quiz & Fun Events', 'Technical Workshop']);
  assert.equal((await rpc('admin', 'scan', token, 'event', 'paper', 1)).status, 'wrong-day');
  assert.equal((await rpc('admin', 'scan', token, 'event', 'paper', 0)).status, 'marked');

  // manual fallback by Optimus ID, flagged as manual
  const manual = await rpc('gate', 'scan', await idOf('asha'), 'entry', null, 0);
  assert.equal(manual.status, 'marked');
  assert.equal(manual.manual, true);

  // hackathon: scanned once, at the start, by its coordinator, for every member
  const bToken = await rpc('ben', 'qr_token');
  assert.equal((await rpc('hack', 'scan', bToken, 'event', 'hackathon', 0)).status, 'marked');
  assert.equal((await rpc('hack', 'scan', bToken, 'event', 'hackathon', 0)).status, 'already');
});

test('require_gate setting blocks event scans without gate entry', async () => {
  await db.exec(`update public.settings set value = 'true' where key = 'require_gate'`);
  const t = await rpc('asha', 'qr_token');
  // asha has gate entry (manual above) but is booked only into the hackathon (day 0)
  assert.equal((await rpc('hack', 'scan', t, 'event', 'hackathon', 0)).status, 'marked');
  const e = await rpc('eli', 'qr_token');
  assert.equal((await rpc('admin', 'scan', e, 'event', 'paper', 0)).status, 'no-gate-entry');
  await db.exec(`update public.settings set value = 'false' where key = 'require_gate'`);
});

test('attendance shows on My Pass, undo works, and certificates follow attendance', async () => {
  const mine = await rpc('dev', 'my_pass');
  const att = Object.fromEntries(mine.events.map((e) => [e.event_id, e.attended]));
  assert.deepEqual(att, { paper: true, 'quiz-fun': true, 'workshop-core': false });
  assert.deepEqual(mine.entry_days, [0]);

  const scanId = (await as('admin', `select id from public.attendance where kind = 'event' and event_id = 'paper'`))[0].id;
  await fails(rpc('dev', 'undo_scan', scanId), /not on the staff list/);
  await fails(rpc('quiz', 'undo_scan', scanId), /cannot undo/);
  await rpc('admin', 'undo_scan', scanId);
  assert.equal((await rpc('dev', 'my_pass')).events.find((e) => e.event_id === 'paper').attended, false);
  // ...and can be scanned again afterwards, leaving the voided row as a record
  const t = await rpc('dev', 'qr_token');
  assert.equal((await rpc('admin', 'scan', t, 'event', 'paper', 0)).status, 'marked');
  assert.equal((await as('admin', `select count(*)::int as c from public.attendance where event_id = 'paper'`))[0].c, 2);
});

test('coordinator flow: look up the QR, then YES or NO', async () => {
  const token = await rpc('dev', 'qr_token');
  // lookup records nothing and shows the booked events with their status
  const before = (await as('admin', `select count(*)::int as c from public.attendance`))[0].c;
  const found = await rpc('quiz', 'lookup_participant', token);
  assert.equal((await as('admin', `select count(*)::int as c from public.attendance`))[0].c, before);
  assert.equal(found.name, 'DEV P');
  assert.equal(found.manual, false);
  assert.deepEqual(found.events.map((e) => [e.event_id, e.attended]).sort(), [['paper', true], ['quiz-fun', true], ['workshop-core', false]]);
  await fails(rpc('dev', 'lookup_participant', token), /not on the staff list/);
  await fails(rpc('gate', 'lookup_participant', 'garbage'), /Unreadable/);
  assert.equal((await rpc('gate', 'lookup_participant', await idOf('dev'))).manual, true);   // typed ID

  // YES: the coordinator confirms using the ID from the lookup, and it still counts as a QR scan
  const yes = await rpc('admin', 'scan', found.optimus_id, 'event', 'workshop-core', 0, false);
  assert.equal(yes.status, 'marked');
  assert.equal(yes.manual, false);
  assert.equal((await rpc('dev', 'my_pass')).events.find((e) => e.event_id === 'workshop-core').attended, true);

  // NO: takes it back; doing it twice is harmless; the wrong coordinator cannot
  await fails(rpc('quiz', 'unmark_attendance', found.optimus_id, 'event', 'workshop-core', 0), /not assigned/);
  await fails(rpc('dev', 'unmark_attendance', found.optimus_id, 'entry', null, 0), /not on the staff list/);
  assert.equal((await rpc('admin', 'unmark_attendance', found.optimus_id, 'event', 'workshop-core', 0)).status, 'unmarked');
  assert.equal((await rpc('admin', 'unmark_attendance', found.optimus_id, 'event', 'workshop-core', 0)).status, 'none');
  assert.equal((await rpc('dev', 'my_pass')).events.find((e) => e.event_id === 'workshop-core').attended, false);
  // other events of the same person are untouched
  assert.equal((await rpc('dev', 'my_pass')).events.find((e) => e.event_id === 'quiz-fun').attended, true);
});
