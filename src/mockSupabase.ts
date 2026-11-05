/* ------------------------------------------------------------------ *
 *  Development-only stand-in for Supabase, switched on with `?mock` on the dev server.
 *  It lets every screen (My Pass, the scanner, certificates) be seen and clicked through
 *  without a Supabase project. State lives in this browser's localStorage. It is never
 *  part of a production build (supabase.ts only imports it when import.meta.env.DEV).
 * ------------------------------------------------------------------ */
import { EVENT_SCHEDULE } from './schedule';

type Ev = { event_id: string; day: number; attended: boolean };
type State = {
  user: { id: string; email: string } | null;
  profile: Record<string, string> | null;
  passes: { pass: string; day: number | null; team_name: string | null }[];
  events: Ev[];
  entry: number[];
};
const KEY = 'optimus27.mock';
const load = (): State => {
  try { return { user: null, profile: null, passes: [], events: [], entry: [], ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { user: null, profile: null, passes: [], events: [], entry: [] }; }
};
const titleOf = (id: string) => id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const createMock = () => {
  let s = load();
  const save = () => localStorage.setItem(KEY, JSON.stringify(s));
  const listeners = new Set<(e: string, session: { user: State['user'] } | null) => void>();
  const emit = () => listeners.forEach((cb) => cb('SIGNED_IN', s.user ? { user: s.user } : null));

  const fail = (message: string) => ({ data: null, error: { code: 'P0001', message } });
  const ok = (data: unknown) => ({ data, error: null });

  const rpc = async (fn: string, a: Record<string, unknown> = {}) => {
    await new Promise((r) => setTimeout(r, 250));
    switch (fn) {
      case 'issue_optimus_id':
        s.profile = { optimus_id: 'OPT27-00001', name: a.p_name as string, email: s.user!.email, phone: a.p_phone as string, college: a.p_college as string, created_at: new Date().toISOString() };
        save();
        return ok(s.profile);
      case 'check_members':
        return ok((a.p_members as unknown[]).map(() => 'ok'));
      case 'submit_registration': {
        const pass = a.p_pass as string;
        const ids = pass === 'hackathon' ? ['hackathon']
          : pass === 'exclusive' ? Object.keys(EVENT_SCHEDULE).filter((id) => id !== 'hackathon')
          : (a.p_events as string[]);
        s.passes.push({ pass, day: (a.p_day as number | null) ?? null, team_name: (a.p_team_name as string | null) ?? null });
        ids.forEach((id) => { if (!s.events.some((e) => e.event_id === id)) s.events.push({ event_id: id, day: EVENT_SCHEDULE[id].day, attended: false }); });
        save();
        return ok({ id: 'mock-registration', amount: 300 });
      }
      case 'my_pass':
        return ok({ events: [...s.events].sort((x, y) => x.day - y.day), entry_days: s.entry, passes: s.passes });
      case 'qr_token': {
        // Same shape as the real one: the booked events travel inside the QR (two-letter codes).
        const codes = s.events.map((e) => e.event_id.slice(0, 2).toUpperCase()).join(',');
        return ok(`OPTIMUS27|OPT27-00001|${Math.floor(Date.now() / 1000) + 120}|${codes}|mockmockmockmockmock`);
      }
      case 'lookup_participant':
        return ok({
          optimus_id: 'OPT27-00001', name: s.profile?.name ?? 'ASHA RAMAN', college: s.profile?.college ?? 'KPR INSTITUTE',
          manual: !String(a.p_code).startsWith('OPTIMUS27|'),
          events: [...s.events].sort((x, y) => x.day - y.day).map((e) => ({ event_id: e.event_id, title: titleOf(e.event_id), day: e.day, attended: e.attended })),
          entry_days: s.entry
        });
      case 'unmark_attendance': {
        const day = a.p_day as number;
        let n = 0;
        if (a.p_mode === 'entry') { if (s.entry.includes(day)) { s.entry = s.entry.filter((d) => d !== day); n = 1; } }
        else s.events.forEach((e) => { if (e.event_id === a.p_event_id && e.attended) { e.attended = false; n = 1; } });
        save();
        return ok({ status: n ? 'unmarked' : 'none' });
      }
      case 'scan': {
        const day = a.p_day as number;
        const base = { optimus_id: 'OPT27-00001', name: s.profile?.name ?? 'ASHA R', college: s.profile?.college ?? 'KPR INSTITUTE', manual: (a.p_manual as boolean | null) ?? !String(a.p_code).startsWith('OPTIMUS27|'), day };
        if (a.p_mode === 'entry') {
          if (s.entry.includes(day)) return ok({ ...base, status: 'already', at: new Date().toISOString() });
          s.entry.push(day); save();
          return ok({ ...base, status: 'marked', at: new Date().toISOString(), attendance_id: 'mock-entry' });
        }
        const id = a.p_event_id as string;
        const ev = s.events.find((e) => e.event_id === id);
        const withEv = { ...base, event_id: id, event_title: titleOf(id) };
        if (!ev) return ok({ ...withEv, status: 'not-registered', registered: s.events.map((e) => titleOf(e.event_id)) });
        if (ev.day !== day) return ok({ ...withEv, status: 'wrong-day', event_day: ev.day });
        if (ev.attended) return ok({ ...withEv, status: 'already', at: new Date().toISOString() });
        ev.attended = true; save();
        return ok({ ...withEv, status: 'marked', at: new Date().toISOString(), attendance_id: 'mock-' + id, warnings: s.entry.includes(day) ? [] : ['no-gate-entry'] });
      }
      case 'undo_scan': {
        const id = String(a.p_attendance_id);
        if (id === 'mock-entry') s.entry = []; else s.events.forEach((e) => { if ('mock-' + e.event_id === id) e.attended = false; });
        save();
        return ok({ ok: true });
      }
      default:
        return fail('Not available in preview mode.');
    }
  };

  // from('table').select()...: every chained call returns the builder; awaiting it gives the table's rows.
  const from = (table: string) => {
    let single = false;
    const result = () => {
      if (table === 'profiles') return single ? s.profile : s.profile ? [s.profile] : [];
      if (table === 'staff') return single ? { role: 'admin', event_ids: [] } : [];
      const me = { optimus_id: 'OPT27-00001', name: s.profile?.name ?? 'ASHA RAMAN', college: s.profile?.college ?? 'KPR INSTITUTE', email: s.user?.email ?? '', phone: s.profile?.phone ?? '' };
      if (table === 'attendance' && s.profile) {
        const at = new Date().toISOString();
        const row = (kind: 'entry' | 'event', event_id: string | null, day: number) => ({ kind, event_id, day, scanned_at: at, scanned_by: 'gate@kpr.test', manual: true, profiles: me });
        return [...s.entry.map((d) => row('entry', null, d)), ...s.events.filter((e) => e.attended).map((e) => row('event', e.event_id, e.day))];
      }
      if (table === 'registrations' && s.profile) {
        return s.passes.map((p, i) => ({ id: 'mock-' + i, created_at: new Date().toISOString(), pass: p.pass, day: p.day, team_name: p.team_name, amount: 300, leader: me, registration_members: [{ profiles: me }] }));
      }
      return single ? null : [];
    };
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'returns', 'is', 'insert', 'update', 'delete', 'upsert']) builder[m] = () => builder;
    builder.maybeSingle = () => { single = true; return builder; };
    builder.then = (res: (v: unknown) => unknown) => Promise.resolve(ok(result())).then(res);
    return builder;
  };

  const auth = {
    onAuthStateChange: (cb: (e: string, session: { user: State['user'] } | null) => void) => {
      listeners.add(cb);
      setTimeout(() => cb('INITIAL_SESSION', s.user ? { user: s.user } : null), 0);
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
    },
    signInWithOAuth: async () => {
      s.user = { id: 'mock-user', email: 'srsanthosh7117@gmail.com' };
      save(); emit();
      return { error: null };
    },
    signOut: async () => { s = { user: null, profile: s.profile, passes: s.passes, events: s.events, entry: s.entry }; save(); emit(); return { error: null }; }
  };

  return { rpc, from, auth } as never;
};
