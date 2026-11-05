/* ------------------------------------------------------------------ *
 *  Backend calls (Google sign-in, profiles, registration, QR, attendance, admin data).
 *
 *  Anything that must be trustworthy is a Postgres function in supabase/schema.sql: issuing
 *  an Optimus ID, checking teammates, creating a registration, signing a QR, recording a scan.
 *  The browser can only read its own rows; everything else is refused by row-level security.
 *  The admin list below is just a hint for the UI: the database checks the signed-in Google
 *  account again on every request.
 * ------------------------------------------------------------------ */
import { BACKEND_ENABLED, getClient, rememberReturnHash, setRemember } from './supabase';
import type { Profile, MemberCheck } from './identity';
import type { Registration, Announcement, Overrides } from './adminData';
import type { MyPassData } from './schedule';

export { BACKEND_ENABLED };
export const ADMIN_EMAILS = ['srsanthosh7117@gmail.com', 'work.sanjai26@gmail.com'];

export type AuthUser = { uid: string; email: string; displayName: string };
export const isAdminEmail = (email?: string | null) => !!email && ADMIN_EMAILS.includes(email.toLowerCase());

/* ---------------------------- Google sign-in --------------------------- */
type RawUser = { id: string; email?: string | null; user_metadata?: { full_name?: string; name?: string } };
const toUser = (u: RawUser | null | undefined): AuthUser | null =>
  u ? { uid: u.id, email: (u.email ?? '').toLowerCase(), displayName: u.user_metadata?.full_name ?? u.user_metadata?.name ?? '' } : null;

/** Calls back with the signed-in Google user (or null) now and whenever it changes. Returns an unsubscribe. */
export const watchUser = (cb: (u: AuthUser | null) => void): (() => void) => {
  if (!BACKEND_ENABLED) { cb(null); return () => {}; }
  let off = () => {};
  let stopped = false;
  getClient().then((sb) => {
    if (stopped) return;
    // The callback must not call back into Supabase synchronously, so hand the user over on the next tick.
    const { data } = sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => { if (!stopped) cb(toUser(session?.user)); }, 0); });
    off = () => data.subscription.unsubscribe();
  }, () => cb(null));
  return () => { stopped = true; off(); };
};

export const signInWithGoogle = async (remember = true) => {
  const sb = await getClient();
  setRemember(remember);
  rememberReturnHash();
  // A full-page sign-in works on every phone browser (popups are often blocked). Google returns to the site root.
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname, queryParams: { prompt: 'select_account' } }
  });
  if (error) throw error;
};

export const signOutUser = async () => {
  const sb = await getClient();
  await sb.auth.signOut();
};

/* ------------------------------- errors -------------------------------- */
/** A readable message from a failed backend call. Messages we raise ourselves in SQL are safe to show as they are. */
export const backendError = (e: unknown): string => {
  const err = e as { code?: string; message?: string; status?: number };
  if (err?.code === 'P0001' && err.message) return err.message;           // raise exception '...'
  if (err?.code === '42501' || err?.status === 401 || err?.status === 403) return 'Please sign in with Google first.';
  if (/failed to fetch|network/i.test(err?.message ?? '')) return 'Cannot reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
};

const rpc = async <T>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const sb = await getClient();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data as T;
};
const table = async () => (await getClient());
const must = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

/* ------------------------------ participants --------------------------- */
type RemoteProfile = { optimus_id: string; name: string; email: string; phone: string; college: string; created_at: string };
const toProfile = (p: RemoteProfile): Profile => ({
  id: p.optimus_id, name: p.name, email: p.email, phone: p.phone, college: p.college, created_at: p.created_at
});

/** The signed-in user's own profile (row-level security lets a person read only their own), or null if none yet. */
export const fetchMyProfile = async (uid: string): Promise<Profile | null> => {
  const sb = await table();
  const row = must(await sb.from('profiles').select('optimus_id,name,email,phone,college,created_at').eq('user_id', uid).maybeSingle<RemoteProfile>());
  return row ? toProfile(row) : null;
};

/** First sign-in: the server issues the Optimus ID (nobody can pick or forge one). */
export const createMyProfile = async (data: { name: string; phone: string; college: string }): Promise<Profile> =>
  toProfile(await rpc<RemoteProfile>('issue_optimus_id', { p_name: data.name, p_phone: data.phone, p_college: data.college }));

export type MemberInput = { id: string; name: string };

/** Checks teammates on the server: 'ok', or why not. Never reveals anyone's details. */
export const checkTeamMembers = (pass: string, members: MemberInput[]): Promise<MemberCheck[]> =>
  rpc<MemberCheck[]>('check_members', { p_pass: pass, p_members: members });

export const submitRegistration = (data: { pass: string; day: number | null; teamName: string | null; members: MemberInput[]; events: string[] }) =>
  rpc<{ id: string; amount: number }>('submit_registration', {
    p_pass: data.pass, p_day: data.day, p_team_name: data.teamName, p_members: data.members, p_events: data.events
  });

/* --------------------------- My Pass and the QR ------------------------- */
type RemotePass = {
  events: { event_id: string; day: number; attended: boolean }[];
  entry_days: number[];
  passes: { pass: string; day: number | null; team_name: string | null }[];
};
export const fetchMyPass = async (): Promise<MyPassData> => {
  const r = await rpc<RemotePass>('my_pass');
  return {
    events: r.events.map((e) => ({ eventId: e.event_id, day: e.day, attended: e.attended })),
    entryDays: r.entry_days,
    passes: r.passes.map((p) => ({ pass: p.pass, day: p.day, teamName: p.team_name }))
  };
};

/** A freshly signed QR payload (valid for two minutes). */
export const fetchQrToken = () => rpc<string>('qr_token');

/* -------------------------------- scanning ----------------------------- */
export type StaffInfo = { role: 'admin' | 'coordinator' | 'gate'; eventIds: string[] };
/** The signed-in person's staff role, or null if they are not on the staff list. */
export const fetchMyStaff = async (email: string): Promise<StaffInfo | null> => {
  const sb = await table();
  const row = must(await sb.from('staff').select('role,event_ids').eq('email', email.toLowerCase()).maybeSingle<{ role: StaffInfo['role']; event_ids: string[] }>());
  return row ? { role: row.role, eventIds: row.event_ids } : null;
};

export type ScanResult = {
  status: 'marked' | 'already' | 'not-registered' | 'wrong-day' | 'no-gate-entry';
  optimus_id: string; name: string; college: string; manual: boolean; day: number;
  event_id?: string; event_title?: string; event_day?: number;
  at?: string; attendance_id?: string; warnings?: string[]; registered?: string[];
};
export const scanCode = (code: string, mode: 'entry' | 'event', eventId: string | null, day: number) =>
  rpc<ScanResult>('scan', { p_code: code, p_mode: mode, p_event_id: eventId, p_day: day });
export const undoScan = (attendanceId: string) => rpc<{ ok: true }>('undo_scan', { p_attendance_id: attendanceId });

/** Step one of a scan: who is this and what are they booked for? Records nothing. */
export type Lookup = {
  optimus_id: string; name: string; college: string; manual: boolean;
  events: { event_id: string; title: string; day: number; attended: boolean }[];
  entry_days: number[];
};
export const lookupParticipant = (code: string) => rpc<Lookup>('lookup_participant', { p_code: code });

/** The YES button. `viaQr` is false when the coordinator typed the ID, so the record is flagged manual. */
export const markPresent = (optimusId: string, mode: 'entry' | 'event', eventId: string | null, day: number, viaQr: boolean) =>
  rpc<ScanResult>('scan', { p_code: optimusId, p_mode: mode, p_event_id: eventId, p_day: day, p_manual: !viaQr });
/** The NO button: no attendance (takes back a mark if there was one). */
export const markAbsent = (optimusId: string, mode: 'entry' | 'event', eventId: string | null, day: number) =>
  rpc<{ status: 'unmarked' | 'none' }>('unmark_attendance', { p_optimus_id: optimusId, p_mode: mode, p_event_id: eventId, p_day: day });

/* ------------------------------- admin data ---------------------------- */
type Person = { optimus_id: string; name: string };
type RemoteRegistration = {
  id: string; created_at: string; pass: string; day: number | null; team_name: string | null; amount: number;
  leader: (Person & { email: string; phone: string; college: string }) | null;
  registration_members: { profiles: Person | null }[];
};
const fromRemote = (r: RemoteRegistration): Registration => {
  const others = r.registration_members
    .map((m) => m.profiles)
    .filter((p): p is Person => !!p && p.optimus_id !== r.leader?.optimus_id)
    .sort((a, b) => a.optimus_id.localeCompare(b.optimus_id));
  return {
    id: r.id, created_at: r.created_at, pass: r.pass, day: r.day, team_name: r.team_name,
    leader_name: r.leader ? `${r.leader.name} (${r.leader.optimus_id})` : '',
    members: others.map((p) => `${p.name} (${p.optimus_id})`),
    email: r.leader?.email ?? '', phone: r.leader?.phone ?? '', college: r.leader?.college ?? '', amount: r.amount
  };
};

export const adminListRegistrations = async (): Promise<Registration[]> => {
  const sb = await table();
  const rows = must(await sb.from('registrations')
    .select('id,created_at,pass,day,team_name,amount,leader:profiles!leader_id(optimus_id,name,email,phone,college),registration_members(profiles(optimus_id,name))')
    .order('created_at', { ascending: false }).returns<RemoteRegistration[]>());
  return rows.map(fromRemote);
};

export const adminListProfiles = async (): Promise<Profile[]> => {
  const sb = await table();
  return must(await sb.from('profiles').select('optimus_id,name,email,phone,college,created_at').order('created_at', { ascending: true }).returns<RemoteProfile[]>()).map(toProfile);
};

export type AttendanceRow = {
  optimusId: string; name: string; college: string; kind: 'entry' | 'event'; eventId: string | null; day: number;
  at: string; by: string; manual: boolean;
};
/** Every recorded scan (undone ones are left out). */
export const adminListAttendance = async (): Promise<AttendanceRow[]> => {
  const sb = await table();
  type Raw = { kind: 'entry' | 'event'; event_id: string | null; day: number; scanned_at: string; scanned_by: string; manual: boolean; profiles: { optimus_id: string; name: string; college: string } | null };
  const rows = must(await sb.from('attendance')
    .select('kind,event_id,day,scanned_at,scanned_by,manual,profiles(optimus_id,name,college)')
    .is('voided_at', null).order('scanned_at', { ascending: true }).returns<Raw[]>());
  return rows.map((a) => ({
    optimusId: a.profiles?.optimus_id ?? '', name: a.profiles?.name ?? '', college: a.profiles?.college ?? '',
    kind: a.kind, eventId: a.event_id, day: a.day, at: a.scanned_at, by: a.scanned_by, manual: a.manual
  }));
};

export const adminDeleteRegistration = (id: string) => rpc<{ ok: true }>('admin_delete_registration', { p_id: id });

/* --------------------- announcements and event edits ------------------- */
// Public to read (the site shows them to everyone), admin-only to change (row-level security).
export const remoteAnnouncements = async (): Promise<Announcement[]> => {
  const sb = await table();
  return must(await sb.from('announcements').select('id,message,active,created_at').order('created_at', { ascending: false }).returns<Announcement[]>());
};
export const remoteAddAnnouncement = async (message: string) => {
  const sb = await table();
  must(await sb.from('announcements').insert({ message, active: true }));
};
export const remoteSetAnnouncementActive = async (id: string, active: boolean) => {
  const sb = await table();
  must(await sb.from('announcements').update({ active }).eq('id', id));
};
export const remoteDeleteAnnouncement = async (id: string) => {
  const sb = await table();
  must(await sb.from('announcements').delete().eq('id', id));
};

export const remoteOverrides = async (): Promise<Overrides> => {
  const sb = await table();
  const rows = must(await sb.from('event_overrides').select('id,data').returns<{ id: string; data: Record<string, unknown> }[]>());
  return Object.fromEntries(rows.map((r) => [r.id, r.data]));
};
export const remoteSaveOverride = async (id: string, data: Record<string, unknown>) => {
  const sb = await table();
  must(await sb.from('event_overrides').upsert({ id, data }));
};
export const remoteDeleteOverride = async (id: string) => {
  const sb = await table();
  must(await sb.from('event_overrides').delete().eq('id', id));
};
