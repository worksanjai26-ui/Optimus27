import React, { useState, useEffect } from 'react';
import {
  Shield, LogOut, Users, Calendar, Megaphone, Download, Trash2, Search, RotateCcw, Save, Eye, UserCheck
} from 'lucide-react';
import { Registration, Announcement, Overrides, VisitStats, getVisitStats } from './adminData';
import {
  FIREBASE_ENABLED, AuthUser, watchUser, signInWithGoogle, signOutUser, isAdminEmail, backendError,
  adminListRegistrations, adminListProfiles, adminDeleteRegistration,
  remoteOverrides, remoteSaveOverride, remoteDeleteOverride,
  remoteAnnouncements, remoteAddAnnouncement, remoteSetAnnouncementActive, remoteDeleteAnnouncement
} from './backend';
import { downloadWorkbook } from './exportExcel';
import { HEROES, PASSES, THEME, FEST_DAYS, EDITABLE_EVENT_FIELDS, inr, EventItem, PassId } from './App';

/* ------------------------------------------------------------------ *
 *  /admin — OPTIMUS '27 control room (frontend-only, see adminData.ts).
 * ------------------------------------------------------------------ */

const input = 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500';
const label = 'text-[10px] font-mono tracking-widest text-slate-400 block mb-1';
const passName = (id: string) => PASSES.find((p) => p.id === id)?.name ?? id;

function Shell({ children, onSignOut }: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 bg-slate-950/90 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" />
            <span className="font-black tracking-[0.2em] text-sm">OPTIMUS '27 <span className="text-amber-400">ADMIN</span></span>
          </div>
          {onSignOut && (
            <button onClick={onSignOut} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-mono">
              <LogOut className="w-3.5 h-3.5" /> SIGN OUT
            </button>
          )}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}

/* ============================== LOGIN ============================= */
// There is no password anywhere in this site. Admins sign in with their Google account; whether that
// account may see anything is decided by the server (firestore.rules and the Cloud Functions).
function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = () => {
    setBusy(true);
    setError('');
    signInWithGoogle().catch((e) => setError(backendError(e))).finally(() => setBusy(false));
  };
  return (
    <div className="max-w-sm mx-auto mt-16 p-6 rounded-2xl bg-slate-900 border border-amber-500/50 shadow-[0_0_45px_rgba(250,204,21,0.15)] space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-black tracking-wide uppercase">Admin sign in</h1>
        <p className="text-xs text-slate-400">Restricted to OPTIMUS '27 organisers.</p>
      </div>
      {error && <p role="alert" className="text-xs text-rose-400 font-mono">{error}</p>}
      <button onClick={go} disabled={busy} className="w-full py-3 rounded-xl bg-white text-slate-900 text-xs font-black tracking-widest disabled:opacity-60 flex items-center justify-center gap-2">
        <span className="text-base leading-none">G</span> {busy ? 'OPENING GOOGLE…' : 'SIGN IN WITH GOOGLE'}
      </button>
    </div>
  );
}

/* ============================ VISITORS ============================ */
function VisitorStats() {
  const [stats, setStats] = useState<VisitStats | null>(null);
  const [error, setError] = useState(false);
  const load = () => {
    setError(false);
    getVisitStats().then(setStats, () => setError(true));
  };
  useEffect(load, []);

  const card = (Icon: typeof Eye, title: string, value: number | undefined, note: string) => (
    <div className="p-5 rounded-2xl bg-slate-900 border border-cyan-500/50 shadow-[0_0_45px_rgba(34,211,238,0.12)] flex items-center gap-4">
      <div className="w-12 h-12 shrink-0 rounded-xl bg-slate-950 border border-cyan-500/50 p-3 text-cyan-400"><Icon className="w-full h-full" /></div>
      <div>
        <div className={label}>{title}</div>
        <div className="text-3xl font-black text-cyan-400">{value == null ? '—' : value.toLocaleString('en-IN')}</div>
        <div className="text-[11px] text-slate-500">{note}</div>
      </div>
    </div>
  );

  return (
    <div className="mb-6 space-y-2">
      <div className="grid sm:grid-cols-2 gap-3">
        {card(UserCheck, 'UNIQUE VISITORS', stats?.visitors, 'Different browsers that opened the site')}
        {card(Eye, 'TOTAL VISITS', stats?.visits, 'Every time the site was opened')}
      </div>
      <div className="flex items-center gap-3 text-[11px] font-mono text-slate-500">
        {error && <span className="text-rose-400">Couldn't reach the visitor counter.</span>}
        {import.meta.env.DEV && <span>DEV SERVER: showing test counts, separate from the live site.</span>}
        <button onClick={load} className="inline-flex items-center gap-1 hover:text-white"><RotateCcw className="w-3 h-3" /> REFRESH</button>
      </div>
    </div>
  );
}

/* ========================== REGISTRATIONS ========================= */
// A leading = + - @ would run as a formula when the CSV is opened in Excel, so such cells get a ' in front.
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
};

function RegistrationsTab() {
  const [rows, setRows] = useState<Registration[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState('');
  const [passFilter, setPassFilter] = useState<'all' | PassId>('all');

  const load = () => {
    setStatus('loading');
    adminListRegistrations().then((r) => { setRows(r); setStatus('ready'); }, () => setStatus('error'));
  };
  useEffect(load, []);

  const remove = (r: Registration) => {
    if (!confirm(`Delete the registration for ${r.leader_name}? This cannot be undone.`)) return;
    adminDeleteRegistration(r.id).then(load, (e) => alert(backendError(e)));
  };

  // One workbook with everything: a Participants sheet and a sheet per pass (same columns as the Google Sheet).
  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadWorkbook(rows, await adminListProfiles());
    } catch (e) {
      alert(backendError(e));
    } finally {
      setExporting(false);
    }
  };

  const q = query.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (passFilter === 'all' || r.pass === passFilter) &&
    (!q || [r.leader_name, r.team_name, r.email, r.phone, r.college, ...r.members].some((v) => v?.toLowerCase().includes(q)))
  );
  const total = shown.reduce((s, r) => s + r.amount, 0);

  const exportCsv = () => {
    const head = ['Registered at', 'Pass', 'Day', 'Team', 'Name / Leader', 'Members', 'Email', 'Phone', 'College', 'Amount'];
    const lines = shown.map((r) => [
      new Date(r.created_at).toLocaleString('en-IN'), passName(r.pass), r.day == null ? '' : FEST_DAYS[r.day],
      r.team_name, r.leader_name, r.members.join('; '), r.email, r.phone, r.college, r.amount
    ].map(csvCell).join(','));
    const blob = new Blob([[head.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `optimus27-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className={label}>REGISTRATIONS</div>
          <div className="text-2xl font-black">{shown.length}</div>
        </div>
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className={label}>AMOUNT DUE</div>
          <div className="text-2xl font-black text-amber-400">{inr(total)}</div>
        </div>
        {PASSES.map((p) => (
          <div key={p.id} className={`p-4 rounded-xl bg-slate-900 border ${THEME[p.theme].ring} hidden lg:block`}>
            <div className={label}>{p.name}</div>
            <div className={`text-2xl font-black ${THEME[p.theme].text}`}>{rows.filter((r) => r.pass === p.id).length}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, team, email, phone, college" className={`${input} pl-9`} />
        </div>
        <select value={passFilter} onChange={(e) => setPassFilter(e.target.value as typeof passFilter)} className={`${input} sm:w-52`}>
          <option value="all">All passes</option>
          {PASSES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={load} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-mono">
          <RotateCcw className="w-3.5 h-3.5" /> REFRESH
        </button>
        <button onClick={exportCsv} disabled={!shown.length} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-slate-200 hover:text-white text-xs font-mono font-bold tracking-widest disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
        <button onClick={exportExcel} disabled={status !== 'ready' || exporting} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 text-black text-xs font-black tracking-widest disabled:opacity-50">
          <Download className="w-3.5 h-3.5" /> {exporting ? 'PREPARING…' : 'EXCEL'}
        </button>
      </div>
      {status === 'error' && <p role="alert" className="text-xs font-mono text-rose-400">Could not load registrations. Check your connection and that this Google account is an admin.</p>}
      {status === 'loading' && <p className="text-xs font-mono text-slate-500">Loading registrations…</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-900 text-[10px] font-mono tracking-widest text-slate-400 text-left">
            <tr>
              {['WHEN', 'PASS', 'TEAM', 'NAME / LEADER', 'MEMBERS', 'CONTACT', 'COLLEGE', 'AMOUNT', ''].map((h) => (
                <th key={h} className="px-3 py-2.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {shown.map((r) => (
              <tr key={r.id} className="align-top hover:bg-slate-900/60">
                <td className="px-3 py-2.5 whitespace-nowrap text-slate-400 font-mono text-xs">{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-xs font-mono">
                  {passName(r.pass)}{r.day != null && <span className="text-slate-500"> · {FEST_DAYS[r.day]}</span>}
                </td>
                <td className="px-3 py-2.5">{r.team_name || <span className="text-slate-600">—</span>}</td>
                <td className="px-3 py-2.5 font-bold">{r.leader_name}</td>
                <td className="px-3 py-2.5 text-slate-300">{r.members.length ? r.members.join(', ') : <span className="text-slate-600">—</span>}</td>
                <td className="px-3 py-2.5 text-xs">
                  <a href={`mailto:${r.email}`} className="block text-slate-300 hover:text-white">{r.email}</a>
                  <span className="text-slate-500">{r.phone}</span>
                </td>
                <td className="px-3 py-2.5 text-slate-300">{r.college}</td>
                <td className="px-3 py-2.5 whitespace-nowrap font-mono">{inr(r.amount)}</td>
                <td className="px-3 py-2.5">
                  <button onClick={() => remove(r)} aria-label={`Delete registration for ${r.leader_name}`} className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-slate-500 text-sm">No registrations{q || passFilter !== 'all' ? ' match these filters' : ' yet'}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================== EVENTS ============================ */
type EventDraft = { title: string; tag: string; team: string; prize: string; desc: string; rules: string; placeholder: boolean };
const toDraft = (ev: EventItem): EventDraft => ({
  title: ev.title, tag: ev.tag, team: ev.team, prize: ev.prize, desc: ev.desc,
  rules: ev.rules.join('\n'), placeholder: !!ev.placeholder
});

function EventEditor({ ev, override, onSaved }: { ev: EventItem; override?: Record<string, unknown>; onSaved: () => void }) {
  const [draft, setDraft] = useState<EventDraft>(() => toDraft({ ...ev, ...(override as Partial<EventItem>) }));
  const [msg, setMsg] = useState('');
  const set = (k: keyof EventDraft, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    const data: Record<string, unknown> = { ...draft, rules: draft.rules.split('\n').map((s) => s.trim()).filter(Boolean) };
    // Store only the fields that differ from the built-in data, so later code changes still show through.
    for (const f of EDITABLE_EVENT_FIELDS) {
      if (JSON.stringify(data[f]) === JSON.stringify(f === 'placeholder' ? !!ev.placeholder : ev[f])) delete data[f];
    }
    try {
      if (Object.keys(data).length) await remoteSaveOverride(ev.id, data);
      else await remoteDeleteOverride(ev.id);
      setMsg('Saved');
      onSaved();
    } catch { setMsg('Could not save'); }
  };
  const reset = async () => {
    if (!confirm(`Reset "${ev.title}" to the built-in details?`)) return;
    try {
      await remoteDeleteOverride(ev.id);
      setDraft(toDraft(ev));
      setMsg('Reset');
      onSaved();
    } catch { setMsg('Could not reset'); }
  };

  return (
    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono tracking-widest text-slate-500">ID: {ev.id}</span>
        {override && <span className="text-[10px] font-mono tracking-widest px-2 py-0.5 rounded border border-amber-500/50 text-amber-400">EDITED</span>}
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className={label}>TITLE</label><input value={draft.title} onChange={(e) => set('title', e.target.value)} className={input} /></div>
        <div><label className={label}>DOMAIN</label><input value={draft.tag} onChange={(e) => set('tag', e.target.value)} className={input} /></div>
        <div><label className={label}>TEAM</label><input value={draft.team} onChange={(e) => set('team', e.target.value)} className={input} /></div>
        <div><label className={label}>PRIZE</label><input value={draft.prize} onChange={(e) => set('prize', e.target.value)} className={input} /></div>
        <label className="flex items-center gap-2 text-xs text-slate-300 self-end pb-2">
          <input type="checkbox" checked={draft.placeholder} onChange={(e) => set('placeholder', e.target.checked)} />
          Placeholder (not yet confirmed)
        </label>
        <div className="sm:col-span-2"><label className={label}>DESCRIPTION</label><textarea rows={3} value={draft.desc} onChange={(e) => set('desc', e.target.value)} className={input} /></div>
        <div className="sm:col-span-2"><label className={label}>RULES (ONE PER LINE)</label><textarea rows={3} value={draft.rules} onChange={(e) => set('rules', e.target.value)} className={input} /></div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 text-black text-xs font-black tracking-widest">
          <Save className="w-3.5 h-3.5" /> SAVE
        </button>
        {override && (
          <button onClick={reset} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-mono">
            <RotateCcw className="w-3.5 h-3.5" /> RESET
          </button>
        )}
        {msg && <span className="text-xs font-mono text-emerald-400">{msg}</span>}
      </div>
    </div>
  );
}

function PrizePoolEditor({ heroKey, base, override, onSaved }: { heroKey: string; base?: number; override?: Record<string, unknown>; onSaved: () => void }) {
  const current = typeof override?.prizePool === 'number' ? override.prizePool : base;
  const [value, setValue] = useState(current == null ? '' : String(current));
  const [msg, setMsg] = useState('');
  const save = async () => {
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) { setMsg('Enter a number'); return; }
    const id = `hero:${heroKey}`;
    try {
      if (n === base) await remoteDeleteOverride(id);
      else await remoteSaveOverride(id, { prizePool: n });
      setMsg('Saved');
      onSaved();
    } catch { setMsg('Could not save'); }
  };
  return (
    <div className="flex items-end gap-2">
      <div>
        <label className={label}>ARENA PRIZE POOL (₹)</label>
        <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={`${input} w-40`} />
      </div>
      <button onClick={save} className="px-3 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-mono">SAVE</button>
      {msg && <span className={`text-xs font-mono pb-2 ${msg === 'Saved' ? 'text-emerald-400' : 'text-rose-400'}`}>{msg}</span>}
    </div>
  );
}

function EventsTab() {
  const [overrides, setOverrides] = useState<Overrides | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = () => remoteOverrides().then((o) => { setOverrides(o); setFailed(false); }, () => setFailed(true));
  useEffect(() => { reload(); }, []);
  if (failed) return <p role="alert" className="text-xs font-mono text-rose-400">Could not load the event edits. Check your connection and that this Google account is an admin.</p>;
  if (!overrides) return <p className="text-xs font-mono text-slate-500">Loading events…</p>;

  return (
    <div className="space-y-8">
      <p className="text-xs text-slate-400">Changes are saved for everyone and show on the public site the next time it is loaded.</p>
      {HEROES.map((h) => {
        const ht = THEME[h.theme];
        return (
          <section key={h.key} className={`p-5 rounded-2xl bg-slate-900 border ${ht.ring} space-y-4`}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[10px] font-mono tracking-widest text-slate-400">{h.faction} · {h.role}</div>
                <h2 className={`text-2xl font-black tracking-wide uppercase ${ht.text}`}>{h.name}</h2>
              </div>
              <PrizePoolEditor heroKey={h.key} base={h.prizePool} override={overrides[`hero:${h.key}`]} onSaved={reload} />
            </div>
            <div className="grid lg:grid-cols-2 gap-4">
              {h.events.map((ev) => <EventEditor key={ev.id} ev={ev} override={overrides[ev.id]} onSaved={reload} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* =========================== ANNOUNCEMENTS ======================== */
function AnnouncementsTab() {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [message, setMessage] = useState('');
  const reload = () => remoteAnnouncements().then(setRows, () => {});
  useEffect(() => { reload(); }, []);

  const post = (e: React.FormEvent) => {
    e.preventDefault();
    remoteAddAnnouncement(message.trim()).then(() => { setMessage(''); reload(); }, () => alert('Could not post the announcement.'));
  };
  const remove = (a: Announcement) => {
    if (!confirm('Delete this announcement?')) return;
    remoteDeleteAnnouncement(a.id).then(reload, () => alert('Could not delete the announcement.'));
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <form onSubmit={post} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <label className={label}>NEW ANNOUNCEMENT · SHOWN UNDER THE SITE HEADER</label>
        <textarea required maxLength={300} rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Hackathon registrations close on Jan 25!" className={input} />
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-slate-500">{message.length}/300</span>
          <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 text-black text-xs font-black tracking-widest">
            <Megaphone className="w-3.5 h-3.5" /> POST
          </button>
        </div>
      </form>
      <ul className="space-y-2">
        {rows.map((a) => (
          <li key={a.id} className={`p-4 rounded-xl border flex items-start gap-3 ${a.active ? 'bg-slate-900 border-amber-500/40' : 'bg-slate-950 border-slate-800 opacity-60'}`}>
            <div className="flex-1 space-y-1">
              <p className="text-sm text-slate-200">{a.message}</p>
              <p className="text-[10px] font-mono text-slate-500">{new Date(a.created_at).toLocaleString('en-IN')} · {a.active ? 'LIVE' : 'HIDDEN'}</p>
            </div>
            <button onClick={() => remoteSetAnnouncementActive(a.id, !a.active).then(reload, () => alert('Could not update the announcement.'))} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-[10px] font-mono tracking-widest">
              {a.active ? 'HIDE' : 'SHOW'}
            </button>
            <button onClick={() => remove(a)} aria-label="Delete announcement" className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-slate-800">
              <Trash2 className="w-4 h-4" />
            </button>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-slate-500">No announcements yet.</li>}
      </ul>
    </div>
  );
}

/* ============================== PAGE ============================== */
const TABS = [
  { id: 'registrations', label: 'REGISTRATIONS', icon: Users },
  { id: 'events', label: 'EVENTS', icon: Calendar },
  { id: 'announcements', label: 'ANNOUNCEMENTS', icon: Megaphone }
] as const;

export default function AdminPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(!FIREBASE_ENABLED);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('registrations');

  useEffect(() => {
    document.title = "Admin · OPTIMUS '27";
    document.getElementById('splash')?.remove();
  }, []);
  useEffect(() => watchUser((u) => { setUser(u); setReady(true); }), []);

  if (!FIREBASE_ENABLED) {
    return (
      <Shell>
        <div className="max-w-md mx-auto mt-16 p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3 text-sm text-slate-400">
          <h1 className="text-lg font-black tracking-wide uppercase text-slate-100">Admin not configured</h1>
          <p>The admin panel needs the Firebase backend. Add the <code className="text-amber-400">VITE_FIREBASE_*</code> values (see <code className="text-amber-400">README-FIREBASE.md</code>) and rebuild.</p>
        </div>
      </Shell>
    );
  }
  if (!ready) return <Shell><p className="text-center mt-16 text-sm font-mono text-slate-500">Checking sign-in…</p></Shell>;
  if (!user) return <Shell><Login /></Shell>;
  if (!isAdminEmail(user.email)) {
    return (
      <Shell onSignOut={() => signOutUser()}>
        <div className="max-w-md mx-auto mt-16 p-6 rounded-2xl bg-slate-900 border border-rose-500/40 space-y-2 text-sm text-slate-300">
          <h1 className="text-lg font-black tracking-wide uppercase text-slate-100">Not an admin account</h1>
          <p><span className="font-mono">{user.email}</span> is not on the organisers' list. Sign out and use an admin Google account.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onSignOut={() => signOutUser()}>
      <VisitorStats />
      <nav className="flex gap-2 mb-6 overflow-x-auto">
        {TABS.map(({ id, label: l, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono font-bold tracking-widest border whitespace-nowrap ${tab === id ? 'border-amber-500/50 text-amber-400 bg-slate-900' : 'border-slate-800 text-slate-400 hover:text-white'}`}
          >
            <Icon className="w-4 h-4" /> {l}
          </button>
        ))}
      </nav>
      {tab === 'registrations' && <RegistrationsTab />}
      {tab === 'events' && <EventsTab />}
      {tab === 'announcements' && <AnnouncementsTab />}
    </Shell>
  );
}
