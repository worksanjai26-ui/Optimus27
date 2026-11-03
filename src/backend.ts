/* ------------------------------------------------------------------ *
 *  Backend calls (Google sign-in, profiles, team registration, admin data).
 *
 *  Anything that must be trustworthy goes through a Cloud Function: issuing an
 *  Optimus ID, checking teammates, creating a registration. The browser can only
 *  read its own profile and its own registrations; everything else is refused by
 *  firestore.rules. The admin list below is just a hint for the UI — the rules and
 *  the functions check the signed-in Google account again on the server.
 * ------------------------------------------------------------------ */
import { FIREBASE_ENABLED, getAuthModule, getFirestoreModule, getFunctionsModule } from './firebase';
import type { Profile, MemberCheck } from './identity';
import type { Registration, Announcement, Overrides } from './adminData';

export { FIREBASE_ENABLED };
export const ADMIN_EMAILS = ['srsanthosh7117@gmail.com', 'work.sanjai26@gmail.com'];

export type AuthUser = { uid: string; email: string; displayName: string };
export const isAdminEmail = (email?: string | null) => !!email && ADMIN_EMAILS.includes(email.toLowerCase());

/* ---------------------------- Google sign-in --------------------------- */
const toUser = (u: { uid: string; email: string | null; displayName: string | null } | null): AuthUser | null =>
  u ? { uid: u.uid, email: (u.email ?? '').toLowerCase(), displayName: u.displayName ?? '' } : null;

/** Calls back with the signed-in Google user (or null) now and whenever it changes. Returns an unsubscribe. */
export const watchUser = (cb: (u: AuthUser | null) => void): (() => void) => {
  if (!FIREBASE_ENABLED) { cb(null); return () => {}; }
  let off = () => {};
  let stopped = false;
  getAuthModule().then(({ auth, mod }) => {
    if (stopped) return;
    off = mod.onAuthStateChanged(auth, (u) => cb(toUser(u)), () => cb(null));
  }, () => cb(null));
  return () => { stopped = true; off(); };
};

export const signInWithGoogle = async () => {
  const { auth, mod } = await getAuthModule();
  const provider = new mod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await mod.signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code;
    // Some phone browsers block the popup: fall back to a full-page sign-in.
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await mod.signInWithRedirect(auth, provider);
      return;
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    throw e;
  }
};

export const signOutUser = async () => {
  const { auth, mod } = await getAuthModule();
  await mod.signOut(auth);
};

/* --------------------------- callable functions ------------------------ */
const call = async <Req, Res>(name: string, data: Req): Promise<Res> => {
  const { fns, mod } = await getFunctionsModule();
  const res = await mod.httpsCallable<Req, Res>(fns, name)(data);
  return res.data;
};

/** A readable message from a failed backend call (Firebase wraps them as `functions/<code>`). */
export const backendError = (e: unknown): string => {
  const err = e as { code?: string; message?: string };
  if (err?.code?.startsWith('functions/') && err.message && !/^internal$/i.test(err.message)) return err.message;
  if (err?.code === 'functions/unauthenticated') return 'Please sign in with Google first.';
  if (err?.code === 'functions/unavailable' || err?.code === 'functions/deadline-exceeded') return 'The server is busy. Please try again in a moment.';
  return 'Something went wrong. Please try again.';
};

type RemoteProfile = { optimusId: string; name: string; email: string; phone: string; college: string; createdAt: string };
const toProfile = (p: RemoteProfile): Profile => ({
  id: p.optimusId, name: p.name, email: p.email, phone: p.phone, college: p.college, created_at: p.createdAt
});

/** The signed-in user's own profile (Firestore rules let a person read only their own), or null if none yet. */
export const fetchMyProfile = async (uid: string): Promise<Profile | null> => {
  const { db, mod } = await getFirestoreModule();
  const snap = await mod.getDoc(mod.doc(db, 'profiles', uid));
  return snap.exists() ? toProfile(snap.data() as RemoteProfile) : null;
};

/** First sign-in: the server issues the Optimus ID (nobody can pick or forge one). */
export const createMyProfile = async (data: { name: string; phone: string; college: string }): Promise<Profile> =>
  toProfile(await call<typeof data, RemoteProfile>('issueOptimusId', data));

export type MemberInput = { id: string; name: string };

/** Checks teammates on the server: 'ok', or why not. Never reveals anyone's details. */
export const checkTeamMembers = async (pass: string, members: MemberInput[]): Promise<MemberCheck[]> =>
  (await call<{ pass: string; members: MemberInput[] }, { results: MemberCheck[] }>('checkMembers', { pass, members })).results;

export const submitRegistration = (data: { pass: string; day: number | null; teamName: string | null; members: MemberInput[] }) =>
  call<typeof data, { id: string; amount: number }>('submitRegistration', data);

/* ------------------------------- admin data ---------------------------- */
type RemoteRegistration = {
  createdAt: string; pass: string; day: number | null; teamName: string | null;
  leaderId: string; leaderName: string; memberIds: string[]; memberNames: string[];
  email: string; phone: string; college: string; amount: number;
};
const fromRemote = (id: string, r: RemoteRegistration): Registration => ({
  id, created_at: r.createdAt, pass: r.pass, day: r.day, team_name: r.teamName,
  leader_name: `${r.leaderName} (${r.leaderId})`,
  members: r.memberNames.map((n, i) => `${n} (${r.memberIds[i]})`),
  email: r.email, phone: r.phone, college: r.college, amount: r.amount
});

export const adminListRegistrations = async (): Promise<Registration[]> => {
  const { db, mod } = await getFirestoreModule();
  const snap = await mod.getDocs(mod.query(mod.collection(db, 'registrations'), mod.orderBy('createdAt', 'desc')));
  return snap.docs.map((d) => fromRemote(d.id, d.data() as RemoteRegistration));
};

export const adminListProfiles = async (): Promise<Profile[]> => {
  const { db, mod } = await getFirestoreModule();
  const snap = await mod.getDocs(mod.query(mod.collection(db, 'profiles'), mod.orderBy('createdAt', 'asc')));
  return snap.docs.map((d) => toProfile(d.data() as RemoteProfile));
};

export const adminDeleteRegistration = (id: string) => call<{ id: string }, { ok: true }>('adminDeleteRegistration', { id });

/* --------------------- announcements and event edits ------------------- */
// Public to read (the site shows them to everyone), admin-only to change (firestore.rules).
export const remoteAnnouncements = async (): Promise<Announcement[]> => {
  const { db, mod } = await getFirestoreModule();
  const snap = await mod.getDocs(mod.collection(db, 'announcements'));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Announcement, 'id'>) }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
};
export const remoteAddAnnouncement = async (message: string) => {
  const { db, mod } = await getFirestoreModule();
  await mod.addDoc(mod.collection(db, 'announcements'), { message, active: true, created_at: new Date().toISOString() });
};
export const remoteSetAnnouncementActive = async (id: string, active: boolean) => {
  const { db, mod } = await getFirestoreModule();
  await mod.updateDoc(mod.doc(db, 'announcements', id), { active });
};
export const remoteDeleteAnnouncement = async (id: string) => {
  const { db, mod } = await getFirestoreModule();
  await mod.deleteDoc(mod.doc(db, 'announcements', id));
};

export const remoteOverrides = async (): Promise<Overrides> => {
  const { db, mod } = await getFirestoreModule();
  const snap = await mod.getDocs(mod.collection(db, 'eventOverrides'));
  const out: Overrides = {};
  snap.docs.forEach((d) => { out[d.id.replace(/~/g, ':')] = d.data() as Record<string, unknown>; });
  return out;
};
// Document ids cannot contain '/', and hero keys use ':' — stored with '~' instead.
const overrideDocId = (id: string) => id.replace(/:/g, '~');
export const remoteSaveOverride = async (id: string, data: Record<string, unknown>) => {
  const { db, mod } = await getFirestoreModule();
  await mod.setDoc(mod.doc(db, 'eventOverrides', overrideDocId(id)), data);
};
export const remoteDeleteOverride = async (id: string) => {
  const { db, mod } = await getFirestoreModule();
  await mod.deleteDoc(mod.doc(db, 'eventOverrides', overrideDocId(id)));
};
