/* ------------------------------------------------------------------ *
 *  Supabase connection (Google sign-in + Postgres).
 *
 *  The URL and anon key are public by design: they identify the project, they do not
 *  unlock anything. What a person can read or change is decided on the server by the
 *  row-level-security rules and functions in supabase/schema.sql. When they are not set
 *  (a fresh clone) BACKEND_ENABLED is false and the site falls back to the browser-only
 *  demo data, so it keeps working.
 *
 *  The library is imported lazily, so visitors who never sign in or register do not
 *  download it and the entry screen is not slowed down.
 * ------------------------------------------------------------------ */
import type { SupabaseClient } from '@supabase/supabase-js';

const env = import.meta.env;
const URL_ = env.VITE_SUPABASE_URL as string | undefined;
const KEY = env.VITE_SUPABASE_ANON_KEY as string | undefined;

// On the dev server with no Supabase keys, a fake backend (src/mockSupabase.ts) stands in so every screen can be
// tried without a project. `?nomock` turns it off (plain browser-only demo). It is never part of a production build.
const MOCK = import.meta.env.DEV && !(URL_ && KEY) && !new URLSearchParams(window.location.search).has('nomock');

export const BACKEND_ENABLED = MOCK || !!(URL_ && KEY);

/* "Remember me": with it on (the default) the sign-in survives closing the browser; with it off it lasts only
   until the browser is closed. The choice is stored next to the session, in this browser only. */
const REMEMBER_KEY = 'optimus27.remember';
export const setRemember = (on: boolean) => {
  try { localStorage.setItem(REMEMBER_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
};
const remembered = () => {
  try { return localStorage.getItem(REMEMBER_KEY) !== '0'; } catch { return true; }
};
const storage = {
  getItem: (k: string) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k: string, v: string) => {
    try {
      if (remembered()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
      else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
    } catch { /* storage blocked */ }
  },
  removeItem: (k: string) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* storage blocked */ } }
};

let clientPromise: Promise<SupabaseClient> | null = null;

export const getClient = (): Promise<SupabaseClient> => {
  if (!BACKEND_ENABLED) return Promise.reject(new Error('The backend is not configured'));
  if (MOCK) return (clientPromise ??= import('./mockSupabase').then((m) => m.createMock()));
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    // PKCE returns "?code=" instead of putting tokens in the URL hash, which this site uses for its pages.
    createClient(URL_!, KEY!, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage } })
  );
  return clientPromise;
};

/* Google sends the visitor back to the site root; this remembers which page (#mypass, #admin, #scan) they came from. */
const RETURN_KEY = 'optimus27.returnHash';
export const rememberReturnHash = () => {
  try { sessionStorage.setItem(RETURN_KEY, window.location.hash); } catch { /* storage blocked */ }
};
/** Call before the app renders: puts the page hash back after the Google round trip. */
export const restoreReturnHash = () => {
  try {
    const back = sessionStorage.getItem(RETURN_KEY);
    if (!back) return;
    sessionStorage.removeItem(RETURN_KEY);
    if (window.location.search.includes('code=') && !window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search + back);
    }
  } catch { /* storage blocked */ }
};
