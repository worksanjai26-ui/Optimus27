/* ------------------------------------------------------------------ *
 *  Frontend-only data for the /admin panel.
 *  Everything lives in this browser's localStorage, so the admin sees the
 *  registrations made on this same browser only, and the password check
 *  below can be bypassed by anyone who reads the JS. Swap these functions
 *  for real API calls when a backend is added.
 * ------------------------------------------------------------------ */

export type Registration = {
  id: string; created_at: string; pass: string; day: number | null;
  team_name: string | null; leader_name: string; members: string[];
  email: string; phone: string; college: string; amount: number;
};
export type Announcement = { id: string; created_at: string; message: string; active: boolean };
// Event id (e.g. 'paper') → edited fields; 'hero:<key>' → { prizePool }.
export type Overrides = Record<string, Record<string, unknown>>;

const KEYS = {
  registrations: 'optimus27.registrations',
  overrides: 'optimus27.eventOverrides',
  announcements: 'optimus27.announcements',
  session: 'optimus27.admin'
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
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

/* ---- registrations ---- */
export const listRegistrations = () => read<Registration[]>(KEYS.registrations, []);
export const addRegistration = (r: Omit<Registration, 'id' | 'created_at'>) =>
  write(KEYS.registrations, [{ ...r, id: newId(), created_at: new Date().toISOString() }, ...listRegistrations()]);
export const deleteRegistration = (id: string) =>
  write(KEYS.registrations, listRegistrations().filter((r) => r.id !== id));

/* ---- event overrides ---- */
export const listOverrides = () => read<Overrides>(KEYS.overrides, {});
export const saveOverride = (id: string, data: Record<string, unknown>) =>
  write(KEYS.overrides, { ...listOverrides(), [id]: data });
export const deleteOverride = (id: string) => {
  const { [id]: _, ...rest } = listOverrides();
  write(KEYS.overrides, rest);
};

/* ---- announcements ---- */
export const listAnnouncements = () => read<Announcement[]>(KEYS.announcements, []);
export const addAnnouncement = (message: string) =>
  write(KEYS.announcements, [{ id: newId(), created_at: new Date().toISOString(), message, active: true }, ...listAnnouncements()]);
export const setAnnouncementActive = (id: string, active: boolean) =>
  write(KEYS.announcements, listAnnouncements().map((a) => (a.id === id ? { ...a, active } : a)));
export const deleteAnnouncement = (id: string) =>
  write(KEYS.announcements, listAnnouncements().filter((a) => a.id !== id));

/* ---- visitor counter ---- */
// Counts visits from every device through Abacus, a free public counter API
// (no account; it stores only the numbers). Dev-server visits use separate
// counters so testing never inflates the live numbers.
const COUNTER = 'https://abacus.jasoncameron.dev';
const NAMESPACE = 'optimus27-kpriet';
const COUNTER_PREFIX = import.meta.env.DEV ? 'dev-' : '';
const SEEN_KEY = 'optimus27.visited';
export type VisitStats = { visits: number; visitors: number };

let visitRecorded = false;   // guards against StrictMode's double effect in dev
export const recordVisit = () => {
  if (visitRecorded) return;
  visitRecorded = true;
  const hit = (key: string) => fetch(`${COUNTER}/hit/${NAMESPACE}/${COUNTER_PREFIX}${key}`).catch(() => {});
  hit('visits');
  // A browser counts as a new visitor only the first time it opens the site.
  try {
    if (!localStorage.getItem(SEEN_KEY)) {
      localStorage.setItem(SEEN_KEY, '1');
      hit('visitors');
    }
  } catch { /* storage blocked: count the visit only */ }
};

const getCount = async (key: string) => {
  const res = await fetch(`${COUNTER}/get/${NAMESPACE}/${COUNTER_PREFIX}${key}`);
  if (res.status === 404) return 0;   // nobody has visited yet
  if (!res.ok) throw new Error(`Counter returned ${res.status}`);
  return ((await res.json()) as { value: number }).value;
};
export const getVisitStats = async (): Promise<VisitStats> => {
  const [visits, visitors] = await Promise.all([getCount('visits'), getCount('visitors')]);
  return { visits, visitors };
};

/* ---- admin login ---- */
// SHA-256 of the admin password, set in .env.local.
const PASSWORD_HASH = (import.meta.env.VITE_ADMIN_PASSWORD_SHA256 as string | undefined)?.trim().toLowerCase();
export const adminConfigured = !!PASSWORD_HASH;

const sha256 = async (text: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
};
export const signIn = async (password: string) => {
  if (!PASSWORD_HASH || !crypto.subtle) return false;
  const ok = (await sha256(password)) === PASSWORD_HASH;
  if (ok) try { sessionStorage.setItem(KEYS.session, PASSWORD_HASH); } catch { /* blocked */ }
  return ok;
};
export const isSignedIn = () => {
  try { return !!PASSWORD_HASH && sessionStorage.getItem(KEYS.session) === PASSWORD_HASH; } catch { return false; }
};
export const signOut = () => {
  try { sessionStorage.removeItem(KEYS.session); } catch { /* blocked */ }
};
