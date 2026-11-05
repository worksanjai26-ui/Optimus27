import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ScanLine, LogOut, Camera, CameraOff, Check, X, Keyboard, CircleCheck, CircleX } from 'lucide-react';
import {
  BACKEND_ENABLED, AuthUser, StaffInfo, Lookup, watchUser, signInWithGoogle, signOutUser, backendError,
  fetchMyStaff, lookupParticipant, markPresent, markAbsent
} from './backend';
import { EVENT_SCHEDULE } from './schedule';
import { HEROES, FEST_DAYS } from './App';

/* ------------------------------------------------------------------ *
 *  /#scan — the coordinators' attendance screen.
 *
 *  Scan (or type) a participant's QR and the screen shows who they are and the events they
 *  booked. The coordinator then decides with one tap: YES, present, or NO, absent.
 *  Coordinators and admins sign in with Google. Whether an account may scan, and which
 *  events it may mark, is decided by the `staff` table on the server; this page only reads
 *  the answer to decide what to show.
 * ------------------------------------------------------------------ */

const panel = 'rounded-2xl bg-slate-900 border border-slate-800';
const lbl = 'text-[10px] font-mono tracking-widest text-slate-400 block mb-1.5';
const eventTitle = (id: string) => HEROES.flatMap((h) => h.events).find((e) => e.id === id)?.title ?? id;

// Which fest day it is right now (Feb 4 = day 1), so the scanner starts on the right one.
const todayIndex = () => {
  const d = new Date();
  return d.getFullYear() === 2027 && d.getMonth() === 1 && d.getDate() === 5 ? 1 : 0;
};

type Mode = 'entry' | 'event';
type Outcome = 'present' | 'already' | 'absent';
type Logged = { key: number; name: string; id: string; mode: Mode; outcome: Outcome };
type Flash = { tone: 'ok' | 'warn' | 'bad'; text: string };

function SignIn({ message }: { message?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="max-w-sm mx-auto mt-14 p-6 rounded-2xl bg-slate-900 border border-amber-500/50 shadow-[0_0_45px_rgba(250,204,21,0.15)] space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-black tracking-wide uppercase">Scanner sign in</h1>
        <p className="text-xs text-slate-400">{message ?? 'For event coordinators and organisers. Use the Google account you were added with.'}</p>
      </div>
      {error && <p role="alert" className="text-xs text-rose-400 font-mono">{error}</p>}
      <button
        onClick={() => { setBusy(true); signInWithGoogle().catch((e) => setError(backendError(e))).finally(() => setBusy(false)); }}
        disabled={busy}
        className="w-full py-3 rounded-xl bg-white text-slate-900 text-xs font-black tracking-widest disabled:opacity-60 flex items-center justify-center gap-2"
      >
        <span className="text-base leading-none">G</span> {busy ? 'OPENING GOOGLE…' : 'SIGN IN WITH GOOGLE'}
      </button>
    </div>
  );
}

function Scanner({ user, staff }: { user: AuthUser; staff: StaffInfo }) {
  const eventOptions = staff.role === 'admin' ? Object.keys(EVENT_SCHEDULE) : staff.eventIds;
  const [mode, setMode] = useState<Mode>('entry');
  const [eventId, setEventId] = useState(eventOptions[0] ?? '');
  const [day, setDay] = useState(todayIndex);
  const [camOn, setCamOn] = useState(false);
  const [camError, setCamError] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Lookup | null>(null);   // the participant on screen, waiting for YES / NO
  const [flash, setFlash] = useState<Flash | null>(null);
  const [log, setLog] = useState<Logged[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfg = useRef({ mode, eventId, day });
  cfg.current = { mode, eventId, day };
  const hold = useRef(false);   // true while a lookup is running or a participant is on screen
  const lastSeen = useRef({ code: '', at: 0 });
  const counter = useRef(0);
  const flashTimer = useRef(0);

  const say = (f: Flash | null) => {
    clearTimeout(flashTimer.current);
    setFlash(f);
    if (f) flashTimer.current = window.setTimeout(() => setFlash(null), 4500);
  };

  // Step one: look the QR (or typed ID) up. Nothing is recorded yet.
  const lookup = useCallback(async (code: string) => {
    if (hold.current) return;
    hold.current = true;
    setBusy(true);
    say(null);
    try {
      setReview(await lookupParticipant(code));
      navigator.vibrate?.(40);
    } catch (e) {
      hold.current = false;
      say({ tone: 'bad', text: backendError(e) });
      navigator.vibrate?.([120, 60, 120]);
    } finally {
      setBusy(false);
    }
  }, []);

  const done = (person: Lookup, outcome: Outcome, f: Flash) => {
    const { mode: m } = cfg.current;
    setLog((l) => [{ key: ++counter.current, name: person.name, id: person.optimus_id, mode: m, outcome }, ...l].slice(0, 12));
    lastSeen.current.at = performance.now();   // the same QR is still in front of the camera: do not reopen it
    setReview(null);
    hold.current = false;
    say(f);
  };

  const answer = async (present: boolean) => {
    if (!review || busy) return;
    const { mode: m, eventId: ev, day: d } = cfg.current;
    setBusy(true);
    try {
      if (present) {
        const r = await markPresent(review.optimus_id, m, m === 'event' ? ev : null, d, !review.manual);
        if (r.status === 'marked') {
          navigator.vibrate?.(60);
          done(review, 'present', {
            tone: r.warnings?.includes('no-gate-entry') ? 'warn' : 'ok',
            text: r.warnings?.includes('no-gate-entry')
              ? `${review.name}: present. Not checked in at the gate on this day, please send them to the gate desk.`
              : `${review.name}: marked present.`
          });
        } else if (r.status === 'already') {
          done(review, 'already', { tone: 'warn', text: `${review.name} was already marked present.` });
        } else {
          setBusy(false);
          say({ tone: 'bad', text: r.status === 'no-gate-entry' ? 'Not checked in at the gate yet.' : r.status === 'wrong-day' ? 'This event is on another day.' : 'Not registered for this event.' });
          return;
        }
      } else {
        await markAbsent(review.optimus_id, m, m === 'event' ? ev : null, d);
        done(review, 'absent', { tone: 'warn', text: `${review.name}: marked absent.` });
      }
    } catch (e) {
      say({ tone: 'bad', text: backendError(e) });
    } finally {
      setBusy(false);
    }
  };

  const cancelReview = () => { lastSeen.current.at = performance.now(); setReview(null); hold.current = false; };

  // Camera: read frames, look for a QR with jsQR, hand the text to lookup().
  useEffect(() => {
    if (!camOn) return;
    let stop = false, raf = 0, last = 0;
    let stream: MediaStream | undefined;
    const run = async () => {
      try {
        const jsQR = (await import('jsqr')).default;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        const v = videoRef.current, c = canvasRef.current;
        if (!v || !c || stop) return;
        v.srcObject = stream;
        await v.play();
        const g = c.getContext('2d', { willReadFrequently: true })!;
        const tick = () => {
          if (stop) return;
          const now = performance.now();
          if (!hold.current && now - last > 130 && v.readyState >= 2 && v.videoWidth) {
            last = now;
            const w = 640, h = Math.round((v.videoHeight / v.videoWidth) * w);
            c.width = w; c.height = h;
            g.drawImage(v, 0, 0, w, h);
            const q = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
            // The same QR stays in view for a moment after an answer; ignore repeats of it.
            if (q?.data && !(q.data === lastSeen.current.code && now - lastSeen.current.at < 5000)) {
              lastSeen.current = { code: q.data, at: now };
              lookup(q.data);
            }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setCamError('Cannot open the camera. Allow camera access for this site, or use the manual box below.');
        setCamOn(false);
      }
    };
    setCamError('');
    run();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [camOn, lookup]);

  const seg = (on: boolean) =>
    `px-3 py-3 rounded-xl border text-xs font-mono font-bold tracking-widest transition-colors ${on ? 'border-amber-500/60 text-amber-300 bg-slate-950' : 'border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-600'}`;
  const canEvents = eventOptions.length > 0;

  // What the coordinator needs to know before pressing YES.
  const booked = review?.events.find((e) => e.event_id === eventId);
  const atGate = !!review?.entry_days.includes(day);
  let blocker = '';
  if (review && mode === 'event') {
    if (!booked) blocker = 'Not registered for this event.';
    else if (booked.day !== day) blocker = `This event is on ${FEST_DAYS[booked.day]}, not ${FEST_DAYS[day]}.`;
  }
  const already = review ? (mode === 'entry' ? atGate : !!booked?.attended) : false;

  const flashTone = { ok: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300', warn: 'border-amber-500/50 bg-amber-500/10 text-amber-200', bad: 'border-rose-500/50 bg-rose-500/10 text-rose-300' };

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div className={`${panel} p-4 flex items-center justify-between gap-3`}>
        <div className="min-w-0">
          <p className="text-[10px] font-mono tracking-widest text-slate-500">{staff.role.toUpperCase()}</p>
          <p className="text-sm font-bold text-slate-100 truncate">{user.email}</p>
        </div>
        <ScanLine className="w-6 h-6 text-amber-400 shrink-0" />
      </div>

      <div className={`${panel} p-4 space-y-4`}>
        <div>
          <span className={lbl}>WHAT ARE YOU MARKING</span>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('entry')} aria-pressed={mode === 'entry'} className={seg(mode === 'entry')}>GATE ENTRY</button>
            <button onClick={() => canEvents && setMode('event')} aria-pressed={mode === 'event'} disabled={!canEvents} className={`${seg(mode === 'event')} disabled:opacity-40`}>EVENT</button>
          </div>
        </div>
        {mode === 'event' && (
          <div>
            <label htmlFor="scan-event" className={lbl}>EVENT</label>
            <select
              id="scan-event"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
            >
              {eventOptions.map((id) => <option key={id} value={id}>{eventTitle(id)} · {FEST_DAYS[EVENT_SCHEDULE[id]?.day ?? 0]}</option>)}
            </select>
          </div>
        )}
        <div>
          <span className={lbl}>DAY</span>
          <div className="grid grid-cols-2 gap-2">
            {FEST_DAYS.map((d, i) => <button key={d} onClick={() => setDay(i)} aria-pressed={day === i} className={seg(day === i)}>DAY {i + 1} · {d}</button>)}
          </div>
        </div>
      </div>

      {/* The participant on screen: details, booked events, then YES / NO. */}
      {review && (
        <div role="dialog" aria-label="Participant" className="rounded-2xl border border-amber-500/50 bg-slate-900 shadow-[0_0_45px_rgba(250,204,21,0.12)] overflow-hidden">
          <div className="p-5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-mono tracking-widest text-slate-400">PARTICIPANT</p>
              {review.manual && <span className="px-2 py-0.5 rounded border border-amber-500/40 text-[10px] font-mono text-amber-300">TYPED ID</span>}
            </div>
            <p className="text-2xl font-black tracking-wide text-white">{review.name}</p>
            <p className="text-xs font-mono text-slate-300">{review.optimus_id} · {review.college}</p>
          </div>

          <div className="px-5 pb-4 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-950 border border-slate-800 px-4 py-2.5">
              <span className="text-xs font-mono text-slate-400">GATE · DAY {day + 1}</span>
              <span className={`text-[11px] font-mono font-bold tracking-widest ${atGate ? 'text-emerald-300' : 'text-amber-300'}`}>{atGate ? 'CHECKED IN' : 'NOT CHECKED IN'}</span>
            </div>

            <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
              <p className="px-4 py-2 text-[10px] font-mono tracking-widest text-slate-500 border-b border-slate-800">REGISTERED EVENTS</p>
              {review.events.length === 0 && <p className="px-4 py-3 text-sm text-slate-400">No events booked.</p>}
              <ul className="divide-y divide-slate-800/80">
                {review.events.map((e) => {
                  const here = mode === 'event' && e.event_id === eventId;
                  return (
                    <li key={e.event_id} className={`flex items-center justify-between gap-3 px-4 py-2.5 ${here ? 'bg-amber-500/10' : ''}`}>
                      <span className="min-w-0">
                        <span className={`block text-sm font-bold truncate ${here ? 'text-amber-200' : 'text-slate-100'}`}>{e.title}{here && ' ← THIS EVENT'}</span>
                        <span className="block text-[10px] font-mono tracking-widest text-slate-500">{FEST_DAYS[e.day]}</span>
                      </span>
                      <span className={`shrink-0 text-[10px] font-mono font-bold tracking-widest ${e.attended ? 'text-emerald-300' : 'text-slate-400'}`}>{e.attended ? 'ATTENDED' : 'BOOKED'}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {mode === 'event' && !blocker && !atGate && (
              <p className="rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-2 text-xs text-amber-200">
                Not checked in at the gate on this day. You can still mark them present; please send them to the gate desk.
              </p>
            )}
            {blocker && <p className="rounded-lg bg-rose-500/10 border border-rose-500/40 px-3 py-2 text-sm text-rose-300">{blocker}</p>}
            {already && !blocker && <p className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300">Already marked present for this {mode === 'entry' ? 'day' : 'event'}.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 p-5 pt-0">
            <button
              onClick={() => answer(true)}
              disabled={busy || !!blocker}
              className="py-5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-base font-black tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <Check className="w-6 h-6" /> YES
            </button>
            <button
              onClick={() => answer(false)}
              disabled={busy}
              className="py-5 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white text-base font-black tracking-widest flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <X className="w-6 h-6" /> NO
            </button>
          </div>
          <button onClick={cancelReview} disabled={busy} className="w-full pb-4 text-[11px] font-mono tracking-widest text-slate-500 hover:text-white">CANCEL · SCAN SOMEONE ELSE</button>
        </div>
      )}

      {flash && <p role="status" className={`rounded-xl border px-4 py-3 text-sm ${flashTone[flash.tone]}`}>{flash.text}</p>}

      <div className={`${panel} p-4 space-y-3`}>
        <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
          <video ref={videoRef} playsInline muted className={`absolute inset-0 w-full h-full object-cover ${camOn ? '' : 'hidden'}`} />
          <canvas ref={canvasRef} className="hidden" />
          {camOn ? (
            <>
              <div className="absolute inset-[18%] border-2 border-amber-400/80 rounded-xl pointer-events-none" />
              <span className="absolute left-0 right-0 top-[18%] h-0.5 bg-amber-400/70 animate-pulse pointer-events-none" />
            </>
          ) : (
            <p className="text-xs font-mono text-slate-500 px-6 text-center">Camera is off</p>
          )}
        </div>
        <button
          onClick={() => setCamOn((o) => !o)}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-black text-xs font-black tracking-widest flex items-center justify-center gap-2"
        >
          {camOn ? <><CameraOff className="w-4 h-4" /> STOP CAMERA</> : <><Camera className="w-4 h-4" /> START SCANNING</>}
        </button>
        {camError && <p role="alert" className="text-xs text-rose-400 font-mono">{camError}</p>}

        <form
          onSubmit={(e) => { e.preventDefault(); const id = manual.trim().toUpperCase(); if (id) { lookup(id); setManual(''); } }}
          className="flex gap-2 pt-1"
        >
          <div className="relative flex-1">
            <Keyboard className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              placeholder="No QR? Type OPT27-00000"
              spellCheck={false}
              aria-label="Optimus ID, if the QR cannot be scanned"
              className="w-full pl-9 pr-3 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm font-mono focus:outline-none focus:border-slate-500"
            />
          </div>
          <button type="submit" disabled={busy || !!review} className="px-4 rounded-xl border border-slate-700 text-slate-200 text-xs font-mono font-bold tracking-widest hover:text-white disabled:opacity-50">FIND</button>
        </form>
      </div>

      {log.length > 0 && (
        <div className={`${panel} overflow-hidden`}>
          <p className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 text-[10px] font-mono tracking-widest text-slate-400">THIS SESSION</p>
          <ul className="divide-y divide-slate-800/80">
            {log.map((x) => (
              <li key={x.key} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                <span className="min-w-0 truncate text-slate-200">{x.name} <span className="font-mono text-slate-500">{x.id}</span></span>
                <span className={`shrink-0 inline-flex items-center gap-1 font-mono font-bold tracking-widest ${x.outcome === 'absent' ? 'text-rose-300' : x.outcome === 'already' ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {x.outcome === 'absent' ? <CircleX className="w-3.5 h-3.5" /> : <CircleCheck className="w-3.5 h-3.5" />}
                  {x.mode === 'entry' ? 'GATE' : 'EVENT'} · {x.outcome === 'absent' ? 'ABSENT' : x.outcome === 'already' ? 'ALREADY' : 'PRESENT'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ScanPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(!BACKEND_ENABLED);
  const [staff, setStaff] = useState<StaffInfo | null | undefined>(undefined);

  useEffect(() => {
    document.title = "Scanner · OPTIMUS '27";
    document.getElementById('splash')?.remove();
  }, []);
  useEffect(() => watchUser((u) => { setUser(u); setReady(true); }), []);
  useEffect(() => {
    setStaff(undefined);
    if (user) fetchMyStaff(user.email).then(setStaff, () => setStaff(null));
  }, [user]);

  let body: React.ReactNode;
  if (!BACKEND_ENABLED) {
    body = <p className="max-w-md mx-auto mt-16 text-sm text-slate-400 text-center">The scanner needs the Supabase backend (see README-SUPABASE.md).</p>;
  } else if (!ready) {
    body = <p className="text-center mt-16 text-sm font-mono text-slate-500">Checking sign-in…</p>;
  } else if (!user) {
    body = <SignIn />;
  } else if (staff === undefined) {
    body = <p className="text-center mt-16 text-sm font-mono text-slate-500">Checking your access…</p>;
  } else if (!staff) {
    body = (
      <div className="max-w-md mx-auto mt-16 p-6 rounded-2xl bg-slate-900 border border-rose-500/40 space-y-2 text-sm text-slate-300">
        <h1 className="text-lg font-black tracking-wide uppercase text-slate-100">Not on the staff list</h1>
        <p><span className="font-mono">{user.email}</span> cannot scan. Ask an organiser to add this Google account, or sign out and use another one.</p>
      </div>
    );
  } else {
    body = <Scanner user={user} staff={staff} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 bg-slate-950/90 sticky top-0 z-10">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-amber-400" />
            <span className="font-black tracking-[0.2em] text-sm">OPTIMUS '27 <span className="text-amber-400">SCAN</span></span>
          </div>
          {user && (
            <button onClick={() => signOutUser()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 hover:text-white text-xs font-mono">
              <LogOut className="w-3.5 h-3.5" /> SIGN OUT
            </button>
          )}
        </div>
      </header>
      <main className="px-4 py-6 pb-16">{body}</main>
    </div>
  );
}
