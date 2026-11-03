'use strict';
/* End-to-end test of the callable functions against the Firestore emulator:
 *   npm run test:backend   (from the project root)                                  */
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('backend flow (needs the Firestore emulator)', { skip: 'run through: npm run test:backend' }, () => {});
  return;
}
process.env.GCLOUD_PROJECT = 'demo-optimus27';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'demo-optimus27' });
const fns = require('./index.js');

const req = (uid, email, data, verified = true) => ({ data, auth: { uid, token: { email, email_verified: verified } }, rawRequest: {} });
const ADMIN = 'work.sanjai26@gmail.com';
const rejects = (p, code) => assert.rejects(p, (e) => { assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); return true; });

const PEOPLE = {
  a: { name: 'ANAND KUMAR', phone: '9876543210', college: 'KPR Institute' },
  b: { name: 'BHAVANA R', phone: '9876543211', college: 'KPR Institute' },
  c: { name: 'CHANDRU M', phone: '9876543212', college: 'PSG Tech' },
  d: { name: 'DIVYA S', phone: '9876543213', college: 'CIT' }
};
const ids = {};
const signUp = async (k) => (ids[k] = (await fns.issueOptimusId.run(req(`uid-${k}`, `${k}@example.com`, PEOPLE[k]))).optimusId);

test('Optimus IDs are issued once, in order, by the server', async () => {
  assert.equal(await signUp('a'), 'OPT27-00001');
  assert.equal(await signUp('b'), 'OPT27-00002');
  assert.equal(await signUp('c'), 'OPT27-00003');
  assert.equal(await signUp('d'), 'OPT27-00004');
  assert.equal(await signUp('a'), 'OPT27-00001', 'signing in again must not issue a second ID');
  await rejects(fns.issueOptimusId.run({ data: PEOPLE.a, auth: null, rawRequest: {} }), 'unauthenticated');
  await rejects(fns.issueOptimusId.run(req('uid-x', 'x@example.com', PEOPLE.a, false)), 'permission-denied');
  await rejects(fns.issueOptimusId.run(req('uid-y', 'y@example.com', { ...PEOPLE.a, name: 'lower case' })), 'invalid-argument');
});

test('teammate checks tell the truth without leaking details', async () => {
  const check = (members) => fns.checkMembers.run(req('uid-a', 'a@example.com', { pass: 'hackathon', members }));
  assert.deepEqual((await check([{ id: ids.b, name: PEOPLE.b.name }])).results, ['ok']);
  assert.deepEqual((await check([{ id: ids.b, name: 'WRONG NAME' }])).results, ['not-found']);
  assert.deepEqual((await check([{ id: 'OPT27-09999', name: 'NOBODY' }])).results, ['not-found']);
  assert.deepEqual((await check([{ id: ids.a, name: PEOPLE.a.name }])).results, ['duplicate'], 'the leader cannot add themselves');
  assert.deepEqual((await check([{ id: 'abc', name: 'X' }])).results, ['bad-format']);
});

test('registration: server price, team size limits, one team per person', async () => {
  const reg = (uid, email, data) => fns.submitRegistration.run(req(uid, email, data));
  const team = (...k) => k.map((x) => ({ id: ids[x], name: PEOPLE[x].name }));

  await rejects(reg('uid-a', 'a@example.com', { pass: 'hackathon', teamName: 'ALPHA', members: [] }), 'invalid-argument');                // too small
  await rejects(reg('uid-a', 'a@example.com', { pass: 'hackathon', teamName: 'ALPHA', members: team('b', 'c', 'd', 'a') }), 'invalid-argument'); // too big
  await rejects(reg('uid-a', 'a@example.com', { pass: 'hackathon', teamName: '', members: team('b') }), 'invalid-argument');                     // no team name

  const ok = await reg('uid-a', 'a@example.com', { pass: 'hackathon', teamName: 'ALPHA', members: team('b', 'c'), amount: 1 });
  assert.equal(ok.amount, 1500, 'price is computed by the server (3 x 500), a client "amount" is ignored');

  // B is now in a team: cannot lead or join another hackathon team.
  await rejects(reg('uid-d', 'd@example.com', { pass: 'hackathon', teamName: 'BETA', members: team('b') }), 'already-exists');
  await rejects(reg('uid-b', 'b@example.com', { pass: 'hackathon', teamName: 'GAMMA', members: team('d') }), 'already-exists');
  const busy = await fns.checkMembers.run(req('uid-d', 'd@example.com', { pass: 'hackathon', members: team('b') }));
  assert.deepEqual(busy.results, ['busy']);

  // The same person may still take a different pass.
  const solo = await reg('uid-b', 'b@example.com', { pass: 'twoday', members: [] });
  assert.equal(solo.amount, 400);
  await rejects(reg('uid-b', 'b@example.com', { pass: 'twoday', members: [] }), 'already-exists');
  await rejects(reg('uid-b', 'b@example.com', { pass: 'exclusive', members: team('c') }), 'invalid-argument');
});

test('one-day pass is one per person per day', async () => {
  const day = (d) => fns.submitRegistration.run(req('uid-c', 'c@example.com', { pass: 'oneday', day: d, members: [] }));
  assert.equal((await day(0)).amount, 300);
  await rejects(day(0), 'already-exists');
  assert.equal((await day(1)).amount, 300);
  await rejects(day(2), 'invalid-argument');
});

test('only admins can delete, and deleting frees the team', async () => {
  const snap = await require('firebase-admin/firestore').getFirestore().collection('registrations').where('pass', '==', 'hackathon').get();
  assert.equal(snap.size, 1);
  const regId = snap.docs[0].id;
  await rejects(fns.adminDeleteRegistration.run(req('uid-a', 'a@example.com', { id: regId })), 'permission-denied');
  await rejects(fns.adminDeleteRegistration.run(req('uid-z', ADMIN, { id: regId }, false)), 'permission-denied');
  await fns.adminDeleteRegistration.run(req('uid-admin', ADMIN, { id: regId }));
  // B is free again.
  const again = await fns.submitRegistration.run(req('uid-d', 'd@example.com', { pass: 'hackathon', teamName: 'BETA', members: [{ id: ids.b, name: PEOPLE.b.name }] }));
  assert.equal(again.amount, 1000);
});
