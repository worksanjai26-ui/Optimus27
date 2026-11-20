/* ------------------------------------------------------------------ *
 *  Optimus IDs, team checks and event attendance — DEMO data layer.
 *
 *  There is no backend yet, so everything here lives in this browser's
 *  localStorage: IDs are issued locally, teammates can only be checked
 *  against IDs created on the same browser, and attendance is sample
 *  data. The pages only call the functions below, so replacing their
 *  bodies with real API calls (Google sign-in, ID issuing, attendance
 *  lookups) is all the backend switch needs.
 * ------------------------------------------------------------------ */

export const IDENTITY_DEMO = true;

export type Profile = {
  id: string;            // e.g. OPT27-00142
  name: string;          // capital letters, as printed on certificates
  email: string;
  phone: string;
  college: string;
  created_at: string;
};

const KEYS = {
  profiles: 'optimus27.demo.profiles',
  current: 'optimus27.demo.currentId',
  counter: 'optimus27.demo.idCounter',
  attendance: 'optimus27.demo.attendance'
};

const read = <T>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
};
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
};

/* ---- ID format and name rules (shared by every form) ---- */
export const OPTIMUS_ID_RE = /^OPT27-\d{5}$/;
export const isOptimusId = (id: string) => OPTIMUS_ID_RE.test(id);
export const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');
export const isCapsName = (name: string) => /^[A-Z][A-Z .'-]*$/.test(name);

/* ---- profiles ---- */
const allProfiles = () => read<Record<string, Profile>>(KEYS.profiles, {});
export const findProfile = (id: string): Profile | null => allProfiles()[id] ?? null;

export const currentProfile = (): Profile | null => {
  const id = read<string | null>(KEYS.current, null);
  return id ? findProfile(id) : null;
};

// Issues the next Optimus ID. With a backend this becomes "sign in with Google".
export const createProfile = (data: Omit<Profile, 'id' | 'created_at'>): Profile => {
  const next = read<number>(KEYS.counter, 0) + 1;
  write(KEYS.counter, next);
  const profile: Profile = { ...data, id: `OPT27-${String(next).padStart(5, '0')}`, created_at: new Date().toISOString() };
  write(KEYS.profiles, { ...allProfiles(), [profile.id]: profile });
  write(KEYS.current, profile.id);
  return profile;
};

export const signOutProfile = () => write(KEYS.current, null);

// Text encoded in a person's QR code. The backend version adds a signature so QR codes can't be forged.
export const qrPayload = (p: Profile) => `OPTIMUS27|${p.id}`;

/* ---- teammate check ---- */
// 'busy' = already in another team for this event (only the server can know that).
export type MemberCheck = 'ok' | 'bad-format' | 'not-found' | 'name-mismatch' | 'duplicate' | 'busy';
export const checkMember = (id: string, name: string, others: string[]): MemberCheck => {
  if (!isOptimusId(id)) return 'bad-format';
  if (others.includes(id)) return 'duplicate';
  const p = findProfile(id);
  if (!p) return 'not-found';
  return p.name === normalizeName(name) ? 'ok' : 'name-mismatch';
};

/* ---- attendance ---- */
// Event ids attended by an Optimus ID. Demo: the recorded list, or a sample one-day-pass visit
// (one presentation, one workshop, one non-technical event) so certificates can be previewed.
export const SAMPLE_ATTENDANCE = ['paper', 'workshop-core', 'quiz-fun'];
export const attendedEvents = (id: string): string[] => {
  const recorded = read<Record<string, string[]>>(KEYS.attendance, {})[id];
  if (recorded) return recorded;
  return IDENTITY_DEMO ? SAMPLE_ATTENDANCE : [];
};
