/* Firestore security rules, tested against the emulator:  npm run test:backend  */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  test('firestore rules (needs the emulator)', { skip: 'run through: npm run test:backend' }, () => {});
} else {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-optimus27-rules',
    firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }
  });

  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('profiles/uid-a').set({ uid: 'uid-a', optimusId: 'OPT27-00001', name: 'ANAND KUMAR' });
    await db.doc('profiles/uid-b').set({ uid: 'uid-b', optimusId: 'OPT27-00002', name: 'BHAVANA R' });
    await db.doc('registrations/r1').set({ leaderUid: 'uid-a', memberUids: ['uid-a', 'uid-b'], amount: 1000 });
    await db.doc('optimusIds/OPT27-00001').set({ uid: 'uid-a' });
    await db.doc('teamSlots/hackathon_OPT27-00001').set({ regId: 'r1' });
    await db.doc('counters/optimusId').set({ value: 2 });
    await db.doc('announcements/n1').set({ message: 'Hello', active: true, created_at: '2027-01-01' });
  });

  const anon = env.unauthenticatedContext().firestore();
  const user = (uid, email = `${uid}@example.com`, verified = true) =>
    env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
  const admin = user('uid-admin', 'work.sanjai26@gmail.com');

  test('strangers (not signed in) can read nothing private', async () => {
    await assertFails(anon.doc('profiles/uid-a').get());
    await assertFails(anon.doc('registrations/r1').get());
    await assertFails(anon.collection('registrations').get());
    await assertFails(anon.collection('profiles').get());
    await assertFails(anon.doc('counters/optimusId').get());
  });

  test('a participant sees only their own profile and registrations', async () => {
    await assertSucceeds(user('uid-a').doc('profiles/uid-a').get());
    await assertFails(user('uid-a').doc('profiles/uid-b').get());
    await assertFails(user('uid-a').collection('profiles').get());
    await assertSucceeds(user('uid-b').doc('registrations/r1').get());           // a member of the team
    await assertFails(user('uid-c').doc('registrations/r1').get());              // someone else
    await assertFails(user('uid-a').collection('registrations').get());          // no listing
  });

  test('the website can never write profiles, IDs, slots or registrations', async () => {
    const a = user('uid-a');
    await assertFails(a.doc('profiles/uid-a').set({ uid: 'uid-a', optimusId: 'OPT27-00099', name: 'X' }));
    await assertFails(a.doc('profiles/uid-a').update({ name: 'CHANGED' }));
    await assertFails(a.doc('registrations/r2').set({ leaderUid: 'uid-a', memberUids: ['uid-a'], amount: 1 }));
    await assertFails(a.doc('registrations/r1').delete());
    await assertFails(a.doc('optimusIds/OPT27-00050').set({ uid: 'uid-a' }));
    await assertFails(a.doc('teamSlots/hackathon_X').set({}));
    await assertFails(a.doc('counters/optimusId').set({ value: 0 }));
  });

  test('admins read everything but still cannot write registrations from the site', async () => {
    await assertSucceeds(admin.collection('registrations').get());
    await assertSucceeds(admin.collection('profiles').get());
    await assertSucceeds(admin.doc('profiles/uid-a').get());
    await assertFails(admin.doc('registrations/r1').delete());                    // deletion goes through the function
    await assertFails(admin.doc('teamSlots/hackathon_OPT27-00001').get());
    await assertFails(admin.doc('counters/optimusId').set({ value: 0 }));
  });

  test('being an admin needs the exact verified Google account', async () => {
    await assertFails(user('uid-evil', 'work.sanjai26@gmail.com', false).collection('registrations').get());  // email not verified
    await assertFails(user('uid-evil', 'work.sanjai26@gmail.com.evil.com').collection('registrations').get());
    await assertFails(user('uid-evil', 'someone@gmail.com').collection('registrations').get());
    await assertSucceeds(user('uid-s', 'srsanthosh7117@gmail.com').collection('registrations').get());
  });

  test('announcements: everyone reads, only admins write, with limits', async () => {
    await assertSucceeds(anon.doc('announcements/n1').get());
    await assertSucceeds(anon.collection('announcements').get());
    await assertFails(user('uid-a').collection('announcements').add({ message: 'hi', active: true, created_at: 'x' }));
    await assertSucceeds(admin.collection('announcements').add({ message: 'Doors open at 9', active: true, created_at: 'x' }));
    await assertFails(admin.collection('announcements').add({ message: '', active: true, created_at: 'x' }));
    await assertFails(admin.collection('announcements').add({ message: 'x'.repeat(301), active: true, created_at: 'x' }));
    await assertFails(admin.collection('announcements').add({ message: 'ok', active: true, created_at: 'x', extra: 1 }));
    await assertSucceeds(admin.doc('announcements/n1').update({ active: false }));
    await assertFails(anon.doc('announcements/n1').delete());
  });

  test('event edits: public to read, admin to write', async () => {
    await assertSucceeds(anon.collection('eventOverrides').get());
    await assertFails(user('uid-a').doc('eventOverrides/paper').set({ title: 'Hacked' }));
    await assertSucceeds(admin.doc('eventOverrides/paper').set({ title: 'Paper Presentation' }));
  });

  test.after(() => env.cleanup());
}
