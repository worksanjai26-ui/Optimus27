import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  Zap,
  Shield,
  Trophy,
  Users,
  Calendar,
  ChevronRight,
  ArrowLeft,
  X,
  CheckCircle,
  Sparkles,
  Menu,
  Volume2,
  VolumeX,
  QrCode,
  Radio,
  Ticket,
  Megaphone,
  Home,
  MapPin,
  CalendarPlus,
  Award,
  Download
} from 'lucide-react';
import QRCode from 'qrcode';
import { listOverrides, listAnnouncements, addRegistration, recordVisit, Announcement, Overrides } from './adminData';
import {
  IDENTITY_DEMO, Profile, currentProfile, createProfile, signOutProfile, findProfile, qrPayload,
  isOptimusId, isCapsName, normalizeName, checkMember, MemberCheck, attendedEvents
} from './identity';
// Public-folder files are served under the Vite base (the repo sub-path on GitHub Pages, '/' in dev).
const BASE =import.meta.env.BASE_URL;

/* ------------------------------------------------------------------ *
 *  OPTIMUS '27  —  National Level Techno Fest
 *  KPR Institute of Engineering and Technology
 *
 *  Leaders (factions) and the events grouped under each:
 *    BUMBLEBEE  → Hackathon                            (MAIN / FLAGSHIP)
 *    MEGATRON   → Paper / Project / Poster Presentation
 *    SHOCKWAVE  → Workshops
 *    RATCHET    → Non-Technical events
 * ------------------------------------------------------------------ */

// >>> Update this to the real fest start date/time when confirmed.
const EVENT_DATE = new Date('2027-02-04T09:00:00');
// Venue links used by the phone quick-info card and the footer.
const VENUE_MAP = 'https://www.google.com/maps/search/?api=1&query=11.0782,77.1386';
const FEST_ICS = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//OPTIMUS 27//EN\r\nBEGIN:VEVENT\r\nUID:optimus27-fest@kpriet\r\nDTSTAMP:20270101T000000Z\r\nDTSTART;VALUE=DATE:20270204\r\nDTEND;VALUE=DATE:20270206\r\nSUMMARY:OPTIMUS \'27 - National Level Techno Fest\r\nLOCATION:KPR Institute of Engineering and Technology\\, Coimbatore\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
);

// Audio: the orchestrated Transformers theme looping in the background, plus one transformation
// clip. Browsers allow audio only after a user gesture, so playback starts on the ENTER click.
// Realistic vehicle models (glTF binary) dropped into public/models/ replace the code-built
// vehicle shells automatically; while a file is missing the code-built one is used.
// length: bumper-to-bumper size on stage. yaw: extra turn (radians) if a model faces backwards.
const VEHICLE_MODELS: Record<string, { src: string; length: number; yaw?: number }> = {
  bumblebee: { src: BASE + 'models/bumblebee-car.glb', length: 5.9 },
  megatron: { src: BASE + 'models/megatron-car.glb', length: 6.9 },
  ratchet: { src: BASE + 'models/ratchet-car.glb', length: 6.6 }
};

const MUSIC_SRC = BASE + 'music/theme.mp3';
// The theme file is mastered very quietly (about -36 dB RMS, peaks near 8%), so it runs through a
// Web Audio gain stage; MUSIC_VOLUME / MUSIC_DUCKED are the fader on top of that boost.
const MUSIC_GAIN = 6;
const MUSIC_VOLUME = 1;
const MUSIC_DUCKED = 0.35;
// The transformation clip is cropped at play time to its busiest stretch (from..to, seconds into
// the file) and starts `delay` seconds after the intro begins, so its big hit (~2.4s into the
// file) lands on the 3D lock-in impact at INTRO_LOCK = 3.5s.
const TRANSFORM_SFX = { src: BASE + 'sfx/transform.mp3', from: 0.6, to: 3.6, delay: 1.8, volume: 0.95 };

type VehicleKind = 'car' | 'truck' | 'tank' | 'ambulance';

class ThemeMusic {
  private el: HTMLAudioElement | null = null;
  private fade = 0;
  private target = MUSIC_VOLUME;
  private sfx: HTMLAudioElement | null = null;
  private sfxTimers: number[] = [];
  private ctx: AudioContext | null = null;
  muted = false;

  start() {
    if (!this.el) {
      this.el = new Audio(MUSIC_SRC);
      this.el.loop = true;
      this.el.preload = 'auto';
      this.el.volume = 0;
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        const boost = this.ctx.createGain();
        boost.gain.value = MUSIC_GAIN;
        this.ctx.createMediaElementSource(this.el).connect(boost);
        boost.connect(this.ctx.destination);
      }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    if (!this.sfx) {
      this.sfx = new Audio(TRANSFORM_SFX.src);
      this.sfx.preload = 'auto';
    }
    if (!this.muted) this.play();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (m) {
      this.stopTransform();
      clearInterval(this.fade);
      this.el?.pause();
    } else if (this.el) {
      this.play();
    }
  }

  // Resume, easing the volume toward the current target (full or ducked) so changes never jump.
  private play() {
    const el = this.el!;
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    el.play().catch(() => {});
    clearInterval(this.fade);
    this.fade = window.setInterval(() => {
      const d = this.target - el.volume;
      el.volume = Math.abs(d) <= 0.025 ? this.target : el.volume + Math.sign(d) * 0.025;
      if (el.volume === this.target) clearInterval(this.fade);
    }, 40);
  }

  private duck(v: number) {
    this.target = v;
    if (this.el && !this.muted) this.play();
  }

  // Cropped transformation clip with short fades; the music dips underneath it.
  playTransform() {
    if (this.muted) return;
    this.stopTransform();
    if (!this.sfx) {
      this.sfx = new Audio(TRANSFORM_SFX.src);
      this.sfx.preload = 'auto';
    }
    const fx = this.sfx;
    const len = TRANSFORM_SFX.to - TRANSFORM_SFX.from;
    this.sfxTimers.push(window.setTimeout(() => {
      if (this.muted) return;
      fx.currentTime = TRANSFORM_SFX.from;
      fx.volume = 0;
      fx.play().catch(() => {});
      this.duck(MUSIC_DUCKED);
      const ramp = window.setInterval(() => {
        const elapsed = fx.currentTime - TRANSFORM_SFX.from;
        const fadeIn = Math.min(1, elapsed / 0.15);
        const fadeOut = Math.min(1, Math.max(0, (len - elapsed) / 0.6));
        fx.volume = Math.max(0, TRANSFORM_SFX.volume * Math.min(fadeIn, fadeOut));
        if (elapsed >= len) this.stopTransform();
      }, 30);
      this.sfxTimers.push(ramp);
    }, TRANSFORM_SFX.delay * 1000));
  }

  private stopTransform() {
    this.sfxTimers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    this.sfxTimers = [];
    this.sfx?.pause();
    if (this.target !== MUSIC_VOLUME) this.duck(MUSIC_VOLUME);
  }

  shutdown() {
    this.muted = true;
    this.stopTransform();
    clearInterval(this.fade);
    [this.el, this.sfx].forEach((a) => {
      if (!a) return;
      a.pause();
      a.removeAttribute('src');
      a.load();
    });
    this.el = null;
    this.sfx = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
const audioFX = new ThemeMusic();
// A dev hot-reload re-runs this module; stop the previous player so it can't keep playing.
(import.meta as { hot?: { dispose: (cb: () => void) => void } }).hot?.dispose(() => audioFX.shutdown());

/* ============================ THEME TOKENS ======================== */
type ThemeKey = 'amber' | 'rose' | 'purple' | 'cyan';

export const THEME: Record<ThemeKey, {
  text: string; ring: string; glow: string; chip: string;
  btn: string; grad: string; dot: string; hoverText: string;
  titleGrad: string;   // arena heading: white fading into the theme colour
}> = {
  amber: {
    text: 'text-amber-400', hoverText: 'group-hover:text-amber-400',
    ring: 'border-amber-500/50', glow: 'shadow-[0_0_45px_rgba(250,204,21,0.28)]',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    btn: 'bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-black',
    grad: 'from-amber-300 via-yellow-400 to-amber-500', dot: 'bg-amber-400',
    titleGrad: 'from-slate-200 via-amber-400 to-yellow-500'
  },
  rose: {
    text: 'text-rose-400', hoverText: 'group-hover:text-rose-400',
    ring: 'border-rose-500/50', glow: 'shadow-[0_0_45px_rgba(244,63,94,0.28)]',
    chip: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    btn: 'bg-gradient-to-r from-rose-600 via-red-500 to-rose-500 hover:from-rose-500 hover:to-red-400 text-white',
    grad: 'from-slate-200 via-rose-400 to-red-500', dot: 'bg-rose-500',
    titleGrad: 'from-slate-200 via-rose-400 to-red-500'
  },
  purple: {
    text: 'text-fuchsia-400', hoverText: 'group-hover:text-fuchsia-400',
    ring: 'border-fuchsia-500/50', glow: 'shadow-[0_0_45px_rgba(217,70,239,0.28)]',
    chip: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40',
    btn: 'bg-gradient-to-r from-fuchsia-600 via-purple-600 to-violet-600 hover:from-fuchsia-500 hover:to-purple-500 text-white',
    grad: 'from-fuchsia-400 via-purple-500 to-violet-600', dot: 'bg-fuchsia-500',
    titleGrad: 'from-slate-200 via-fuchsia-400 to-purple-500'
  },
  cyan: {
    text: 'text-cyan-400', hoverText: 'group-hover:text-cyan-400',
    ring: 'border-cyan-500/50', glow: 'shadow-[0_0_45px_rgba(34,211,238,0.28)]',
    chip: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
    btn: 'bg-gradient-to-r from-cyan-400 via-sky-400 to-cyan-500 hover:from-cyan-300 hover:to-sky-300 text-black',
    grad: 'from-cyan-300 via-sky-400 to-cyan-500', dot: 'bg-cyan-400',
    titleGrad: 'from-slate-200 via-cyan-400 to-sky-500'
  }
};

/* ============================ THEMED CURSOR ======================= */
const CURSOR_HEX: Record<ThemeKey, string> = {
  amber: '#f5c518',
  rose: '#f43f5e',
  purple: '#d946ef',
  cyan: '#22d3ee'
};

// Targeting-reticle cursor tinted to the active faction; a "locked" bracket
// variant marks clickable elements. Returns a <style> body applied globally.
const buildCursorCss = (hex: string) => {
  const uri = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const reticle =
    `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'>` +
    `<g fill='none' stroke='#000' stroke-opacity='0.5' stroke-width='3.5' stroke-linecap='round'>` +
    `<circle cx='15' cy='15' r='8'/><path d='M15 3v3M15 24v3M3 15h3M24 15h3'/></g>` +
    `<g fill='none' stroke='${hex}' stroke-width='1.6' stroke-linecap='round'>` +
    `<circle cx='15' cy='15' r='8'/><path d='M15 3v3M15 24v3M3 15h3M24 15h3'/></g>` +
    `<circle cx='15' cy='15' r='1.7' fill='${hex}'/></svg>`;
  const locked =
    `<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34' viewBox='0 0 34 34'>` +
    `<g fill='none' stroke='#000' stroke-opacity='0.5' stroke-width='4' stroke-linecap='round'>` +
    `<path d='M7 12V7h5M27 12V7h-5M7 22v5h5M27 22v5h-5'/></g>` +
    `<g fill='none' stroke='${hex}' stroke-width='2' stroke-linecap='round'>` +
    `<path d='M7 12V7h5M27 12V7h-5M7 22v5h5M27 22v5h-5'/></g>` +
    `<circle cx='17' cy='17' r='2' fill='${hex}'/>` +
    `<circle cx='17' cy='17' r='6' fill='none' stroke='${hex}' stroke-opacity='0.75' stroke-width='1.4'/></svg>`;
  return (
    `*,*::before,*::after{cursor:url("${uri(reticle)}") 15 15, auto;}` +
    `a,button,[role='button'],select,summary,canvas,label[for]{cursor:url("${uri(locked)}") 17 17, pointer;}` +
    `input:not([type='button']):not([type='submit']):not([type='checkbox']):not([type='radio']),textarea{cursor:text;}`
  );
};

/* ============================ HERO DATA =========================== */
export type EventItem = {
  id: string; title: string;
  tag: string;            // the event's domain, shown in its facts strip
  team: string; prize: string;
  desc: string; rules: string[]; placeholder?: boolean;
  split?: number[];       // 1st / 2nd / 3rd prize, in rupees
  extra?: { label: string; value: string }[];   // more facts (duration, format …)
};
export type Hero = {
  key: string; name: string; role: string; faction: 'AUTOBOT' | 'DECEPTICON';
  tagline: string; lore: string; theme: ThemeKey; kind: 'main' | 'standard';
  colors: { primary: number; secondary: number; metal: number; visor: number; glow: number };
  features: {
    twinEyes?: boolean; singleEye?: boolean; horns?: boolean; doorWings?: boolean; cannon?: boolean; medicCross?: boolean;
    wheels?: boolean; stripes?: boolean; headlights?: boolean; spikes?: boolean; lightBar?: boolean; tallAntennae?: boolean; earHorns?: boolean;
  };
  // y lifts a hero onto a raised dais at its roster position.
  layout: { x: number; z: number; scale: number; y?: number };
  vehicle: VehicleKind;
  prizePool?: number;   // total across the leader's events, in rupees
  events: EventItem[];
};

export const HEROES: Hero[] = [
  {
    key: 'bumblebee',
    name: 'BUMBLEBEE',
    role: 'THE SCOUT',
    faction: 'AUTOBOT',
    tagline: 'The Flagship Hackathon',
    lore: 'Fast, fearless and impossibly resilient — Bumblebee leads from the front. This is the beating heart of OPTIMUS \'27: the national-level hackathon where ideas are forged into working products against the clock.',
    theme: 'amber',
    kind: 'main',
    colors: { primary: 0xe0a812, secondary: 0x111317, metal: 0x3d424a, visor: 0x4cc3ff, glow: 0xffb21e },
    vehicle: 'car',
    features: { twinEyes: true, doorWings: true, wheels: true, stripes: true, headlights: true, earHorns: true },
    layout: { x: 7.6, z: -2.4, scale: 1.36 },
    prizePool: 60000,
    events: [
      {
        id: 'hackathon',
        title: 'BUMBLEBEE HACKATHON',
        tag: 'AI / ML · Web & App · IoT & Hardware · Open Innovation',
        team: '2 – 4 Members',
        prize: '₹60,000',
        split: [30000, 20000, 10000],
        extra: [
          { label: 'Duration', value: '24 Hours · Non-stop' },
          { label: 'Dates', value: 'Feb 4 – 5, 2027' },
          { label: 'Format', value: 'Screening → Build → Demo' },
          { label: 'Support', value: 'Mentors all night' }
        ],
        desc: 'The national-level flagship of OPTIMUS \'27. Pick a domain track and take an idea to a working product in 24 non-stop hours — mentors are on the floor through the night, checkpoints keep every team on course, and the best builds face the jury in a final live demo and pitch.',
        rules: [
          'Bring your own laptops and dev kits',
          'Fresh code only — no pre-built projects',
          'Round-based judging with a final live demo & pitch'
        ]
      }
    ]
  },
  {
    key: 'megatron',
    name: 'MEGATRON',
    role: 'THE WARLORD',
    faction: 'DECEPTICON',
    tagline: 'The Presentation Arena',
    lore: 'Ruthless, commanding, absolute. Megatron rules the arena where knowledge is the weapon — step up and defend your research, your build and your ideas before the panel.',
    theme: 'rose',
    kind: 'standard',
    colors: { primary: 0x858c96, secondary: 0x2b2f36, metal: 0xa3a9b1, visor: 0xff2a1f, glow: 0xff3b24 },
    vehicle: 'truck',
    features: { twinEyes: true, horns: true, cannon: true, spikes: true },
    layout: { x: -7.6, z: -2.4, scale: 1.3 },
    prizePool: 40000,
    events: [
      {
        id: 'paper',
        title: 'PAPER PRESENTATION',
        tag: 'Technical Research · AI, ECE, Mech, Civil, IT',
        team: '1 – 2 Members',
        prize: '₹10,000',
        split: [5000, 3000, 2000],
        desc: 'Present your original research or technical paper to an expert panel. Shortlisted on abstract, judged on originality, depth and how well you defend your work in the Q&A.',
        rules: [
          'IEEE format abstract for screening',
          '8-minute presentation + Q&A',
          'Plagiarism check enforced'
        ]
      },
      {
        id: 'project',
        title: 'PROJECT PRESENTATION',
        tag: 'Technical Prototype · Working Model',
        team: '1 – 4 Members',
        prize: '₹10,000',
        split: [5000, 3000, 2000],
        desc: 'Bring a working model or prototype and demo it live. Walk the judges through the problem, your build and its real-world impact.',
        rules: [
          'Working model / prototype preferred',
          'Live demonstration + viva',
          'Poster or slide support allowed'
        ]
      },
      {
        id: 'poster',
        title: 'POSTER PRESENTATION',
        tag: 'Technical Visual · Poster Design',
        team: '1 – 2 Members',
        prize: '₹10,000',
        split: [5000, 3000, 2000],
        desc: 'Tell a complete technical story on a single poster, then walk the judges through it. Clarity, creativity and depth of concept win the arena.',
        rules: [
          'Single poster (A1 / as specified)',
          '5-minute walkthrough to judges',
          'Bring a printed copy on the day'
        ]
      },
      {
        id: 'presentation-4',
        title: 'PITCH PRESENTATION',
        tag: 'Startup & Business Pitch',
        team: '1 – 4 Members',
        prize: '₹10,000',
        split: [5000, 3000, 2000],
        desc: 'Pitch a startup or product idea to the panel. Cover the problem, market, solution and business model in a tight, timed pitch — then hold your ground in the Q&A.',
        rules: ['5-minute pitch + 3-minute Q&A', 'Pitch deck of up to 10 slides', 'Prototype or mock-ups welcome']
      }
    ]
  },
  {
    key: 'shockwave',
    name: 'SHOCKWAVE',
    role: 'THE LOGICIAN',
    faction: 'DECEPTICON',
    tagline: 'Hands-on Workshops',
    lore: 'Pure logic, zero emotion. Shockwave runs the labs where raw skill is engineered — hands-on workshops led by industry mentors, ending with a certification.',
    theme: 'purple',
    kind: 'standard',
    colors: { primary: 0x4a2a8c, secondary: 0x1b1733, metal: 0x5e636d, visor: 0xe25cff, glow: 0xc44dff },
    vehicle: 'tank',
    features: { singleEye: true, cannon: true, tallAntennae: true },
    layout: { x: 17.5, z: -10, scale: 1.24, y: 2.0 },   // far right, on a dais
    events: [
      {
        id: 'workshop-core',
        title: 'TECHNICAL WORKSHOP',
        tag: 'Hands-on Lab · Beginner Friendly',
        team: 'Individual',
        prize: 'Certificate of Completion',
        desc: 'Instructor-led, hands-on workshop with live exercises and take-home resources. Beginner friendly and mentor supported, with a certificate on completion.',
        rules: [
          'Bring your own laptop',
          'Limited seats — pre-registration required',
          'Certificate on full attendance'
        ]
      },
      {
        id: 'workshop-track-2',
        title: 'WORKSHOP — TRACK 2',
        tag: 'Hands-on Lab · AI/ML, IoT, Cloud or Security',
        team: 'Individual',
        prize: 'Certificate of Completion',
        desc: 'A second hands-on track on an in-demand stack — AI/ML, IoT & Robotics, Cloud/DevOps or Cybersecurity. Build alongside a mentor and leave with working code.',
        rules: ['Bring your own laptop', 'Pre-registration required', 'Topic & mentor: TBA'],
        placeholder: true
      },
      {
        id: 'workshop-track-3',
        title: 'WORKSHOP — TRACK 3',
        tag: 'Hands-on Lab · Industry Mentors',
        team: 'Individual',
        prize: 'Certificate of Completion',
        desc: 'A third mentor-led lab where you build a small project end to end, with live help at every step and a certificate on completion.',
        rules: ['Bring your own laptop', 'Pre-registration required', 'Topic & mentor: TBA'],
        placeholder: true
      }
    ]
  },
  {
    key: 'ratchet',
    name: 'RATCHET',
    role: 'THE MEDIC',
    faction: 'AUTOBOT',
    tagline: 'The Non-Technical Zone',
    lore: 'The steady hand that keeps the team alive. Ratchet holds the lighter side of the fest — the non-technical events where creativity, reflexes and fun take the stage.',
    theme: 'cyan',
    kind: 'standard',
    colors: { primary: 0xd9dee5, secondary: 0xb4161c, metal: 0x6d747e, visor: 0x3fe0ff, glow: 0x3fe0ff },
    vehicle: 'ambulance',
    features: { twinEyes: true, medicCross: true, wheels: true, lightBar: true },
    layout: { x: -17.5, z: -10, scale: 1.24, y: 2.0 },   // far left, on a dais
    prizePool: 9000,
    events: [
      {
        id: 'photography',
        title: 'PHOTOGRAPHY / REELS',
        tag: 'Creative · Photography & Reels',
        team: 'Individual',
        prize: '₹3,000',
        split: [1500, 1000, 500],
        desc: 'Capture the spirit of OPTIMUS \'27 through your lens — a photo series or a 30-second reel shot on the fest floor. Judged on storytelling, composition and creativity.',
        rules: ['Original content shot during the fest', 'Phones and cameras both allowed', 'Submit before the deadline on the day']
      },
      {
        id: 'gaming',
        title: 'GAMING ARENA',
        tag: 'E-Sports · Mobile & PC',
        team: 'Solo / Squad',
        prize: '₹3,000',
        split: [1500, 1000, 500],
        desc: 'Squad up for a knockout e-sports tournament. Bracket rounds run through the day, with the finals played live on the big screen.',
        rules: ['Bring your own device (if applicable)', 'Bracket-based knockout', 'Fair play — cheating disqualifies the team']
      },
      {
        id: 'quiz-fun',
        title: 'QUIZ & FUN EVENTS',
        tag: 'Quiz & Fun · On-the-spot',
        team: 'Solo / Duo',
        prize: '₹3,000',
        split: [1500, 1000, 500],
        desc: 'Quiz rounds, connections, a treasure hunt and quick on-the-spot games — fast, social and open to everyone at the fest.',
        rules: ['On-the-spot registration possible', 'Multiple mini-rounds', 'Points add up across rounds']
      }
    ]
  }
];

const heroByKey = (k: string | null) => HEROES.find((h) => h.key === k) || null;

// Header jumps to a section: a quick eased glide (brisk start, soft landing) instead of the browser's
// smooth scroll, which lurches over a page this long. It takes under a second even across the whole
// page, the 3D scene holds its frame meanwhile (all the frame time goes to scrolling), the target is
// re-measured every frame, and any wheel / touch / key input hands control straight back to the user.
let glideRaf = 0;
const glideTo = (el: HTMLElement | null, offset?: number, holdScene = true) => {
  if (!el) return;
  cancelAnimationFrame(glideRaf);
  const targetY = () => el.getBoundingClientRect().top + window.scrollY - (offset ?? (parseFloat(getComputedStyle(el).scrollMarginTop) || 0));
  const jump = (y: number) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  const start = window.scrollY;
  const dist = targetY() - start;
  if (Math.abs(dist) < 2) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { jump(targetY()); return; }
  const dur = Math.min(950, 420 + Math.abs(dist) * 0.06);
  const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const stop = () => {
    sceneGate.glide = false;
    cancelAnimationFrame(glideRaf);
    ['wheel', 'touchstart', 'keydown'].forEach((t) => window.removeEventListener(t, stop));
  };
  ['wheel', 'touchstart', 'keydown'].forEach((t) => window.addEventListener(t, stop, { passive: true }));
  sceneGate.glide = holdScene;
  const t0 = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / dur);
    jump(start + (targetY() - start) * ease(k));
    if (k < 1) glideRaf = requestAnimationFrame(step);
    else stop();
  };
  glideRaf = requestAnimationFrame(step);
};

type ThemeTok = (typeof THEME)[ThemeKey];
// Theme colour as hex, for glows (inline styles can't use Tailwind classes).
const hexOf = (t: ThemeTok) => CURSOR_HEX[(Object.keys(THEME) as ThemeKey[]).find((k) => THEME[k] === t) ?? 'amber'];

// Facts strip under an event: domain, team size and any extra facts (duration, format …).
function EventFacts({ ev, t, bare = false }: { ev: EventItem; t: ThemeTok; bare?: boolean }) {
  const facts = [
    ...(ev.tag ? [{ label: 'Domain', value: ev.tag, wide: true }] : []),
    { label: 'Team', value: ev.team, wide: false },
    ...(ev.extra ?? []).map((x) => ({ ...x, wide: false }))
  ];
  return (
    <div className={`${bare ? '' : 'mt-5 pt-4 border-t border-slate-800/80 '}grid grid-cols-2 gap-x-4 gap-y-3 text-xs font-mono`}>
      {facts.map((f) => (
        <div key={f.label} className={f.wide ? 'col-span-2' : ''}>
          <span className="text-slate-500 uppercase block text-[10px] tracking-wider">{f.label}</span>
          <span className={f.label === 'Domain' ? t.text : 'text-slate-200'}>{f.value}</span>
        </div>
      ))}
    </div>
  );
}

// The event's prize pool as a big glowing figure with the 1st / 2nd / 3rd split beside it;
// workshops (no cash prize) show the certificate instead.
function EventPrize({ ev, hex, t }: { ev: EventItem; hex: string; t: ThemeTok }) {
  const cash = ev.prize.startsWith('₹');
  return (
    <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex items-center gap-2.5">
        <span className={`text-3xl sm:text-4xl font-black tracking-tight leading-none ${t.text}`} style={{ fontStretch: '110%', textShadow: `0 0 22px ${hex}66` }}>
          {cash ? ev.prize : 'CERTIFIED'}
        </span>
        <span className="font-mono text-[10px] sm:text-[11px] font-bold tracking-[0.25em] text-slate-400 leading-tight">
          {cash ? <>PRIZE<br />POOL</> : <>CERTIFICATE OF<br />COMPLETION</>}
        </span>
      </div>
      {ev.split && (
        <div className="flex gap-4 font-mono">
          {ev.split.map((amt, k) => (
            <div key={k} className="text-right">
              <span className="text-slate-500 block text-[9px] tracking-wider">{['1ST', '2ND', '3RD'][k]}</span>
              <span className={`text-xs font-black ${['pz-gold', 'pz-silver', 'pz-bronze'][k]}`}>{inr(amt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Event fields the admin panel may override (see adminData.ts).
export const EDITABLE_EVENT_FIELDS = ['title', 'tag', 'team', 'prize', 'desc', 'rules', 'placeholder'] as const;
// Layers admin edits over the built-in data above, in place.
const applyOverrides = (overrides: Overrides) => {
  for (const [id, data] of Object.entries(overrides)) {
    if (id.startsWith('hero:')) {
      const h = heroByKey(id.slice(5));
      if (h && typeof data.prizePool === 'number') h.prizePool = data.prizePool;
      continue;
    }
    const ev = HEROES.flatMap((h) => h.events).find((e) => e.id === id);
    if (!ev) continue;
    for (const f of EDITABLE_EVENT_FIELDS) if (f in data) (ev as Record<string, unknown>)[f] = data[f];
  }
};

/* ============================ FEST PASSES ========================= */
export type PassId = 'hackathon' | 'oneday' | 'twoday' | 'exclusive';
type FestPass = {
  id: PassId; name: string; price: number; theme: ThemeKey; badge?: string;
  blurb: string; perks: string[]; valid: string;
  team?: { min: number; max: number };  // priced per member; one registration covers the whole team
  pickDay?: boolean;                    // valid on a single day the holder chooses
  hackathon: boolean;                   // includes the Bumblebee Hackathon
};
export const FEST_DAYS = ['FEB 4', 'FEB 5'];
export const PASSES: FestPass[] = [
  {
    id: 'hackathon', name: 'HACKATHON PASS', price: 500, theme: 'amber', badge: 'FLAGSHIP',
    blurb: 'Entry to the 24-hour Bumblebee Hackathon for your whole team.',
    perks: ['24-hour flagship hackathon', 'Teams of 2 – 4 members', '₹500 for each team member'],
    valid: 'FEB 4 – 5 · 24 HOURS', team: { min: 2, max: 4 }, hackathon: true
  },
  {
    id: 'oneday', name: 'ONE-DAY PASS', price: 300, theme: 'cyan',
    blurb: 'A day of technical and fun events on Feb 4 or Feb 5.',
    perks: ['1 of the 2 presentations that day', '1 workshop', '1 non-technical event', 'Valid on one day: Feb 4 or Feb 5'],
    valid: '', pickDay: true, hackathon: false
  },
  {
    id: 'twoday', name: 'TWO-DAY PASS', price: 400, theme: 'purple',
    blurb: 'Both days of the fest, double the events.',
    perks: ['2 of the 4 presentations', '2 workshops', '2 non-technical events', 'Valid on Feb 4 & Feb 5'],
    valid: 'FEB 4 & FEB 5', hackathon: false
  },
  {
    id: 'exclusive', name: 'EXCLUSIVE PASS', price: 500, theme: 'rose', badge: 'ALL ACCESS',
    blurb: 'Every event at OPTIMUS \'27 except the hackathon.',
    perks: ['All presentations', 'All workshops', 'All non-technical events', 'Valid on Feb 4 & Feb 5'],
    valid: 'FEB 4 & FEB 5', hackathon: false
  }
];
const passById = (id: PassId) => PASSES.find((p) => p.id === id)!;
// Passes that grant entry to an event: the hackathon needs a hackathon pass, everything else any other pass.
const passesFor = (ev: EventItem) => PASSES.filter((p) => (ev.id === 'hackathon' ? p.hackathon : p.id !== 'hackathon'));
export const inr = (n: number) => '₹' + n.toLocaleString('en-IN');

/* ==================== THREE.JS HERO BACKGROUND ==================== */
// Cinematic procedural stage. Mechs are built from faceted, extruded armour
// plates over an exposed mechanical frame, finished with weathered PBR paint
// (grime/scratch roughness, panel-seam bump, dirt), and stand on a wet
// reflective floor in front of a hazy city skyline, sweeping searchlights, a
// backlit energy gate and drifting embers.
const GROUND_Y = -3.0;

const canvasTexture = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = false) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
};

// Roughness: mid grey with glossy/rough blotches, fine noise and bright scratches.
const makeGrimeTexture = () => canvasTexture(512, 512, (g) => {
  g.fillStyle = '#8c8c8c';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 12 + Math.random() * 70;
    const v = Math.random() < 0.5 ? 70 : 205;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${v},${v},${v},0.32)`);
    grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = `rgba(235,235,235,${0.25 + Math.random() * 0.4})`;
    g.lineWidth = 0.4 + Math.random() * 1.1;
    const x = Math.random() * 512, y = Math.random() * 512, a = Math.random() * Math.PI, l = 5 + Math.random() * 45;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
});

// Bump: recessed panel seams with a raised lip, rivets and vent slots.
const makePanelTexture = () => canvasTexture(512, 512, (g) => {
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 512, 512);
  const split = (x: number, y: number, w: number, h: number, d: number) => {
    if (d > 3 || w < 70 || h < 70 || Math.random() < 0.18 * d) {
      g.strokeStyle = '#262626';
      g.lineWidth = 3;
      g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      g.strokeStyle = '#b4b4b4';
      g.lineWidth = 1;
      g.strokeRect(x + 4, y + 4, w - 8, h - 8);
      g.fillStyle = '#d2d2d2';
      [[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + h - 9], [x + w - 9, y + h - 9]].forEach(([rx, ry]) => {
        g.beginPath();
        g.arc(rx, ry, 2.2, 0, Math.PI * 2);
        g.fill();
      });
      if (Math.random() < 0.25) {
        g.fillStyle = '#303030';
        for (let k = 0; k < 5; k++) g.fillRect(x + w * 0.2, y + h * 0.3 + k * 8, w * 0.6, 3);
      }
      return;
    }
    if (w > h) {
      const s = w * (0.3 + Math.random() * 0.4);
      split(x, y, s, h, d + 1);
      split(x + s, y, w - s, h, d + 1);
    } else {
      const s = h * (0.3 + Math.random() * 0.4);
      split(x, y, w, s, d + 1);
      split(x, y + s, w, h - s, d + 1);
    }
  };
  split(0, 0, 512, 512, 0);
});

// Colour multiplier: soot blotches and vertical grime streaks.
const makeDirtTexture = () => canvasTexture(512, 512, (g) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 20 + Math.random() * 80;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(70,60,50,0.1)');
    grad.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, l = 30 + Math.random() * 120;
    const grad = g.createLinearGradient(x, y, x, y + l);
    grad.addColorStop(0, 'rgba(40,35,30,0.12)');
    grad.addColorStop(1, 'rgba(40,35,30,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, 1 + Math.random() * 3, l);
  }
}, true);

const makeGlowTexture = () => canvasTexture(256, 256, (g) => {
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
}, true);

const makeWindowTexture = () => canvasTexture(128, 256, (g) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 256);
  for (let y = 6; y < 250; y += 9) {
    for (let x = 5; x < 122; x += 8) {
      if (Math.random() < 0.28) {
        g.fillStyle = Math.random() < 0.6
          ? `rgba(255,${(170 + Math.random() * 60) | 0},90,${0.5 + Math.random() * 0.5})`
          : `rgba(120,200,255,${0.4 + Math.random() * 0.5})`;
        g.fillRect(x, y, 4, 5);
      }
    }
  }
}, true);

const makeGridTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.22)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(128, 0);
  g.lineTo(128, 256);
  g.moveTo(0, 128);
  g.lineTo(256, 128);
  g.stroke();
}, true);

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uTime;
uniform float uStars;
varying vec3 vDir;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.22, h));
  col = mix(col, uTop, smoothstep(0.22, 0.85, h));
  float g = pow(max(dot(normalize(vec3(d.x, d.y * 3.0, d.z)), vec3(0.0, 0.0, -1.0)), 0.0), 5.0);
  col += uGlow * g * 1.3;
  col = mix(col, uHorizon * 0.25, 1.0 - smoothstep(-0.35, 0.0, h));
  if (uStars > 0.5 && h > 0.12) {
    float s = hash(floor(d * 380.0));
    float tw = 0.55 + 0.45 * sin(uTime * 1.7 + s * 60.0);
    col += vec3(0.85, 0.9, 1.0) * step(0.9972, s) * tw * smoothstep(0.12, 0.45, h);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float edge = pow(abs(dot(vN, vV)), 2.0);
  // Clamp: interpolated vUv.y can overshoot 1.0 at the cone rim, and pow() of a
  // negative base is NaN (rendered as black arcs on screen).
  float fade = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4) * smoothstep(0.0, 0.04, vUv.y);
  gl_FragColor = vec4(uColor * uIntensity * edge * fade, 1.0);
}`;

const makeSkyMaterial = (glow: THREE.Color, stars: boolean) =>
  new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(0x020409) },
      uMid: { value: new THREE.Color(0x07101f) },
      uHorizon: { value: new THREE.Color(0x142a44) },
      uGlow: { value: glow },
      uTime: { value: 0 },
      uStars: { value: stars ? 1 : 0 }
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false
  });

// Soft, seamlessly tiling cloud noise (alpha) for ground mist and sky cloud banks.
const makeCloudTexture = () => canvasTexture(256, 256, (g) => {
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 18 + Math.random() * 60;
    const a = 0.05 + Math.random() * 0.12;
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
});

// Concentric bands for the planet ring (RingGeometry UVs are planar, so draw circles).
const makeRingTexture = () => canvasTexture(512, 512, (g) => {
  g.clearRect(0, 0, 512, 512);
  for (let r = 166; r < 255; r++) {
    const edge = (r > 230 ? (255 - r) / 25 : 1) * (r < 180 ? (r - 166) / 14 : 1);
    const a = (0.15 + 0.6 * Math.abs(Math.sin(r * 0.21) * Math.sin(r * 0.057))) * edge;
    g.strokeStyle = `rgba(255,255,255,${a})`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(256, 256, r, 0, Math.PI * 2);
    g.stroke();
  }
}, true);

// Neon billboard face: glowing frame, big title, small caption.
const makeBillboardTexture = (title: string, sub: string, color: string) => canvasTexture(512, 256, (g) => {
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.strokeRect(14, 14, 484, 228);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 86;
  g.font = '900 ' + size + 'px "Arial Black", Impact, sans-serif';
  while (g.measureText(title).width > 450 && size > 30) {
    size -= 4;
    g.font = '900 ' + size + 'px "Arial Black", Impact, sans-serif';
  }
  g.fillStyle = color;
  g.fillText(title, 256, 112);
  g.shadowBlur = 8;
  g.fillStyle = '#e8f1ff';
  g.font = '700 28px "Courier New", monospace';
  g.fillText(sub, 256, 196);
}, true);

const PLANET_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const PLANET_FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uLight;
varying vec3 vN;
varying vec3 vV;
varying vec3 vP;
void main() {
  float fres = pow(clamp(1.0 - dot(vN, vV), 0.0, 1.0), 3.0);
  float lit = max(dot(vN, normalize(uLight)), 0.0);
  vec3 p = normalize(vP);
  float bands = 0.5 + 0.5 * sin(p.y * 22.0 + sin(p.x * 9.0) * 1.6);
  float grid = max(step(0.965, fract(p.x * 18.0 + 0.5)), step(0.965, fract(p.y * 18.0 + 0.5)));
  vec3 surf = mix(vec3(0.025, 0.03, 0.045), vec3(0.09, 0.1, 0.13), bands) * (0.15 + lit * 1.3);
  vec3 cityGlow = vec3(1.0, 0.55, 0.25) * grid * 0.35 * (1.0 - smoothstep(0.0, 0.35, lit));
  gl_FragColor = vec4(surf + cityGlow + uRim * fres * 1.8, 1.0);
}`;

// Rough GPU class so phones and integrated-graphics laptops get a lighter scene.
//   low  – phones/tablets, software renderers, Intel integrated GPUs, ≤4 cores or ≤4 GB RAM
//   mid  – AMD integrated GPUs and small screens
//   high – discrete GPUs and Apple silicon
type QualityTier = 'low' | 'mid' | 'high';
let cachedTier: QualityTier | null = null;
const detectQualityTier = (width: number = window.innerWidth): QualityTier =>
  (cachedTier ??= probeQualityTier(width));
const probeQualityTier = (width: number): QualityTier => {
  const q = new URLSearchParams(window.location.search).get('quality');
  if (q === 'low' || q === 'mid' || q === 'high') return q;
  const ua = navigator.userAgent;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (navigator.maxTouchPoints > 1 && window.matchMedia('(pointer: coarse)').matches);
  const cores = navigator.hardwareConcurrency || 8;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL info — fall back to the other hints */ }
  if (mobile || cores <= 4 || mem <= 4) return 'low';
  // Every Intel integrated GPU (HD, UHD, Iris, Xe) goes to lite: measured ~24 fps with bloom vs a steady cap without.
  if (/SwiftShader|llvmpipe|Software|Basic Render|Mali|Adreno|PowerVR|Intel(?!.*Arc)/i.test(gpu)) return 'low';
  // Privacy browsers (Brave, Firefox resist-fingerprinting) hide or fake the GPU name; without a
  // name we can trust, don't assume a discrete GPU. The render loop still drops effects if it lags.
  if (!gpu || width < 1024 || /Radeon(\(TM\))? Graphics|Vega|Generic|ANGLE \(Google/i.test(gpu)) return 'mid';
  return 'high';
};

// Lets the stylesheet drop paint-heavy decoration (filters, blurs, particles) on weaker devices.
if (typeof document !== 'undefined') document.documentElement.classList.add(`tier-${detectQualityTier()}`);

// Scroll-driven "events stage": the events section writes which leader is on stage and where
// (u: −1 = left screen edge, +1 = right edge, beyond ±1 = off screen). Mutated in place on scroll,
// read every frame, so scrolling never re-renders React.
// Set while opaque page content hides the whole 3D scene (the techno-fest + prize sections filling
// the screen, or the certificate page's backdrop). The render loop idles then, which frees the
// GPU / CPU for scrolling on phones and integrated-graphics laptops.
export const sceneGate = { scroll: false, page: false, glide: false };

export type StageState = {
  key: string | null;
  u: number;
  introId: number;     // bumps when a leader appears for the first time: play its drive-in + transform
  introKey: string;
  fromU: number;       // where that first entrance starts (off screen, on the card's side)
  standU: number;      // where it stops and transforms
  enterU: number;      // off-screen edge the current leader joins from (depends on scroll direction)
  leaveKey: string;    // leader that just lost the stage: it keeps walking until it is off screen
  leaveU: number;      // the off-screen edge it walks to
  settled: boolean;    // set by the 3D scene: the leader on stage has finished its intro and reached its mark
};

const ThreeHeroBackground = ({
  activeHero,
  onSelectHero,
  intro,
  paused = false,
  onReady,
  stage
}: {
  activeHero: string | null;
  onSelectHero: (key: string) => void;
  intro: { key: string; id: number } | null;
  paused?: boolean;    // true while something opaque covers the scene
  onReady?: () => void;   // fired once the scene is built and its first frames are drawn
  stage?: React.MutableRefObject<StageState>;
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  const focusRef = useRef<string | null>(activeHero);
  const selectRef = useRef(onSelectHero);

  useEffect(() => { focusRef.current = activeHero; }, [activeHero]);
  useEffect(() => { selectRef.current = onSelectHero; }, [onSelectHero]);
  const introRef = useRef(intro);
  useEffect(() => { introRef.current = intro; }, [intro]);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Size is zero-safe: the pane can be hidden (0x0) when the scene inits,
    // which would make the post-processing framebuffers incomplete.
    const getSize = () => ({
      w: mount.clientWidth || window.innerWidth || 1,
      h: mount.clientHeight || window.innerHeight || 1
    });
    const size0 = getSize();
    const tier = detectQualityTier(size0.w);
    const lowPower = tier !== 'high';
    // Lite: no post-processing, shadows or HDR download; renders straight to the canvas.
    const lite = tier === 'low';
    const isPhone = size0.w < 768;
    // The wet mirror floor re-renders the whole scene, so only the high tier gets it.
    const useMirror = !lowPower;
    const reflectScale = isPhone ? 0.35 : 0.5;

    /* ---------- renderer / camera ---------- */
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1628, 0.014);

    const camera = new THREE.PerspectiveCamera(48, size0.w / size0.h, 0.5, 400);
    camera.position.set(0, 2.2, 18);

    // Everything is drawn through the composer's multisampled target, so the canvas
    // itself needs no MSAA. Render scale adapts to the frame rate (see animate()).
    // In lite mode there is no composer, so the canvas does its own (cheap) MSAA.
    const renderer = new THREE.WebGLRenderer({ antialias: lite, powerPreference: 'high-performance' });
    const DPR_MAX = Math.min(window.devicePixelRatio, tier === 'high' && !isPhone ? 1.25 : 1);
    const DPR_MIN = lite ? 0.5 : 0.7;
    let dprCap = DPR_MAX;   // lowered once effects have been shed, so the scale never creeps back up into lag
    let dpr = DPR_MAX;
    renderer.setSize(size0.w, size0.h);
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.62;
    renderer.shadowMap.enabled = !lite;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // The mirror floor re-renders the scene; without this the shadow map is redrawn
    // for that pass too. animate() flags one shadow update per frame instead.
    renderer.shadowMap.autoUpdate = false;
    mount.appendChild(renderer.domElement);

    /* ---------- shared procedural textures ---------- */
    const grimeTex = makeGrimeTexture();
    const panelTex = makePanelTexture();
    const dirtTex = makeDirtTexture();
    const glowTex = makeGlowTexture();
    const windowTex = makeWindowTexture();
    const gridTex = makeGridTexture();
    gridTex.repeat.set(66, 66);
    panelTex.repeat.set(0.45, 0.45);
    dirtTex.repeat.set(0.6, 0.6);
    const floorRough = grimeTex.clone();
    floorRough.repeat.set(12, 12);
    floorRough.needsUpdate = true;
    const textures = [grimeTex, panelTex, dirtTex, glowTex, windowTex, gridTex, floorRough];

    /* ---------- environment reflections matched to the backdrop ---------- */
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), makeSkyMaterial(new THREE.Color(0xff8a3d), false)));
    const softbox = (color: number, k: number, w: number, h: number, pos: [number, number, number]) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide })
      );
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      envScene.add(m);
    };
    softbox(0xffffff, 5, 12, 4, [0, 15, 6]);      // overhead key
    softbox(0x9fd4ff, 3, 4, 12, [-15, 3, 3]);     // cool side strip
    softbox(0xffb070, 3, 4, 12, [15, 3, -4]);     // warm side strip
    softbox(0xffd6b0, 1.6, 14, 3, [0, 1.5, -17]); // horizon strip behind
    let envRT = pmrem.fromScene(envScene, 0.02);
    scene.environment = envRT.texture;
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
    // Real photographed night-city lighting (Poly Haven "Shanghai Bund", CC0); the studio
    // environment above stays as the fallback until it loads.
    // The HDR is a 6 MB download plus a costly PMREM bake — lite devices keep the studio env.
    let envDisposed = false;
    if (!lite) new RGBELoader().load(BASE + 'env/shanghai_bund_2k.hdr', (hdr) => {
      if (envDisposed) {
        hdr.dispose();
        return;
      }
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const rt = pmrem.fromEquirectangular(hdr);
      hdr.dispose();
      envRT.dispose();
      envRT = rt;
      scene.environment = rt.texture;
      scene.environmentIntensity = 0.28;
      // Vehicles keep livelier reflections than the robots so paint, glass and rims read as real.
      Object.values(records).forEach((r) => r.vehMats.forEach((m) => {
        m.envMap = rt.texture;
        m.envMapIntensity = m.userData.vehEnv ?? 0.8;
        m.needsUpdate = true;
      }));
    });

    /* ---------- sky dome ---------- */
    const DEFAULT_ACCENT = 0xffa040;
    const accentNow = new THREE.Color(DEFAULT_ACCENT);
    const accentTarget = new THREE.Color(DEFAULT_ACCENT);
    const skyMat = makeSkyMaterial(new THREE.Color(DEFAULT_ACCENT).multiplyScalar(0.28), true);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(160, 48, 24), skyMat);
    sky.renderOrder = -1;
    scene.add(sky);

    /* ---------- lighting ---------- */
    scene.add(new THREE.HemisphereLight(0x6f86b0, 0x0a0c12, 0.35));
    const key = new THREE.DirectionalLight(0xfff0dc, 1.5);
    key.position.set(8, 18, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 70;
    key.shadow.camera.left = -16;
    key.shadow.camera.right = 16;
    key.shadow.camera.top = 16;
    key.shadow.camera.bottom = -16;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.025;
    scene.add(key);
    const rimWarm = new THREE.DirectionalLight(0xff9a3c, 1.1);
    rimWarm.position.set(-10, 6, -14);
    scene.add(rimWarm);
    const rimCool = new THREE.DirectionalLight(0x57b8ff, 1.0);
    rimCool.position.set(10, 5, -14);
    scene.add(rimCool);
    const frontFill = new THREE.DirectionalLight(0x8aa4d6, 0.35);
    frontFill.position.set(0, 2, 16);
    scene.add(frontFill);
    const gateLight = new THREE.PointLight(DEFAULT_ACCENT, 28, 30, 2);
    gateLight.position.set(0, GROUND_Y + 4.5, -8);
    scene.add(gateLight);

    /* ---------- wet reflective floor ---------- */
    let reflector: Reflector | null = null;
    if (useMirror) {
      reflector = new Reflector(new THREE.PlaneGeometry(220, 220), {
        clipBias: 0.003,
        textureWidth: Math.floor(size0.w * reflectScale),
        textureHeight: Math.floor(size0.h * reflectScale),
        color: 0x1e2126
      });
      reflector.rotation.x = -Math.PI / 2;
      reflector.position.y = GROUND_Y - 0.01;
      scene.add(reflector);
    }
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshStandardMaterial({
        color: 0x06080d, metalness: 0.4, roughness: 0.9, roughnessMap: floorRough,
        emissive: 0x1c6a94, emissiveMap: gridTex, emissiveIntensity: 0.5,
        transparent: !!reflector, opacity: reflector ? 0.95 : 1,
        // Always win the depth test against the mirror just beneath it (no shimmer).
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      })
    );
    floor.renderOrder = 1;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = GROUND_Y;
    floor.receiveShadow = true;
    scene.add(floor);

    /* ---------- city skyline (instanced) ---------- */
    const CITY = 170;
    const cityGeo = new THREE.BoxGeometry(1, 1, 1);
    cityGeo.translate(0, 0.5, 0);
    const cityMat = new THREE.MeshStandardMaterial({
      color: 0x0a0f18, metalness: 0.75, roughness: 0.38,
      emissive: 0xffffff, emissiveMap: windowTex, emissiveIntensity: 0.7, envMapIntensity: 0.35
    });
    // Scale window UVs by each building's size so windows don't stretch on tall towers.
    cityMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        #if defined(USE_INSTANCING) && defined(USE_EMISSIVEMAP)
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec3 an = abs(normal);
          vec2 fs = an.x > 0.5 ? sc.zy : (an.y > 0.5 ? vec2(0.0) : sc.xy);
          vEmissiveMapUv *= fs / vec2(6.0, 12.0);
        #endif`
      );
    };
    const city = new THREE.InstancedMesh(cityGeo, cityMat, CITY);
    const beaconPos: number[] = [];
    const tierMats: THREE.Matrix4[] = [];
    const mastMats: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (let i = 0; i < CITY; i++) {
      const a = Math.PI + 0.32 + Math.random() * (Math.PI - 0.64); // behind the stage
      const r = 55 + Math.random() * 55;
      const h = 8 + Math.pow(Math.random(), 1.6) * 55;
      const w = 2 + Math.random() * 5, d = 2 + Math.random() * 5;
      dummy.position.set(Math.cos(a) * r, GROUND_Y - 0.5, Math.sin(a) * r);
      dummy.scale.set(w, h, d);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.updateMatrix();
      city.setMatrixAt(i, dummy.matrix);
      let top = GROUND_Y - 0.5 + h;
      // Setback tier on taller towers breaks up the boxy silhouette.
      if (h > 18 && Math.random() < 0.7) {
        const th = h * (0.12 + Math.random() * 0.2);
        dummy.position.y = top;
        dummy.scale.set(w * (0.5 + Math.random() * 0.25), th, d * (0.5 + Math.random() * 0.25));
        dummy.updateMatrix();
        tierMats.push(dummy.matrix.clone());
        top += th;
      }
      // Antenna mast with an aviation beacon on the tallest towers.
      if (h > 30) {
        const mh = 4 + Math.random() * 6;
        dummy.position.y = top;
        dummy.scale.set(1, mh, 1);
        dummy.updateMatrix();
        mastMats.push(dummy.matrix.clone());
        beaconPos.push(dummy.position.x, top + mh + 0.3, dummy.position.z);
      }
    }
    scene.add(city);
    const tiers = new THREE.InstancedMesh(cityGeo, cityMat, Math.max(1, tierMats.length));
    tierMats.forEach((m, i) => tiers.setMatrixAt(i, m));
    tiers.count = tierMats.length;
    scene.add(tiers);
    const mastGeo = new THREE.CylinderGeometry(0.1, 0.22, 1, 6);
    mastGeo.translate(0, 0.5, 0);
    const masts = new THREE.InstancedMesh(mastGeo, new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.8, roughness: 0.5 }), Math.max(1, mastMats.length));
    mastMats.forEach((m, i) => masts.setMatrixAt(i, m));
    masts.count = mastMats.length;
    scene.add(masts);
    const beaconGeo = new THREE.BufferGeometry();
    beaconGeo.setAttribute('position', new THREE.Float32BufferAttribute(beaconPos, 3));
    const beaconMat = new THREE.PointsMaterial({
      size: 1.4, map: glowTex, color: 0xff3a2a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    scene.add(new THREE.Points(beaconGeo, beaconMat));

    /* ---------- far sky: ringed planet, cloud banks, ground mist, air traffic ---------- */
    const cloudTex = makeCloudTexture();
    const ringTex = makeRingTexture();
    textures.push(cloudTex, ringTex);
    const rimCol = new THREE.Color(0x5fb8ff);
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(20, 64, 32),
      new THREE.ShaderMaterial({
        uniforms: { uRim: { value: rimCol }, uLight: { value: new THREE.Vector3(0.8, 0.35, 0.45) } },
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG
      })
    );
    planet.position.set(-58, 40, -128);
    planet.rotation.set(0.3, 0.6, 0.2);
    scene.add(planet);
    const planetGlow = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), new THREE.MeshBasicMaterial({
      map: glowTex, color: rimCol.clone().multiplyScalar(0.45), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    }));
    planetGlow.position.set(-58, 40, -132);
    planetGlow.lookAt(0, 2, 18);
    scene.add(planetGlow);
    const planetRing = new THREE.Mesh(new THREE.RingGeometry(27, 42, 160), new THREE.MeshBasicMaterial({
      map: ringTex, color: 0xb9d4ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false
    }));
    planetRing.position.copy(planet.position);
    planetRing.rotation.set(1.2, 0.2, 0.35);
    scene.add(planetRing);

    const cloudLayers: THREE.Texture[] = [];
    for (let i = 0; i < 4; i++) {
      const tex = cloudTex.clone();
      tex.repeat.set(2.2, 1);
      tex.offset.set(Math.random(), 0);
      tex.needsUpdate = true;
      cloudLayers.push(tex);
      textures.push(tex);
      const cm = new THREE.Mesh(new THREE.PlaneGeometry(260, 34), new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x3a5378).multiplyScalar(0.9 - i * 0.12),
        alphaMap: tex, transparent: true, opacity: 0.55, depthWrite: false, fog: false
      }));
      cm.position.set((Math.random() - 0.5) * 30, 14 + i * 9, -145 + i * 4);
      scene.add(cm);
    }

    const mistLayers: THREE.Texture[] = [];
    [0.25, 0.7, 1.2].forEach((h, i) => {
      const tex = cloudTex.clone();
      tex.repeat.set(5, 5);
      tex.needsUpdate = true;
      mistLayers.push(tex);
      textures.push(tex);
      const mist = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshBasicMaterial({
        color: 0x7892b4, alphaMap: tex, transparent: true, opacity: 0.2 - i * 0.04, depthWrite: false
      }));
      mist.rotation.x = -Math.PI / 2;
      mist.position.y = GROUND_Y + h;
      mist.renderOrder = 2;
      scene.add(mist);
    });

    const CRAFT = 7;
    const craft = Array.from({ length: CRAFT }, () => ({
      y: 16 + Math.random() * 22,
      z: -45 - Math.random() * 70,
      speed: (0.004 + Math.random() * 0.006) * (Math.random() < 0.5 ? 1 : -1),
      phase: Math.random()
    }));
    const cGeo = new THREE.BufferGeometry();
    const cPos = new Float32Array(CRAFT * 6);
    const cCol = new Float32Array(CRAFT * 6);
    cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
    cGeo.setAttribute('color', new THREE.BufferAttribute(cCol, 3));
    const craftPts = new THREE.Points(cGeo, new THREE.PointsMaterial({
      size: 0.9, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    }));
    craftPts.frustumCulled = false;
    scene.add(craftPts);

    /* ---------- neon billboards across the skyline ---------- */
    // [title, subtitle, colour, x, y, z] — positioned in the open sky either side of the
    // centre column so the robots and hero text never cover them from the home camera.
    const BOARDS: [string, string, string, number, number, number][] = [
      ['RATCHET', 'NON-TECH ZONE', '#3fe0ff', -35, 15.2, -37.6],
      ['MEGATRON', 'PRESENTATION ARENA', '#ff3b3b', -20, 15.2, -37.6],
      ['BUMBLEBEE', '24-HOUR HACKATHON', '#ffd23a', 20, 15.2, -37.6],
      ['SHOCKWAVE', 'HANDS-ON WORKSHOPS', '#d05cff', 35, 15.2, -37.6]
    ];
    const boards: THREE.MeshBasicMaterial[] = [];
    const boardBright = new THREE.Color(0.6, 0.6, 0.6);
    const boardFrame = new THREE.MeshStandardMaterial({ color: 0x0c1017, metalness: 0.8, roughness: 0.5 });
    BOARDS.forEach(([title, sub, col, x, y, z]) => {
      const tex = makeBillboardTexture(title, sub, col);
      textures.push(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: boardBright.clone() });
      boards.push(mat);
      const sign = new THREE.Group();
      sign.position.set(x, y, z);
      sign.lookAt(0, 2.6, 18);
      scene.add(sign);
      sign.add(new THREE.Mesh(new THREE.PlaneGeometry(12, 6), mat));
      const back = new THREE.Mesh(new THREE.BoxGeometry(12.6, 6.6, 0.4), boardFrame);
      back.position.z = -0.25;
      sign.add(back);
      const poleH = y - 3 - GROUND_Y;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, poleH, 0.5), boardFrame);
      pole.position.set(sign.position.x, GROUND_Y + poleH / 2, sign.position.z);
      scene.add(pole);
    });

    /* ---------- info + sponsor stands standing on the arena floor (home view) ---------- */
    const standMQ = window.matchMedia('(min-width: 768px) and (min-aspect-ratio: 6/5)');
    const liveCanvas = (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      textures.push(t);
      return { g: c.getContext('2d')!, t, w, h };
    };
    type LiveCanvas = ReturnType<typeof liveCanvas>;
    const spaced = (g: CanvasRenderingContext2D, px: number) => {
      (g as unknown as { letterSpacing: string }).letterSpacing = px + 'px';
    };
    const panelBase = (cv: LiveCanvas) => {
      const { g, w, h } = cv;
      g.clearRect(0, 0, w, h);
      const bg = g.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#1b2433');
      bg.addColorStop(0.5, '#0d1320');
      bg.addColorStop(1, '#05080f');
      g.fillStyle = bg;
      g.beginPath();
      g.roundRect(4, 4, w - 8, h - 8, 22);
      g.fill();
      g.strokeStyle = 'rgba(148,163,184,0.45)';
      g.lineWidth = 4;
      g.stroke();
      g.strokeStyle = 'rgba(103,232,249,0.85)';
      g.lineWidth = 6;
      const L = 46, m = 18;
      [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]].forEach(([x, y, sx, sy]) => {
        g.beginPath();
        g.moveTo(x, y + sy * L);
        g.lineTo(x, y);
        g.lineTo(x + sx * L, y);
        g.stroke();
      });
    };
    const fontFace = '"Inter", ui-sans-serif, sans-serif';
    const infoCv = liveCanvas(1024, 648);
    const drawInfo = () => {
      panelBase(infoCv);
      const { g } = infoCv;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      const section = (y: number, label: string, labelCol: string, value: string, valueCol: string, sub: string) => {
        spaced(g, 9);
        g.font = `600 30px ${fontFace}`;
        g.fillStyle = labelCol;
        g.fillText(label, 64, y);
        spaced(g, 1);
        g.font = `700 70px ${fontFace}`;
        g.fillStyle = valueCol;
        g.fillText(value, 60, y + 88);
        spaced(g, 6);
        g.font = `500 24px ${fontFace}`;
        g.fillStyle = 'rgba(148,163,184,0.75)';
        g.fillText(sub, 64, y + 132);
      };
      section(92, 'SECTOR COORDINATES', 'rgba(103,232,249,0.9)', '11.0782° N, 77.1386° E', '#ecfeff', 'KPRIET · COIMBATORE');
      g.strokeStyle = 'rgba(148,163,184,0.25)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(60, 320);
      g.lineTo(964, 320);
      g.stroke();
      section(398, 'TEMPORAL EVENT WINDOW', 'rgba(252,211,77,0.95)', '4.2.2027  —  5.2.2027', '#fef3c7', 'TWO-DAY DEPLOYMENT');
      spaced(g, 0);
      infoCv.t.needsUpdate = true;
    };
    const sponsorCv = liveCanvas(1024, 520);
    const logoImgs: HTMLImageElement[] = [BASE + 'assets/acmw.png', BASE + 'assets/nexora.png'].map((src) => {
      const im = new Image();
      im.src = src;
      return im;
    });
    const drawSponsor = () => {
      panelBase(sponsorCv);
      const { g } = sponsorCv;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      spaced(g, 14);
      g.font = `600 32px ${fontFace}`;
      g.fillStyle = 'rgba(165,243,252,0.9)';
      g.fillText('PRESENTED BY', 512, 96);
      spaced(g, 0);
      const boxH = 270, cy = 300;
      logoImgs.forEach((im, i) => {
        if (!im.complete || !im.naturalWidth) return;
        const s = Math.min(boxH / im.naturalHeight, 380 / im.naturalWidth);
        const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
        const cx = i === 0 ? 266 : 758;
        g.drawImage(im, cx - dw / 2, cy - dh / 2, dw, dh);
      });
      const div = g.createLinearGradient(0, 170, 0, 440);
      div.addColorStop(0, 'rgba(148,163,184,0)');
      div.addColorStop(0.5, 'rgba(148,163,184,0.55)');
      div.addColorStop(1, 'rgba(148,163,184,0)');
      g.fillStyle = div;
      g.fillRect(511, 170, 2, 270);
      sponsorCv.t.needsUpdate = true;
    };
    drawInfo();
    drawSponsor();
    logoImgs.forEach((im) => { im.onload = drawSponsor; });
    document.fonts?.load(`700 70px Inter`).then(() => { drawInfo(); drawSponsor(); }).catch(() => {});

    const standGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x67e8f9).multiplyScalar(2.2) });
    const standMetal = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.95, roughness: 0.3 });
    const makeStand = (cv: LiveCanvas, w: number, h: number) => {
      const grp = new THREE.Group();
      const postH = 0.7;
      const face = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: cv.t, transparent: true, color: new THREE.Color(0.88, 0.88, 0.88), fog: false })
      );
      face.position.set(0, postH + h / 2, 0.06);
      grp.add(face);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.1), boardFrame);
      back.position.set(0, postH + h / 2, 0);
      grp.add(back);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, 0.04, 0.04), standGlow);
      strip.position.set(0, postH + h + 0.03, 0.08);
      grp.add(strip);
      [-1, 1].forEach((s) => {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, postH + 0.1, 12), standMetal);
        post.position.set(s * w * 0.31, (postH + 0.1) / 2, -0.02);
        post.castShadow = true;
        grp.add(post);
      });
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 0.1, 0.55), standMetal);
      base.position.set(0, 0.05, -0.02);
      base.castShadow = true;
      grp.add(base);
      grp.position.y = GROUND_Y;
      scene.add(grp);
      return grp;
    };
    const STAND_DEPTH = 13;
    const STAND_W = 4.05;
    const stands = [
      { grp: makeStand(infoCv, STAND_W, 2.56), side: -1 },
      { grp: makeStand(sponsorCv, STAND_W, 2.06), side: 1 }
    ];

    /* ---------- off-stage key spots (no visible towers) ---------- */
    [-1, 1].forEach((s) => {
      const spot = new THREE.SpotLight(s > 0 ? 0x9fd4ff : 0xffc27a, 200, 50, 0.32, 0.7, 1.5);
      spot.position.set(s * 24, GROUND_Y + 13.6, -9);
      spot.target.position.set(0, GROUND_Y + 1, 0);
      scene.add(spot, spot.target);
    });

    /* ---------- sweeping searchlights ---------- */
    const beamGeo = new THREE.CylinderGeometry(4.5, 0.35, 70, 40, 1, true);
    beamGeo.translate(0, 35, 0);
    const beams: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; tilt: number; phase: number; warm: boolean }[] = [];
    [-26, 26].forEach((x, i) => {
      const warm = i % 2 === 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(warm ? DEFAULT_ACCENT : 0x6fc8ff) },
          uIntensity: { value: 0.035 }
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.position.set(x, GROUND_Y, -32 + Math.abs(x) * 0.15);
      mesh.rotation.x = -0.15;
      scene.add(mesh);
      beams.push({ mesh, mat, tilt: x > 0 ? 0.28 : -0.28, phase: i * 1.7, warm });
    });

    /* ---------- backlit energy gate ---------- */
    const gate = new THREE.Group();
    gate.position.set(0, GROUND_Y + 5.2, -12);
    scene.add(gate);
    const gateMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(DEFAULT_ACCENT).multiplyScalar(1.6), transparent: true, opacity: 0.85 });
    gate.add(new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.045, 10, 220), gateMat));
    const segs = new THREE.Group();
    gate.add(segs);
    const segMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fd8ff).multiplyScalar(1.6), transparent: true, opacity: 0.7 });
    for (let i = 0; i < 14; i++) {
      const seg = new THREE.Mesh(new THREE.TorusGeometry(7.9, 0.03, 6, 20, 0.28), segMat);
      seg.rotation.z = (i / 14) * Math.PI * 2;
      segs.add(seg);
    }
    const gateGlowMat = new THREE.MeshBasicMaterial({
      map: glowTex, color: new THREE.Color(DEFAULT_ACCENT).multiplyScalar(0.32),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    });
    const gateGlow = new THREE.Mesh(new THREE.PlaneGeometry(34, 34), gateGlowMat);
    gateGlow.position.z = -1;
    gate.add(gateGlow);

    /* ---------- raised dais for heroes staged above the floor ---------- */
    const stageMetal = new THREE.MeshStandardMaterial({
      color: 0x14171d, metalness: 0.9, roughness: 0.85, roughnessMap: grimeTex, bumpMap: panelTex, bumpScale: 0.6
    });
    const daisEdge = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fd8ff).multiplyScalar(1.5) });
    const addDais = (x: number, z: number, hgt: number) => {
      const dais = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, hgt, 6), stageMetal);
      dais.position.set(x, GROUND_Y + hgt / 2, z);
      dais.castShadow = true;
      dais.receiveShadow = true;
      scene.add(dais);
      const edge = new THREE.Mesh(new THREE.TorusGeometry(2.42, 0.03, 6, 6), daisEdge);
      edge.rotation.x = Math.PI / 2;
      edge.position.set(x, GROUND_Y + hgt + 0.01, z);
      scene.add(edge);
    };
    HEROES.filter((h) => h.layout.y).forEach((h) => addDais(h.layout.x, h.layout.z, h.layout.y!));

    /* ---------- mech builder ---------- */
    type Panel = {
      obj: THREE.Object3D; p0: THREE.Vector3; r0: THREE.Euler;
      target: THREE.Vector3; mid: THREE.Vector3; spin: THREE.Vector3; delay: number;
    };
    type FoldJoint = { obj: THREE.Object3D; rest: THREE.Euler; fold: THREE.Euler; from: number; to: number };
    type HeroRec = {
      group: THREE.Group;          // the hero as placed in the world
      rig: THREE.Group;            // robot, pivots at the pelvis to fold into vehicle mode
      veh: THREE.Group;            // vehicle-mode shell (only shown during the intro)
      panels: Panel[];
      wheels: { obj: THREE.Object3D; r: number }[];
      foldJoints: FoldJoint[];
      headRestY: number;
      siren: THREE.MeshStandardMaterial[] | null;
      vehicle: VehicleKind;
      vehMats: THREE.MeshStandardMaterial[];   // vehicle finishes that get their own, stronger reflections
      materials: THREE.Material[];
      emissives: THREE.MeshStandardMaterial[];
      ring: THREE.Mesh;
      introStart: number;
      introFrom: number;   // drive-in start x (world units)
      introTo: number;     // where it stops and transforms
      introCam: boolean;   // hero-page intro moves the camera; events-stage intro keeps the home view
      stageHidden: boolean;  // faded out by the events stage: frozen where it left, snaps home when the stage ends
      wasStaged: boolean;    // on the events stage last frame
      locked: boolean;
      head: THREE.Object3D;
      phase: number;
      baseY: number;
      // Joints + live offsets for the per-event idle "action" animation.
      act: {
        shoulders: { s: number; obj: THREE.Object3D; rest: THREE.Euler }[];
        elbows: { s: number; obj: THREE.Object3D; rest: THREE.Euler }[];
        cannon: { obj: THREE.Object3D; rest: THREE.Euler } | null;
        rigRestY: number;
        headYaw: number;
        headPitch: number;
      };
    };
    const records: Record<string, HeroRec> = {};
    const gltfLoader = new GLTFLoader();

    const buildHero = (hero: Hero): HeroRec => {
      const c = hero.colors;
      const f = hero.features;
      const paintMetal = hero.key === 'megatron' ? 0.85 : 0.45;

      const paint = new THREE.MeshPhysicalMaterial({
        color: c.primary, map: dirtTex, metalness: paintMetal, roughness: 0.42, roughnessMap: grimeTex,
        bumpMap: panelTex, bumpScale: 0.3, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.3,
        transparent: true, opacity: 1
      });
      const accent = paint.clone();
      accent.color.setHex(c.secondary);
      const steel = new THREE.MeshStandardMaterial({
        color: c.metal, map: dirtTex, metalness: 1, roughness: 0.72, roughnessMap: grimeTex,
        bumpMap: panelTex, bumpScale: 0.3, envMapIntensity: 1.2, transparent: true, opacity: 1
      });
      const frame = new THREE.MeshStandardMaterial({
        color: 0x16191e, metalness: 0.9, roughness: 0.95, roughnessMap: grimeTex,
        bumpMap: panelTex, bumpScale: 0.6, envMapIntensity: 0.9, transparent: true, opacity: 1
      });
      const chrome = new THREE.MeshStandardMaterial({
        color: 0xc8cdd4, metalness: 1, roughness: 0.32, roughnessMap: grimeTex, envMapIntensity: 1.5, transparent: true, opacity: 1
      });
      const rubber = new THREE.MeshStandardMaterial({
        color: 0x0b0b0d, metalness: 0, roughness: 0.92, bumpMap: panelTex, bumpScale: 0.2, transparent: true, opacity: 1
      });
      const glass = new THREE.MeshPhysicalMaterial({
        color: 0x0a1822, metalness: 0.2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.15,
        envMapIntensity: 2.2, transparent: true, opacity: 0.85
      });
      const eyeMat = new THREE.MeshStandardMaterial({ color: c.visor, emissive: c.visor, emissiveIntensity: 2.4, roughness: 0.2, transparent: true, opacity: 1 });
      const glowMat = new THREE.MeshStandardMaterial({ color: c.glow, emissive: c.glow, emissiveIntensity: 1.5, roughness: 0.3, transparent: true, opacity: 1 });
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xfff1d6, emissiveIntensity: 1.8, roughness: 0.35, transparent: true, opacity: 1 });
      const poolMat = new THREE.MeshBasicMaterial({
        map: glowTex, color: new THREE.Color(c.glow).multiplyScalar(0.32),
        transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const materials: THREE.Material[] = [paint, accent, steel, frame, chrome, rubber, glass, eyeMat, glowMat, lampMat, poolMat];
      const emissives: THREE.MeshStandardMaterial[] = [eyeMat, glowMat, lampMat];

      // outer = the hero as placed in the world (drives in as a vehicle on the intro);
      // rig pivots at the pelvis so the robot can fold down into vehicle mode.
      const outer = new THREE.Group();
      const rig = new THREE.Group();
      rig.position.y = 3.9;
      outer.add(rig);
      const root = new THREE.Group();
      root.position.y = -3.9;
      rig.add(root);
      const foldJoints: FoldJoint[] = [];
      const addFold = (obj: THREE.Object3D, fold: THREE.Euler, from: number, to: number) =>
        foldJoints.push({ obj, rest: obj.rotation.clone(), fold, from, to });

      const outline = (pts: number[][]) => {
        const s = new THREE.Shape();
        s.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
        s.closePath();
        return s;
      };
      // Faceted armour plate: extruded outline with a rolled chamfer that catches highlights.
      const plateGeo = (pts: number[][], depth: number, bevel = 0.035) => {
        const geo = new THREE.ExtrudeGeometry(outline(pts), {
          depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 1
        });
        geo.center();
        return geo;
      };
      const put = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, p = [0, 0, 0], r = [0, 0, 0]) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(p[0], p[1], p[2]);
        m.rotation.set(r[0], r[1], r[2]);
        m.castShadow = true;
        m.receiveShadow = true;
        parent.add(m);
        return m;
      };
      const plate = (pts: number[][], depth: number, mat: THREE.Material, parent: THREE.Object3D, p = [0, 0, 0], r = [0, 0, 0], s = 1, bevel = 0.035) =>
        put(plateGeo(pts.map(([x, y]) => [x * s, y]), depth, bevel), mat, parent, p, r);
      const joint = (parent: THREE.Object3D, p = [0, 0, 0], r = [0, 0, 0]) => {
        const j = new THREE.Group();
        j.position.set(p[0], p[1], p[2]);
        j.rotation.set(r[0], r[1], r[2]);
        parent.add(j);
        return j;
      };
      const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
      const cyl = (rt: number, rb: number, h: number, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
      const SIDES = [-1, 1];
      const hose = (pts: number[][], r: number, parent: THREE.Object3D) =>
        put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 24, r, 8, false), rubber, parent);
      const boltGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.035, 8);
      const bolts = (parent: THREE.Object3D, pts: number[][]) =>
        pts.forEach(([x, y, z]) => put(boltGeo, chrome, parent, [x, y, z], [Math.PI / 2, 0, 0]));

      /* -- pelvis & exposed waist mechanics -- */
      plate([[-0.78, 0.22], [0.78, 0.22], [0.62, -0.18], [0.22, -0.34], [-0.22, -0.34], [-0.62, -0.18]], 0.95, paint, root, [0, 3.95, 0]);
      plate([[-0.2, 0.18], [0.2, 0.18], [0.12, -0.22], [-0.12, -0.22]], 0.2, steel, root, [0, 3.82, 0.52]);
      put(cyl(0.2, 0.26, 0.75, 12), frame, root, [0, 4.5, -0.08]);
      for (let i = 0; i < 3; i++) {
        plate([[-0.46, 0.07], [0.46, 0.07], [0.4, -0.07], [-0.4, -0.07]], 0.22, steel, root, [0, 4.28 + i * 0.2, 0.22], [0.05, 0, 0]);
      }
      SIDES.forEach((s) => {
        put(cyl(0.045, 0.045, 0.8, 8), chrome, root, [s * 0.34, 4.5, 0.08], [0, 0, s * 0.12]);
        put(box(0.2, 0.55, 0.5), frame, root, [s * 0.56, 4.5, -0.05]);
      });

      /* -- chest -- */
      put(box(2.0, 1.35, 1.05), frame, root, [0, 5.35, -0.08]);
      const PEC = [[-0.55, 0.5], [0.58, 0.56], [0.64, 0.02], [0.38, -0.52], [-0.42, -0.56], [-0.6, -0.12]];
      SIDES.forEach((s) => {
        plate(PEC, 0.24, paint, root, [s * 0.58, 5.52, 0.52], [-0.08, s * 0.2, 0], s);
        for (let k = 0; k < 3; k++) {
          plate([[-0.3, 0.08], [0.3, 0.1], [0.28, -0.08], [-0.3, -0.08]], 0.12, frame, root, [s * 1.02, 4.95 + k * 0.24, -0.05], [0, s * Math.PI / 2, 0]);
        }
        plate([[-0.55, 0.13], [0.58, 0.2], [0.52, -0.12], [-0.5, -0.14]], 0.95, paint, root, [s * 0.72, 6.06, -0.02], [0, 0, s * -0.14], s);
      });
      plate([[-0.16, 0.52], [0.16, 0.52], [0.1, -0.62], [-0.1, -0.62]], 0.3, steel, root, [0, 5.42, 0.58]);
      plate([[-0.9, 0.6], [0.9, 0.6], [0.7, -0.6], [-0.7, -0.6]], 0.25, frame, root, [0, 5.4, -0.68]);
      put(cyl(0.2, 0.24, 0.18, 6), chrome, root, [0, 4.86, 0.62], [Math.PI / 2, 0, 0]);
      put(cyl(0.13, 0.13, 0.1, 20), glowMat, root, [0, 4.86, 0.7], [Math.PI / 2, 0, 0]);

      if (f.stripes) {
        SIDES.forEach((s) => plate([[-0.07, 0.5], [0.07, 0.5], [0.07, -0.5], [-0.07, -0.5]], 0.03, accent, root, [s * 0.26, 5.52, 0.755], [-0.08, s * 0.2, 0], s, 0.01));
      }
      if (f.headlights) {
        SIDES.forEach((s) => put(box(0.24, 0.1, 0.06), lampMat, root, [s * 0.76, 5.06, 0.66], [0, s * 0.2, 0]));
      }
      if (f.medicCross) {
        plate([[-0.06, 0.2], [0.06, 0.2], [0.06, -0.2], [-0.06, -0.2]], 0.02, accent, root, [-0.62, 5.6, 0.7], [-0.08, -0.2, 0], 1, 0.008);
        plate([[-0.2, 0.06], [0.2, 0.06], [0.2, -0.06], [-0.2, -0.06]], 0.02, accent, root, [-0.62, 5.6, 0.7], [-0.08, -0.2, 0], 1, 0.008);
      }
      if (f.spikes) {
        SIDES.forEach((s) => {
          for (let k = 0; k < 3; k++) {
            plate([[-0.08, 0.6], [0.02, 0.62], [0.12, -0.5], [-0.12, -0.5]], 0.1, steel, root,
              [s * (0.35 + k * 0.3), 6.1 + k * 0.1, -0.7], [-0.5, 0, s * -0.2 * (k + 1)], s);
          }
        });
      }
      if (f.doorWings) {
        SIDES.forEach((s) => {
          const w = joint(root, [s * 0.95, 5.7, -0.62], [0.12, s * 0.55, s * -0.32]);
          plate([[-0.46, 0.82], [0.52, 0.76], [0.56, -0.62], [-0.42, -0.72]], 0.08, paint, w, [0, 0, 0], [0, 0, 0], s);
          plate([[-0.36, 0.7], [0.44, 0.66], [0.46, 0.12], [-0.34, 0.14]], 0.03, glass, w, [s * 0.03, 0.02, 0.06], [0, 0, 0], s, 0.01);
        });
      }

      /* -- hydraulics & vents -- */
      SIDES.forEach((s) => {
        hose([[s * 0.42, 4.78, -0.25], [s * 0.78, 4.45, -0.1], [s * 0.6, 4.05, -0.28]], 0.05, root);
        hose([[s * 0.3, 4.78, -0.35], [s * 0.55, 4.4, -0.42], [s * 0.4, 4.02, -0.38]], 0.04, root);
        hose([[s * 0.14, 6.05, -0.18], [s * 0.2, 6.25, -0.12], [s * 0.12, 6.48, -0.05]], 0.035, root);
        for (let k = 0; k < 3; k++) put(box(0.3, 0.035, 0.05), frame, root, [s * 0.86, 5.2 + k * 0.08, 0.66], [0, s * 0.2, 0]);
      });

      /* -- power-pack on the back -- */
      put(box(1.3, 1.1, 0.45), frame, root, [0, 5.35, -0.95]);
      SIDES.forEach((s) => {
        put(cyl(0.16, 0.2, 0.9, 12), steel, root, [s * 0.42, 5.55, -1.2]);
        put(cyl(0.12, 0.12, 0.06, 12), glowMat, root, [s * 0.42, 5.08, -1.2]);
      });
      for (let k = 0; k < 4; k++) put(box(0.9, 0.05, 0.08), steel, root, [0, 5.0 + k * 0.18, -1.2]);

      /* -- arms -- */
      // Joints captured so the render loop can animate a per-event idle "action".
      const actShoulders: { s: number; obj: THREE.Object3D; rest: THREE.Euler }[] = [];
      const actElbows: { s: number; obj: THREE.Object3D; rest: THREE.Euler }[] = [];
      let actCannon: { obj: THREE.Object3D; rest: THREE.Euler } | null = null;
      SIDES.forEach((s) => {
        const cannonArm = !!f.cannon && s === 1;
        const sh = joint(root, [s * 1.5, 5.78, -0.02],
          [cannonArm ? -0.6 : (s > 0 ? 0.06 : -0.1), 0, s * (cannonArm ? 0.1 : 0.17)]);
        addFold(sh, new THREE.Euler(0.1, 0, s * 0.02), 0.45, 0.95);
        actShoulders.push({ s, obj: sh, rest: sh.rotation.clone() });
        put(new THREE.SphereGeometry(0.3, 28, 20), frame, sh);
        plate([[-0.38, 0.42], [0.5, 0.52], [0.72, 0.1], [0.6, -0.38], [-0.22, -0.3]], 1.15, paint, sh, [s * 0.22, 0.18, 0], [0, 0, 0], s);
        plate([[-0.3, 0.08], [0.62, 0.14], [0.58, -0.06], [-0.3, -0.08]], 1.22, steel, sh, [s * 0.26, 0.66, 0], [0, 0, s * 0.18], s);
        plate([[-0.3, 0.3], [0.4, 0.34], [0.5, 0.05], [0.4, -0.25], [-0.15, -0.2]], 0.05, steel, sh, [s * 0.22, 0.18, 0.65], [0, 0, 0], s, 0.015);
        bolts(sh, [[s * -0.24, 0.5, 0.625], [s * 0.54, 0.56, 0.625], [s * 0.7, 0.2, 0.625], [s * 0.55, -0.18, 0.625], [s * -0.12, -0.14, 0.625]]);
        if (f.spikes) {
          for (let k = 0; k < 3; k++) {
            put(new THREE.ConeGeometry(0.09, 0.55, 5), steel, sh, [s * (0.15 + k * 0.22), 0.85 + k * 0.05, -0.25 + k * 0.25], [0.2, 0, s * (-0.5 - k * 0.1)]);
          }
        }
        if (f.lightBar) {
          const col = s > 0 ? 0x2b6cff : 0xff2020;
          const lb = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 3, transparent: true, opacity: 1 });
          materials.push(lb);
          emissives.push(lb);
          put(box(0.55, 0.11, 0.2), lb, sh, [s * 0.3, 0.8, 0.15]);
        }
        // upper arm
        put(cyl(0.24, 0.2, 1.05, 24), frame, sh, [0, -0.62, 0]);
        plate([[-0.18, 0.45], [0.2, 0.42], [0.24, -0.42], [-0.2, -0.46]], 0.5, paint, sh, [s * 0.12, -0.66, 0.02], [0, 0, 0], s);
        put(cyl(0.04, 0.04, 0.9, 8), chrome, sh, [-s * 0.12, -0.62, 0.2]);
        // elbow + forearm
        const el = joint(sh, [0, -1.22, 0], [cannonArm ? -0.4 : (s > 0 ? -0.35 : -0.52), 0, 0]);
        addFold(el, new THREE.Euler(2.2, 0, 0), 0.5, 1.0);
        actElbows.push({ s, obj: el, rest: el.rotation.clone() });
        put(cyl(0.2, 0.2, 0.46, 14), frame, el, [0, 0, 0], [0, 0, Math.PI / 2]);
        put(new THREE.TorusGeometry(0.13, 0.03, 8, 20), glowMat, el, [s * 0.24, 0, 0], [0, Math.PI / 2, 0]);
        plate([[-0.14, 0.18], [0.14, 0.18], [0.18, -0.12], [-0.18, -0.12]], 0.3, steel, el, [0, 0.02, -0.2], [-0.3, 0, 0]);
        put(box(0.4, 1.0, 0.44), frame, el, [0, -0.58, 0]);
        plate([[-0.28, 0.5], [0.3, 0.56], [0.36, -0.38], [0.12, -0.56], [-0.3, -0.46]], 0.56, paint, el, [s * 0.07, -0.58, 0.02], [0, 0, 0], s);
        plate([[-0.16, 0.36], [0.18, 0.4], [0.22, -0.26], [-0.18, -0.3]], 0.04, steel, el, [s * 0.07, -0.55, 0.36], [0, 0, 0], s, 0.012);
        hose([[-s * 0.2, -0.1, -0.2], [-s * 0.3, -0.55, -0.3], [-s * 0.18, -1.0, -0.2]], 0.04, el);
        [0.2, -0.2].forEach((z) => put(cyl(0.035, 0.035, 0.85, 8), chrome, el, [-s * 0.16, -0.58, z]));
        if (cannonArm) {
          const cn = joint(el, [0, -1.1, 0]);
          actCannon = { obj: cn, rest: cn.rotation.clone() };
          put(cyl(0.3, 0.34, 1.5, 20), accent, cn, [0, -0.55, 0]);
          put(cyl(0.36, 0.36, 0.35, 20), steel, cn, [0, -0.05, 0]);
          put(cyl(0.34, 0.3, 0.25, 20), steel, cn, [0, -1.35, 0]);
          put(cyl(0.2, 0.24, 0.12, 20), glowMat, cn, [0, -1.5, 0]);
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            put(cyl(0.035, 0.035, 1.2, 6), chrome, cn, [Math.cos(a) * 0.36, -0.6, Math.sin(a) * 0.36]);
          }
        } else {
          const hd = joint(el, [0, -1.12, 0.02]);
          put(box(0.36, 0.34, 0.42), frame, hd);
          plate([[-0.2, 0.1], [0.2, 0.12], [0.2, -0.1], [-0.2, -0.1]], 0.44, steel, hd, [0, 0.1, 0]);
          for (let k = 0; k < 4; k++) put(box(0.08, 0.2, 0.1), frame, hd, [-0.13 + k * 0.087, -0.22, 0.12], [0.5, 0, 0]);
          put(box(0.1, 0.22, 0.1), frame, hd, [s * 0.2, -0.05, 0.15], [0.3, 0, s * 0.4]);
        }
      });

      /* -- legs -- */
      SIDES.forEach((s) => {
        const hipX = s > 0 ? -0.07 : 0.05;
        const hipZ = s * 0.07;
        const hip = joint(root, [s * 0.5, 3.78, 0], [hipX, 0, hipZ]);
        addFold(hip, new THREE.Euler(0, 0, 0), 0.3, 0.85);
        put(new THREE.SphereGeometry(0.28, 28, 20), frame, hip);
        put(cyl(0.26, 0.22, 1.2, 24), frame, hip, [0, -0.72, -0.04]);
        plate([[-0.33, 0.6], [0.36, 0.64], [0.32, -0.55], [-0.28, -0.62]], 0.64, paint, hip, [s * 0.03, -0.72, 0.06], [0, 0, 0], s);
        plate([[-0.2, 0.4], [0.22, 0.42], [0.2, -0.36], [-0.17, -0.4]], 0.05, steel, hip, [s * 0.03, -0.7, 0.44], [0, 0, 0], s, 0.012);
        put(cyl(0.05, 0.05, 1.0, 8), chrome, hip, [-s * 0.15, -0.72, -0.3]);
        const knee = joint(hip, [0, -1.45, 0]);
        addFold(knee, new THREE.Euler(2.5, 0, 0), 0.3, 0.85);
        put(cyl(0.2, 0.2, 0.5, 14), frame, knee, [0, 0, 0], [0, 0, Math.PI / 2]);
        put(new THREE.TorusGeometry(0.13, 0.03, 8, 20), glowMat, knee, [s * 0.26, 0, 0], [0, Math.PI / 2, 0]);
        plate([[-0.26, 0.24], [0.26, 0.24], [0.2, -0.14], [0, -0.3], [-0.2, -0.14]], 0.26, steel, knee, [0, 0.02, 0.3]);
        plate([[-0.36, 0.8], [0.36, 0.8], [0.44, -0.3], [0.32, -0.86], [-0.32, -0.86], [-0.44, -0.3]], 0.78, paint, knee, [0, -1.0, 0.04]);
        plate([[-0.18, 0.45], [0.18, 0.45], [0.14, -0.45], [-0.14, -0.45]], 0.08, steel, knee, [0, -0.85, 0.47]);
        if (f.wheels) {
          put(cyl(0.4, 0.4, 0.28, 28), rubber, knee, [s * 0.44, -1.1, -0.3], [0, 0, Math.PI / 2]);
          put(cyl(0.24, 0.24, 0.3, 16), chrome, knee, [s * 0.46, -1.1, -0.3], [0, 0, Math.PI / 2]);
        }
        hose([[s * 0.12, 0.35, -0.28], [s * 0.2, -0.1, -0.5], [s * 0.1, -0.7, -0.42]], 0.045, knee);
        bolts(knee, [[0.3, -0.4, 0.48], [-0.3, -0.4, 0.48], [0.28, -1.5, 0.48], [-0.28, -1.5, 0.48]]);
        const ankle = joint(knee, [0, -1.95, 0], [-hipX, 0, -hipZ]);
        put(new THREE.SphereGeometry(0.17, 24, 16), frame, ankle);
        put(plateGeo([[-0.48, 0.0], [0.78, 0.0], [0.84, 0.12], [0.38, 0.34], [-0.32, 0.36], [-0.52, 0.14]], 0.62), accent, ankle, [0, -0.17, 0.15], [0, -Math.PI / 2, 0]);
        [-0.2, 0.2].forEach((x) => put(box(0.18, 0.12, 0.22), steel, ankle, [x, -0.33, 0.95]));
      });

      /* -- neck & head -- */
      put(cyl(0.2, 0.26, 0.4, 12), frame, root, [0, 6.28, -0.02]);
      const head = joint(root, [0, 6.68, 0.05]);
      if (f.singleEye) {
        plate([[-0.34, 0.3], [0.34, 0.3], [0.4, -0.05], [0.3, -0.36], [-0.3, -0.36], [-0.4, -0.05]], 0.78, paint, head);
        put(cyl(0.2, 0.2, 0.1, 28), frame, head, [0, -0.02, 0.42], [Math.PI / 2, 0, 0]);
        put(cyl(0.155, 0.155, 0.08, 28), eyeMat, head, [0, -0.02, 0.46], [Math.PI / 2, 0, 0]);
        put(new THREE.TorusGeometry(0.2, 0.03, 8, 28), chrome, head, [0, -0.02, 0.47]);
      } else {
        plate([[-0.3, 0.34], [0.3, 0.34], [0.37, 0.04], [0.31, -0.3], [0.12, -0.4], [-0.12, -0.4], [-0.31, -0.3], [-0.37, 0.04]], 0.74, paint, head);
        plate([[-0.22, 0.02], [0.22, 0.02], [0.18, -0.2], [0.07, -0.29], [-0.07, -0.29], [-0.18, -0.2]], 0.12, steel, head, [0, -0.08, 0.4]);
        plate([[-0.33, 0.06], [0.33, 0.06], [0.29, -0.05], [-0.29, -0.05]], 0.22, steel, head, [0, 0.19, 0.36], [-0.35, 0, 0]);
        SIDES.forEach((s) => plate([[-0.11, 0.028], [0.1, 0.042], [0.12, -0.028], [-0.1, -0.03]], 0.05, eyeMat, head, [s * 0.12, 0.08, 0.41], [0, 0, s * 0.14], s, 0.01));
      }
      SIDES.forEach((s) => plate([[-0.1, 0.24], [0.12, 0.3], [0.16, -0.16], [-0.1, -0.2]], 0.07, steel, head, [s * 0.4, 0.04, 0.02], [0, s * 1.35, 0], s));
      put(box(0.08, 0.16, 0.62), steel, head, [0, 0.4, 0.02]);
      if (f.horns) SIDES.forEach((s) => put(new THREE.ConeGeometry(0.1, 0.8, 6), steel, head, [s * 0.34, 0.5, -0.1], [-0.5, 0, s * -0.6]));
      if (f.earHorns) SIDES.forEach((s) => put(box(0.06, 0.36, 0.1), steel, head, [s * 0.34, 0.42, 0], [0, 0, s * -0.25]));
      if (f.tallAntennae) {
        SIDES.forEach((s) => plate([[-0.05, 0.55], [0.05, 0.55], [0.09, -0.45], [-0.09, -0.45]], 0.12, paint, head, [s * 0.34, 0.62, -0.08], [0.15, 0, s * -0.18], s));
      }

      /* -- contact shadow, light pool + ring on the floor (stay flat while the robot folds) -- */
      const shadowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.7, depthWrite: false });
      materials.push(shadowMat);
      const contact = put(new THREE.PlaneGeometry(4.6, 4.6), shadowMat, outer, [0, 0.05, 0.05], [-Math.PI / 2, 0, 0]);
      contact.castShadow = false;
      contact.receiveShadow = false;
      contact.renderOrder = 3;
      const pool = put(new THREE.PlaneGeometry(5.2, 5.2), poolMat, outer, [0, 0.06, 0.1], [-Math.PI / 2, 0, 0]);
      pool.castShadow = false;
      pool.receiveShadow = false;
      const ring = put(new THREE.TorusGeometry(1.75, 0.022, 8, 96), glowMat, outer, [0, 0.07, 0.1], [Math.PI / 2, 0, 0]);
      ring.castShadow = false;

      /* -- vehicle mode: every panel knows which robot armour it becomes -- */
      const panels: Panel[] = [];
      const wheels: { obj: THREE.Object3D; r: number }[] = [];
      const veh = new THREE.Group();
      veh.visible = false;
      outer.add(veh);
      const vp = (obj: THREE.Object3D, target: number[]) => {
        const tv = new THREE.Vector3(target[0], target[1], target[2]);
        const mid = obj.position.clone().add(tv).multiplyScalar(0.5);
        mid.y += 2.4 + Math.random() * 1.5;
        mid.x += obj.position.x * 0.8;
        panels.push({
          obj, p0: obj.position.clone(), r0: obj.rotation.clone(), target: tv, mid,
          spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
          delay: Math.random() * 0.45
        });
        return obj;
      };
      const vplate = (pts: number[][], depth: number, mat: THREE.Material, p: number[], r: number[], target: number[], bevel = 0.035) =>
        vp(put(plateGeo(pts, depth, bevel), mat, veh, p, r), target);
      const vbox = (w: number, h: number, d: number, mat: THREE.Material, p: number[], r: number[], target: number[]) =>
        vp(put(box(w, h, d), mat, veh, p, r), target);
      const vcyl = (rt: number, rb: number, h: number, mat: THREE.Material, p: number[], r: number[], target: number[], seg = 16) =>
        vp(put(cyl(rt, rb, h, seg), mat, veh, p, r), target);
      /* -- realistic vehicle kit: clear-coat paint, tinted glass, black trim, sculpted bodies -- */
      const carPaint = new THREE.MeshPhysicalMaterial({
        color: c.primary, metalness: 0.5, roughness: 0.26, roughnessMap: grimeTex,
        clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6, transparent: true, opacity: 1
      });
      const carAccent = carPaint.clone();
      carAccent.color.setHex(c.secondary);
      const trim = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, metalness: 0.35, roughness: 0.5, transparent: true, opacity: 1 });
      const tint = new THREE.MeshPhysicalMaterial({
        color: 0x0b1118, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02,
        envMapIntensity: 2.8, transparent: true, opacity: 0.72
      });
      const tyreMat = new THREE.MeshStandardMaterial({
        color: 0x111113, metalness: 0, roughness: 0.86, bumpMap: panelTex, bumpScale: 0.15,
        side: THREE.DoubleSide, transparent: true, opacity: 1
      });
      const gunmetal = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 1, roughness: 0.3, envMapIntensity: 1.4, transparent: true, opacity: 1 });
      const rimBarrel = new THREE.MeshStandardMaterial({ color: 0x4d525a, metalness: 1, roughness: 0.45, side: THREE.DoubleSide, transparent: true, opacity: 1 });
      const caliper = new THREE.MeshStandardMaterial({ color: 0xc41c1c, metalness: 0.3, roughness: 0.45, transparent: true, opacity: 1 });
      const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 1.6, roughness: 0.3, transparent: true, opacity: 1 });
      const cabinMat = new THREE.MeshStandardMaterial({ color: 0x17191d, metalness: 0.1, roughness: 0.85, transparent: true, opacity: 1 });
      const wellMat = new THREE.MeshStandardMaterial({ color: 0x050506, metalness: 0, roughness: 1, side: THREE.DoubleSide, transparent: true, opacity: 1 });
      const vShadowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.8, depthWrite: false });
      materials.push(carPaint, carAccent, trim, tint, tyreMat, gunmetal, rimBarrel, caliper, tailMat, cabinMat, wellMat, vShadowMat);
      carPaint.userData.vehEnv = 0.85;
      carAccent.userData.vehEnv = 0.85;
      tint.userData.vehEnv = 1.4;
      gunmetal.userData.vehEnv = 1.0;
      rimBarrel.userData.vehEnv = 0.8;
      emissives.push(tailMat);
      let siren: THREE.MeshStandardMaterial[] | null = null;
      const headGlow = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0xfff1d6).multiplyScalar(0.85), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      const tailGlow = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(0xff2a1a).multiplyScalar(0.55), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
      materials.push(headGlow, tailGlow);

      type Fn = (z: number) => number;
      // Smooth side-profile line through (z, y) control points, sampled as y = f(z).
      const prof = (pts: number[][]): Fn => {
        const sp = new THREE.SplineCurve(pts.map(([z, y]) => new THREE.Vector2(z, y))).getPoints(260);
        sp.sort((a, b) => a.x - b.x);
        return (z: number) => {
          if (z <= sp[0].x) return sp[0].y;
          const last = sp[sp.length - 1];
          if (z >= last.x) return last.y;
          let i = 1;
          while (sp[i].x < z) i++;
          const a = sp[i - 1], b = sp[i];
          return a.y + (b.y - a.y) * ((z - a.x) / Math.max(b.x - a.x, 1e-6));
        };
      };
      // Underside line with semicircular wheel-arch cut-outs: [zCentre, radius, yCentre].
      const underside = (clear: Fn, archList: number[][]): Fn => (z: number) => {
        let y = clear(z);
        archList.forEach(([zc, r, yc]) => {
          const d = z - zc;
          if (Math.abs(d) < r) y = Math.max(y, yc + Math.sqrt(r * r - d * d));
        });
        return y;
      };
      // Body section: the side profile between z0..z1 extruded across the width with rounded edges.
      const sliceGeo = (top: Fn, bot: Fn, z0: number, z1: number, width: number, bevel = 0.1, x = 0) => {
        const steps = Math.max(10, Math.ceil(Math.abs(z1 - z0) * 16));
        const s = new THREE.Shape();
        for (let i = 0; i <= steps; i++) {
          const z = z0 + ((z1 - z0) * i) / steps;
          if (i === 0) s.moveTo(z, top(z));
          else s.lineTo(z, top(z));
        }
        for (let i = steps; i >= 0; i--) {
          const z = z0 + ((z1 - z0) * i) / steps;
          s.lineTo(z, Math.min(bot(z), top(z) - 0.03));
        }
        const depth = Math.max(0.01, width - bevel * 2);
        const geo = new THREE.ExtrudeGeometry(s, {
          depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.45, bevelSegments: 6, curveSegments: 2
        });
        geo.rotateY(-Math.PI / 2);
        geo.translate(depth / 2 + x, 0, 0);
        return toCreasedNormals(geo, 0.42);
      };
      // Any vehicle geometry built in vehicle space: recentre it so it flies from where it sits.
      const vmesh = (geo: THREE.BufferGeometry, mat: THREE.Material, target: number[]) => {
        geo.computeBoundingBox();
        const ctr = geo.boundingBox!.getCenter(new THREE.Vector3());
        geo.translate(-ctr.x, -ctr.y, -ctr.z);
        return vp(put(geo, mat, veh, [ctr.x, ctr.y, ctr.z]), target);
      };
      const vslice = (top: Fn, bot: Fn, z0: number, z1: number, width: number, mat: THREE.Material, target: number[], bevel = 0.1, x = 0) =>
        vmesh(sliceGeo(top, bot, z0, z1, width, bevel, x), mat, target);
      // Straight member between two points: pillars, struts, tubes.
      const vstrut = (a: number[], b: number[], w: number, d: number, mat: THREE.Material, target: number[], round = false) => {
        const A = new THREE.Vector3(a[0], a[1], a[2]);
        const B = new THREE.Vector3(b[0], b[1], b[2]);
        const m = put(round ? cyl(w, w, A.distanceTo(B), 12) : box(w, A.distanceTo(B), d), mat, veh, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
        return vp(m, target);
      };
      // Soft additive halo in front of a lamp lens (flies off with its lamp when transforming).
      const vglow = (p: number[], size: number, mat: THREE.Material, target: number[], back = false) => {
        const m = put(new THREE.PlaneGeometry(size, size * 0.6), mat, veh, p, [0, back ? Math.PI : 0, 0]);
        m.castShadow = false;
        m.receiveShadow = false;
        m.renderOrder = 4;
        return vp(m, target);
      };
      const plateTex = (text: string) => canvasTexture(256, 64, (g) => {
        g.fillStyle = '#f2f4f7';
        g.fillRect(0, 0, 256, 64);
        g.strokeStyle = '#1b2230';
        g.lineWidth = 5;
        g.strokeRect(4, 4, 248, 56);
        g.fillStyle = '#121826';
        g.font = '800 38px "Oxanium", "Arial Black", sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, 128, 34);
      }, true);
      const plateMat = (text: string) => {
        const t = plateTex(text);
        textures.push(t);
        const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.4, metalness: 0.2, transparent: true, opacity: 1 });
        materials.push(m);
        return m;
      };
      // Wheel: lathed tyre with rounded shoulders, open rim barrel, split spokes, hub, lug nuts,
      // brake disc and a fixed (non-spinning) calliper.
      const vwheel = (x: number, z: number, rad: number, width: number, target: number[], rim: THREE.Material = chrome, chunky = false, calliper = true) => {
        const s = Math.sign(x) || 1;
        const hw = width / 2;
        const rr = rad * (chunky ? 0.56 : 0.68);
        const w = new THREE.Group();
        w.position.set(x, rad, z);
        veh.add(w);
        const tp = [
          [rr, -hw * 0.9], [rad * 0.84, -hw], [rad * 0.96, -hw * 0.9], [rad, -hw * 0.62],
          [rad, hw * 0.62], [rad * 0.96, hw * 0.9], [rad * 0.84, hw], [rr, hw * 0.9]
        ];
        const tyre = new THREE.LatheGeometry(tp.map(([r, y]) => new THREE.Vector2(r, y)), 56);
        tyre.rotateZ(Math.PI / 2);
        put(tyre, tyreMat, w);
        const lugs = chunky ? 22 : 30;
        for (let k = 0; k < lugs; k++) {
          const a = (k / lugs) * Math.PI * 2;
          const lug = put(box(width * (chunky ? 0.92 : 0.78), chunky ? 0.07 : 0.025, chunky ? 0.14 : 0.06), tyreMat, w,
            [0, Math.cos(a) * rad, Math.sin(a) * rad], [a, 0, 0]);
          lug.castShadow = false;
        }
        const barrel = new THREE.CylinderGeometry(rr * 0.98, rr * 0.98, width * 0.84, 36, 1, true);
        barrel.rotateZ(Math.PI / 2);
        put(barrel, rimBarrel, w);
        put(new THREE.TorusGeometry(rr * 0.98, 0.03 * rad / 0.46, 8, 40), rim, w, [s * hw * 0.82, 0, 0], [0, Math.PI / 2, 0]);
        put(cyl(rr * 0.8, rr * 0.8, 0.035, 32), steel, w, [s * hw * 0.05, 0, 0], [0, 0, Math.PI / 2]);
        const spokes = 5;
        for (let k = 0; k < spokes; k++) {
          const a = (k / spokes) * Math.PI * 2;
          [-0.09, 0.09].forEach((o) => {
            const len = rr * 0.7;
            put(box(0.05, len, rad * 0.085), rim, w,
              [s * hw * 0.62, Math.cos(a + o) * (rr * 0.28 + len / 2), Math.sin(a + o) * (rr * 0.28 + len / 2)], [a + o, 0, 0]);
          });
        }
        put(cyl(rr * 0.3, rr * 0.34, 0.12, 24), rim, w, [s * hw * 0.62, 0, 0], [0, 0, Math.PI / 2]);
        put(cyl(rr * 0.13, rr * 0.13, 0.13, 20), accent, w, [s * hw * 0.68, 0, 0], [0, 0, Math.PI / 2]);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 + 0.6;
          put(cyl(0.022, 0.022, 0.14, 6), chrome, w, [s * hw * 0.68, Math.cos(a) * rr * 0.2, Math.sin(a) * rr * 0.2], [0, 0, Math.PI / 2]);
        }
        wheels.push({ obj: w, r: rad });
        vp(w, target);
        if (calliper) vbox(0.1, rr * 0.5, rr * 0.4, caliper, [x + s * hw * 0.2, rad + rr * 0.42, z - rr * 0.32], [0.5, 0, 0], target);
      };

      // Dark half-cylinder liners inside each wheel arch so the body never reads see-through.
      const wells = (width: number, list: number[][], target: number[]) => list.forEach(([zc, r, yc]) => {
        const g = new THREE.CylinderGeometry(r * 0.98, r * 0.98, width - 0.12, 24, 1, true, 0, Math.PI);
        g.rotateZ(Math.PI / 2);
        vp(put(g, wellMat, veh, [0, yc, zc]), target);
      });
      // Seats, dashboard and a right-hand-drive steering wheel, visible through the glass.
      const cabin = (floorY: number, seatZ: number, dashZ: number, seatX: number, target: number[]) => {
        [-1, 1].forEach((s) => {
          vbox(0.55, 0.32, 0.55, cabinMat, [s * seatX, floorY + 0.3, seatZ], [0, 0, 0], target);
          vbox(0.55, 0.62, 0.14, cabinMat, [s * seatX, floorY + 0.72, seatZ - 0.3], [-0.16, 0, 0], target);
          vbox(0.3, 0.18, 0.12, cabinMat, [s * seatX, floorY + 1.12, seatZ - 0.37], [-0.16, 0, 0], target);
        });
        vbox(seatX * 2 + 0.7, 0.26, 0.5, cabinMat, [0, floorY + 0.62, dashZ], [0, 0, 0], target);
        vp(put(new THREE.TorusGeometry(0.17, 0.025, 8, 28), cabinMat, veh, [-seatX, floorY + 0.78, dashZ - 0.28], [-1.05, 0, 0]), target);
      };
      // Soft contact shadow so the vehicle sits on the floor instead of floating.
      const groundShadow = (width: number, length: number) => {
        const m = put(new THREE.PlaneGeometry(width + 0.9, length + 1.1), vShadowMat, veh, [0, 0.02, 0], [-Math.PI / 2, 0, 0]);
        m.castShadow = false;
        m.receiveShadow = false;
        m.renderOrder = 3;
      };

      // Robot-space landing spots for the panels (rest pose, hero units).
      const T = {
        chest: [0, 5.45, 0.7], upperChest: [0, 5.95, 0.5], back: [0, 5.4, -0.9], pelvis: [0, 3.95, 0], pelvisBack: [0, 3.9, -0.5],
        head: [0, 6.7, 0.3], shins: [0, 1.4, 0.6], cannon: [1.95, 3.5, 0.8],
        shoulder: (s: number) => [s * 1.75, 5.95, 0.1], wing: (s: number) => [s * 1.3, 5.8, -0.9],
        thigh: (s: number) => [s * 0.55, 3.0, 0.45], knee: (s: number) => [s * 0.55, 2.35, 0.4],
        calf: (s: number) => [s * 0.9, 1.3, -0.3], shin: (s: number) => [s * 0.55, 1.4, 0.55],
        light: (s: number) => [s * 0.76, 5.06, 0.66]
      };

      if (hero.vehicle === 'car') {
        // Bumblebee: muscle coupé — long hood, fastback greenhouse, ducktail spoiler, stripes.
        const W = 2.5;
        const top = prof([[-2.98, 0.95], [-2.9, 1.08], [-2.7, 1.15], [-2.2, 1.18], [-1.6, 1.16], [-1.2, 1.12], [0.0, 1.1], [0.75, 1.09],
          [1.2, 1.07], [2.0, 1.0], [2.6, 0.9], [2.86, 0.82], [2.98, 0.7]]);
        const bot = underside((z) => (z > 2.45 ? 0.3 : z < -2.45 ? 0.32 : 0.24), [[1.74, 0.55, 0.46], [-1.74, 0.55, 0.46]]);
        vslice(top, bot, 2.57, 2.98, W, carPaint, T.shins, 0.12);
        vslice(top, bot, 0.79, 2.55, W, carPaint, T.chest, 0.12);
        SIDES.forEach((s) => vslice(top, bot, -1.12, 0.77, W / 2 - 0.01, carPaint, f.doorWings ? T.wing(s) : T.shoulder(s), 0.12, s * (W / 4 + 0.005)));
        vslice(top, bot, -2.55, -1.14, W, carPaint, T.pelvisBack, 0.12);
        vslice(top, bot, -2.98, -2.57, W, carPaint, T.calf(1), 0.12);
        const roof = prof([[-1.55, 1.12], [-1.2, 1.36], [-0.7, 1.58], [-0.2, 1.66], [0.2, 1.64], [0.55, 1.44], [0.9, 1.12]]);
        vslice(roof, () => 1.06, -1.5, 0.88, W * 0.8, tint, T.upperChest, 0.13);
        vslice((z) => roof(z) + 0.03, (z) => roof(z) - 0.05, -0.85, 0.3, W * 0.77, carPaint, T.back, 0.08);
        SIDES.forEach((s) => {
          vstrut([s * W * 0.4, 1.12, 0.86], [s * W * 0.385, 1.62, 0.26], 0.07, 0.13, carPaint, T.head);
          vstrut([s * W * 0.4, 1.13, -1.44], [s * W * 0.385, 1.6, -0.8], 0.07, 0.16, carPaint, T.head);
          vstrut([s * W * 0.405, 1.12, -0.32], [s * W * 0.39, 1.64, -0.32], 0.06, 0.09, trim, T.head);
          if (f.stripes) {
            const x = s * 0.3;
            vslice((z) => top(z) + 0.064, (z) => top(z) + 0.03, 0.82, 2.96, 0.3, carAccent, T.chest, 0.02, x);
            vslice((z) => roof(z) + 0.076, (z) => roof(z) + 0.04, -0.8, 0.26, 0.3, carAccent, T.back, 0.02, x);
            vslice((z) => top(z) + 0.064, (z) => top(z) + 0.03, -2.96, -1.5, 0.3, carAccent, T.back, 0.02, x);
          }
          // lights, mirrors, handles, skirts
          vbox(0.5, 0.11, 0.05, trim, [s * 0.84, 0.62, 2.985], [0, 0, 0], T.light(s));
          vbox(0.42, 0.055, 0.03, lampMat, [s * 0.84, 0.625, 3.0], [0, 0, 0], T.light(s));
          vglow([s * 0.84, 0.625, 3.05], 1.1, headGlow, T.light(s));
          vcyl(0.06, 0.06, 0.04, lampMat, [s * 0.95, 0.4, 2.99], [Math.PI / 2, 0, 0], T.light(s), 16);
          vbox(0.62, 0.11, 0.04, tailMat, [s * 0.74, 0.84, -2.995], [0, 0, 0], T.pelvisBack);
          vglow([s * 0.74, 0.84, -3.05], 0.8, tailGlow, T.pelvisBack, true);
          vcyl(0.065, 0.075, 0.24, chrome, [s * 0.55, 0.38, -2.98], [Math.PI / 2, 0, 0], T.calf(s), 16);
          vbox(0.16, 0.11, 0.25, carPaint, [s * (W / 2 + 0.11), 1.2, 0.6], [0, s * -0.15, 0], T.head);
          vbox(0.12, 0.04, 0.06, trim, [s * (W / 2 + 0.04), 1.16, 0.62], [0, 0, 0], T.head);
          vbox(0.02, 0.035, 0.17, chrome, [s * (W / 2 + 0.005), 1.0, -0.25], [0, 0, 0], f.doorWings ? T.wing(s) : T.shoulder(s));
          vbox(0.08, 0.09, 2.2, trim, [s * (W / 2 - 0.02), 0.3, -0.18], [0, 0, 0], T.thigh(s));
          vbox(0.06, 0.09, 0.13, trim, [s * 0.8, 1.21, -2.72], [0, 0, 0], T.back);
        });
        vbox(1.5, 0.12, 0.04, trim, [0, 0.62, 2.99], [0, 0, 0], T.shins);
        vbox(1.9, 0.09, 0.04, trim, [0, 0.42, 2.99], [0, 0, 0], T.shins);
        for (let k = 0; k < 3; k++) vbox(1.4, 0.012, 0.02, chrome, [0, 0.58 + k * 0.03, 3.01], [0, 0, 0], T.shins);
        vbox(0.42, 0.11, 0.02, plateMat('BEE · 27'), [0, 0.47, 3.01], [0, 0, 0], T.shins);
        vbox(0.42, 0.11, 0.02, plateMat('BEE · 27'), [0, 0.62, -3.0], [0, Math.PI, 0], T.calf(1));
        vbox(0.9, 0.12, 0.04, trim, [0, 0.84, -2.995], [0, 0, 0], T.pelvisBack);
        vbox(2.05, 0.035, 0.3, carPaint, [0, 1.27, -2.76], [-0.1, 0, 0], T.back);
        const hz = 1.7;
        const slope = Math.atan2(top(hz + 0.1) - top(hz - 0.1), 0.2);
        vbox(0.62, 0.07, 0.75, carPaint, [0, top(hz) + 0.08, hz], [-slope, 0, 0], T.chest);
        vbox(0.42, 0.04, 0.04, trim, [0, top(hz) + 0.1, hz + 0.38], [-slope, 0, 0], T.chest);
        SIDES.forEach((s) => {
          vwheel(s * 1.04, 1.74, 0.46, 0.42, T.shoulder(s), gunmetal);
          vwheel(s * 1.04, -1.74, 0.46, 0.44, f.wheels ? T.calf(s) : T.thigh(s), gunmetal);
        });
        wells(W, [[1.74, 0.55, 0.46], [-1.74, 0.55, 0.46]], T.pelvis);
        cabin(0.42, -0.45, 0.62, 0.5, T.back);
        groundShadow(W, 5.96);
      } else if (hero.vehicle === 'truck') {
        // Megatron: armoured assault truck — forward cab, armoured cargo module, roof cannon, three axles.
        const W = 3.0;
        const cab = prof([[0.95, 3.0], [1.5, 3.06], [2.02, 3.02], [2.45, 2.24], [2.75, 2.14], [3.3, 2.1], [3.45, 1.88]]);
        const body = prof([[-3.36, 2.68], [-3.22, 2.9], [-2.9, 2.96], [0.62, 2.96], [0.9, 2.84]]);
        const bot = underside(() => 0.96, [[2.28, 0.8, 0.66], [-0.95, 0.8, 0.66], [-2.32, 0.8, 0.66]]);
        vbox(2.7, 0.3, 6.4, trim, [0, 0.95, 0], [0, 0, 0], T.pelvis);
        vslice(cab, bot, 2.47, 3.45, W * 0.95, carPaint, T.chest, 0.16);
        SIDES.forEach((s) => vslice(cab, bot, 0.98, 2.45, W / 2 - 0.01, carPaint, T.shoulder(s), 0.16, s * (W / 4 + 0.005)));
        vslice(body, bot, -1.28, 0.9, W, carPaint, T.back, 0.18);
        vslice(body, bot, -3.36, -1.3, W, carPaint, T.pelvisBack, 0.18);
        vstrut([0, 2.27, 2.47], [0, 2.99, 2.06], W * 0.84, 0.04, tint, T.head);
        vstrut([0, 2.99, 2.04], [0, 2.99, 1.2], W * 0.86, 0.03, steel, T.head);
        vbox(3.25, 0.38, 0.32, steel, [0, 1.05, 3.55], [0, 0, 0], T.shins);
        for (let k = 0; k < 4; k++) vbox(0.07, 0.75, 0.07, chrome, [-0.9 + k * 0.6, 1.55, 3.62], [0, 0, 0], T.shins);
        vbox(2.2, 0.07, 0.07, chrome, [0, 1.95, 3.62], [0, 0, 0], T.shins);
        vbox(2.0, 0.52, 0.05, trim, [0, 1.62, 3.47], [0, 0, 0], T.chest);
        for (let k = 0; k < 5; k++) vbox(1.9, 0.035, 0.03, chrome, [0, 1.42 + k * 0.1, 3.5], [0, 0, 0], T.chest);
        vbox(1.7, 0.12, 0.2, lampMat, [0, 3.13, 1.9], [0, 0, 0], T.head);
        vbox(1.8, 0.09, 0.09, glowMat, [0, 2.92, 3.12], [0, 0, 0], T.head);
        vbox(0.5, 0.14, 0.02, plateMat('MGT · 27'), [0, 0.98, 3.72], [0, 0, 0], T.shins);
        vcyl(0.3, 0.34, 2.8, accent, [0.6, 3.25, -0.9], [Math.PI / 2, 0, 0], T.cannon, 24);
        vcyl(0.38, 0.38, 0.3, steel, [0.6, 3.25, 0.55], [Math.PI / 2, 0, 0], T.cannon, 24);
        vcyl(0.24, 0.27, 0.1, glowMat, [0.6, 3.25, 0.72], [Math.PI / 2, 0, 0], T.cannon, 24);
        vcyl(0.62, 0.74, 0.35, steel, [0.6, 3.05, -1.7], [0, 0, 0], T.cannon, 10);
        for (let k = 0; k < 4; k++) vcyl(0.34, 0.34, 0.05, chrome, [0.6, 3.25, -1.7 + k * 0.5], [Math.PI / 2, 0, 0], T.cannon, 24);
        SIDES.forEach((s) => {
          vcyl(0.17, 0.17, 0.09, lampMat, [s * 1.12, 1.95, 3.47], [Math.PI / 2, 0, 0], T.light(s), 24);
          vglow([s * 1.12, 1.95, 3.56], 1.3, headGlow, T.light(s));
          vp(put(new THREE.TorusGeometry(0.18, 0.025, 8, 28), chrome, veh, [s * 1.12, 1.95, 3.5]), T.light(s));
          vbox(0.4, 0.16, 0.05, tailMat, [s * 1.18, 1.35, -3.38], [0, 0, 0], T.pelvisBack);
          vglow([s * 1.18, 1.35, -3.44], 0.8, tailGlow, T.pelvisBack, true);
          vbox(0.03, 0.55, 0.72, tint, [s * (W / 2 + 0.006), 2.62, 1.6], [0, 0, 0], T.head);
          vcyl(0.09, 0.09, 1.7, chrome, [s * 1.38, 3.05, 0.82], [0, 0, 0], T.shoulder(s), 16);
          vcyl(0.11, 0.09, 0.12, trim, [s * 1.38, 3.93, 0.82], [0, 0, 0], T.shoulder(s), 16);
          vcyl(0.3, 0.3, 1.05, steel, [s * 1.32, 1.2, 0.68], [Math.PI / 2, 0, 0], T.thigh(s), 24);
          for (let k = 0; k < 2; k++) vbox(0.64, 0.05, 0.05, trim, [s * 1.32, 1.2, 0.35 + k * 0.66], [0, 0, 0], T.thigh(s));
          vbox(0.08, 0.42, 0.26, trim, [s * (W / 2 + 0.32), 2.55, 2.25], [0, 0, 0], T.head);
          vstrut([s * (W / 2), 2.55, 2.3], [s * (W / 2 + 0.3), 2.55, 2.27], 0.04, 0.04, chrome, T.head, true);
          vbox(0.05, 0.18, 1.6, steel, [s * (W / 2 + 0.03), 1.3, -2.1], [0, 0, 0], T.thigh(s));
          for (let k = 0; k < 3; k++) {
            vp(put(new THREE.ConeGeometry(0.12, 0.6, 5), steel, veh, [s * (0.5 + k * 0.4), 3.25, -2.4 + k * 0.5], [0, 0, s * -0.3]), T.shoulder(s));
          }
          [2.28, -0.95, -2.32].forEach((z, k) => vwheel(s * 1.22, z, 0.66, 0.52, k === 0 ? T.shoulder(s) : k === 1 ? T.thigh(s) : T.shin(s), gunmetal, true, false));
        });
        wells(W, [[2.28, 0.8, 0.66], [-0.95, 0.8, 0.66], [-2.32, 0.8, 0.66]], T.pelvis);
        cabin(1.75, 1.45, 2.2, 0.65, T.upperChest);
        groundShadow(W, 7.0);
      } else if (hero.vehicle === 'tank') {
        // Shockwave: Cybertronian hover-tank — sloped hull, faceted turret, long gun, hover pads.
        const W = 3.6;
        const hull = prof([[-2.85, 1.05], [-2.6, 1.32], [-1.0, 1.4], [1.4, 1.4], [2.4, 1.12], [2.9, 0.9]]);
        const hullBot = prof([[-2.85, 0.8], [-2.5, 0.48], [2.2, 0.45], [2.9, 0.72]]);
        vslice(hull, hullBot, 1.43, 2.9, W, carPaint, T.chest, 0.16);
        vslice(hull, hullBot, -2.85, 1.41, W, carPaint, T.pelvis, 0.16);
        const tShape = outline([[-1.0, -1.25], [1.0, -1.25], [1.25, 0.05], [0.75, 1.05], [-0.75, 1.05], [-1.25, 0.05]]);
        const turret = new THREE.ExtrudeGeometry(tShape, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.08, bevelSegments: 4, curveSegments: 1 });
        turret.rotateX(Math.PI / 2);
        turret.translate(0, 1.42 + 0.7, -0.3);
        vmesh(toCreasedNormals(turret, 0.5), carPaint, T.back);
        vcyl(0.34, 0.36, 0.1, steel, [0.45, 2.24, -0.75], [0, 0, 0], T.back, 24);
        vbox(0.2, 0.14, 0.14, tint, [-0.5, 2.24, 0.35], [0, 0, 0], T.head);
        vbox(0.9, 0.5, 0.38, steel, [0, 1.85, 0.85], [0, 0, 0], T.cannon);
        vcyl(0.15, 0.19, 3.4, carAccent, [0, 1.85, 2.55], [Math.PI / 2, 0, 0], T.cannon, 24);
        vcyl(0.25, 0.25, 0.55, steel, [0, 1.85, 2.6], [Math.PI / 2, 0, 0], T.cannon, 24);
        vbox(0.44, 0.3, 0.42, steel, [0, 1.85, 4.3], [0, 0, 0], T.cannon);
        vcyl(0.13, 0.13, 0.06, glowMat, [0, 1.85, 4.53], [Math.PI / 2, 0, 0], T.cannon, 24);
        vcyl(0.22, 0.22, 0.12, eyeMat, [0, 2.0, 0.78], [Math.PI / 2, 0, 0], T.head, 28);
        vp(put(new THREE.TorusGeometry(0.24, 0.035, 8, 32), chrome, veh, [0, 2.0, 0.84]), T.head);
        for (let k = 0; k < 6; k++) vbox(1.7, 0.035, 0.11, trim, [0, 1.42, -2.35 + k * 0.2], [0, 0, 0], T.pelvis);
        SIDES.forEach((s) => {
          vslice(() => 1.18, () => 0.36, -2.7, 2.65, 0.22, carAccent, T.shin(s), 0.05, s * 1.93);
          for (let k = 0; k < 4; k++) vbox(0.03, 0.42, 1.0, steel, [s * 2.06, 0.78, -1.95 + k * 1.3], [0, 0, 0], T.shin(s));
          [1.8, -1.8].forEach((z) => {
            vcyl(0.5, 0.6, 0.18, trim, [s * 1.25, 0.42, z], [0, 0, 0], T.knee(s), 28);
            vcyl(0.42, 0.42, 0.04, glowMat, [s * 1.25, 0.32, z], [0, 0, 0], T.knee(s), 28);
          });
          vstrut([s * 0.8, 2.1, -1.2], [s * 0.86, 3.4, -1.36], 0.022, 0.022, chrome, T.head, true);
          vbox(0.3, 0.1, 0.05, lampMat, [s * 1.2, 1.06, 2.78], [0, 0, 0], T.light(s));
          vglow([s * 1.2, 1.06, 2.84], 0.9, headGlow, T.light(s));
          vbox(0.32, 0.1, 0.05, tailMat, [s * 1.2, 1.05, -2.87], [0, 0, 0], T.pelvis);
        });
        groundShadow(W, 5.8);
      } else {
        // Ratchet: modern box-body ambulance — van cab, patient module, Battenburg livery, Star of Life,
        // multi-segment light bar, compartment doors, chevroned rear doors and dual rear wheels.
        const red = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3, transparent: true, opacity: 1 });
        const blue = new THREE.MeshStandardMaterial({ color: 0x2b6cff, emissive: 0x2b6cff, emissiveIntensity: 3, transparent: true, opacity: 1 });
        const amber = new THREE.MeshStandardMaterial({ color: 0xffa21a, emissive: 0xffa21a, emissiveIntensity: 1.5, roughness: 0.3, transparent: true, opacity: 1 });
        materials.push(red, blue, amber);
        emissives.push(amber);
        siren = [red, blue];
        carPaint.color.setHex(0xf2f4f7);
        const W = 2.85;
        const cab = prof([[1.1, 2.66], [1.6, 2.64], [2.0, 2.46], [2.45, 1.8], [2.75, 1.62], [3.15, 1.46], [3.3, 1.18]]);
        const mod = prof([[-3.3, 2.82], [-3.2, 2.98], [-3.0, 3.05], [0.95, 3.05], [1.12, 2.94]]);
        const bot = underside((z) => (z > 2.6 || z < -2.7 ? 0.5 : 0.42), [[2.05, 0.6, 0.5], [-2.0, 0.6, 0.5]]);
        vslice(cab, bot, 2.42, 3.3, W * 0.96, carPaint, T.chest, 0.14);
        SIDES.forEach((s) => vslice(cab, bot, 1.12, 2.4, W / 2 - 0.01, carPaint, T.shoulder(s), 0.14, s * (W / 4 + 0.005)));
        vslice(mod, bot, -1.1, 1.1, W, carPaint, T.back, 0.2);
        vslice(mod, bot, -3.3, -1.12, W, carPaint, T.pelvisBack, 0.2);
        vstrut([0, 1.84, 2.43], [0, 2.6, 1.99], W * 0.86, 0.04, tint, T.head);

        const decal = (tex: THREE.Texture) => {
          textures.push(tex);
          const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
          materials.push(m);
          return m;
        };
        const sideLivery = decal(canvasTexture(1024, 512, (g) => {
          g.clearRect(0, 0, 1024, 512);
          g.fillStyle = '#c8102e';
          g.fillRect(0, 326, 1024, 10);
          for (let col = 0; col < 32; col++) {
            for (let row = 0; row < 2; row++) {
              g.fillStyle = (col + row) % 2 === 0 ? '#c8102e' : '#ffffff';
              g.fillRect(col * 32, 340 + row * 32, 32, 32);
            }
          }
          g.fillStyle = '#c8102e';
          g.fillRect(0, 408, 1024, 10);
          // Star of Life: three crossed bars with a white rod of Asclepius
          g.save();
          g.translate(512, 150);
          g.fillStyle = '#ffffff';
          for (let k = 0; k < 3; k++) {
            g.save();
            g.rotate((k * Math.PI) / 3);
            g.fillRect(-36, -104, 72, 208);
            g.restore();
          }
          g.fillStyle = '#1f5fbf';
          for (let k = 0; k < 3; k++) {
            g.save();
            g.rotate((k * Math.PI) / 3);
            g.fillRect(-28, -96, 56, 192);
            g.restore();
          }
          g.fillStyle = '#ffffff';
          g.fillRect(-5, -70, 10, 140);
          g.strokeStyle = '#ffffff';
          g.lineWidth = 6;
          g.beginPath();
          g.moveTo(-14, 52);
          g.bezierCurveTo(20, 34, -20, 14, 14, -6);
          g.bezierCurveTo(30, -18, -18, -36, 4, -56);
          g.stroke();
          g.restore();
          g.fillStyle = '#c8102e';
          g.font = '900 72px "Oxanium", "Arial Black", sans-serif';
          g.textAlign = 'center';
          g.fillText('AMBULANCE', 512, 312);
          g.fillStyle = '#3a4250';
          g.font = '700 26px "Oxanium", "Arial Black", sans-serif';
          g.fillText('RATCHET  ·  EMERGENCY RESCUE  ·  OPTIMUS 27', 512, 470);
        }, true));
        const frontWord = decal(canvasTexture(512, 80, (g) => {
          g.clearRect(0, 0, 512, 80);
          g.save();
          g.scale(-1, 1);
          g.fillStyle = '#c8102e';
          g.font = '900 60px "Oxanium", "Arial Black", sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('AMBULANCE', -256, 42);
          g.restore();
        }, true));
        const rearLivery = decal(canvasTexture(512, 456, (g) => {
          g.clearRect(0, 0, 512, 456);
          g.fillStyle = '#c8102e';
          g.font = '900 52px "Oxanium", "Arial Black", sans-serif';
          g.textAlign = 'center';
          g.fillText('AMBULANCE', 256, 232);
          g.save();
          g.beginPath();
          g.rect(0, 262, 512, 178);
          g.clip();
          for (let k = -12; k < 20; k++) {
            g.fillStyle = k % 2 === 0 ? '#d81f26' : '#ffd21a';
            g.beginPath();
            const x = k * 40;
            g.moveTo(x, 440);
            g.lineTo(x + 40, 440);
            g.lineTo(x + 40 + 178, 262);
            g.lineTo(x + 178, 262);
            g.closePath();
            g.fill();
          }
          g.restore();
        }, true));
        SIDES.forEach((s) => {
          const side = put(new THREE.PlaneGeometry(4.2, 2.1), sideLivery, veh, [s * (W / 2 + 0.012), 1.95, -1.1], [0, s * Math.PI / 2, 0]);
          side.castShadow = false;
          vp(side, T.chest);
        });
        const fw = put(new THREE.PlaneGeometry(2.3, 0.36), frontWord, veh, [0, 2.92, 1.225]);
        fw.castShadow = false;
        vp(fw, T.upperChest);
        const rw = put(new THREE.PlaneGeometry(2.6, 2.3), rearLivery, veh, [0, 1.85, -3.405], [0, Math.PI, 0]);
        rw.castShadow = false;
        vp(rw, T.pelvisBack);

        // cab roof light bar: alternating red / white / blue segments on a black base
        vbox(1.72, 0.1, 0.34, trim, [0, 2.78, 1.72], [0, 0, 0], T.head);
        [red, lampMat, red, blue, lampMat, blue].forEach((m, k) => vbox(0.25, 0.12, 0.28, m, [-0.65 + k * 0.26, 2.89, 1.72], [0, 0, 0], k < 3 ? T.shoulder(-1) : T.shoulder(1)));
        vbox(0.9, 0.22, 0.85, steel, [0, 3.26, -1.5], [0, 0, 0], T.back);
        for (let k = 0; k < 4; k++) vbox(0.8, 0.02, 0.05, trim, [0, 3.38, -1.8 + k * 0.2], [0, 0, 0], T.back);

        // front end: black bumper, grille + badge, headlight clusters, fogs, siren speaker, wipers
        vbox(3.0, 0.32, 0.32, trim, [0, 0.62, 3.42], [0, 0, 0], T.shins);
        vbox(1.3, 0.32, 0.05, trim, [0, 1.02, 3.37], [0, 0, 0], T.shins);
        for (let k = 0; k < 3; k++) vbox(1.2, 0.025, 0.03, chrome, [0, 0.93 + k * 0.09, 3.4], [0, 0, 0], T.shins);
        vcyl(0.075, 0.075, 0.03, chrome, [0, 1.02, 3.41], [Math.PI / 2, 0, 0], T.shins, 20);
        vbox(0.5, 0.14, 0.02, plateMat('RCH · 27'), [0, 0.62, 3.59], [0, 0, 0], T.shins);
        vbox(0.3, 0.18, 0.08, steel, [-0.62, 0.66, 3.6], [0, 0, 0], T.shins);
        for (let k = 0; k < 4; k++) vbox(0.26, 0.012, 0.02, trim, [-0.62, 0.6 + k * 0.04, 3.645], [0, 0, 0], T.shins);
        SIDES.forEach((s) => {
          vbox(0.55, 0.2, 0.05, trim, [s * 0.98, 1.05, 3.37], [0, 0, 0], T.light(s));
          vbox(0.2, 0.12, 0.03, lampMat, [s * 1.1, 1.06, 3.395], [0, 0, 0], T.light(s));
          vbox(0.14, 0.12, 0.03, lampMat, [s * 0.86, 1.06, 3.395], [0, 0, 0], T.light(s));
          vbox(0.48, 0.025, 0.02, lampMat, [s * 0.98, 0.965, 3.4], [0, 0, 0], T.light(s));
          vglow([s * 0.98, 1.05, 3.43], 1.1, headGlow, T.light(s));
          vcyl(0.07, 0.07, 0.03, lampMat, [s * 1.12, 0.66, 3.59], [Math.PI / 2, 0, 0], T.light(s), 16);
          vbox(0.62, 0.02, 0.03, trim, [s * 0.38, 1.92, 2.4], [-0.96, 0, s * 0.22], T.head);
          vstrut([s * W * 0.44, 1.82, 2.45], [s * W * 0.44, 2.6, 2.0], 0.08, 0.1, trim, T.head);
        });

        // sides: cab doors, windows, mirrors, steps; module compartment doors, window, scene lights
        const doorFrame = (s: number, z0: number, z1: number, y0: number, y1: number, target: number[]) => {
          const x = s * (W / 2 + 0.016);
          vbox(0.012, 0.025, z1 - z0, trim, [x, y1, (z0 + z1) / 2], [0, 0, 0], target);
          vbox(0.012, 0.025, z1 - z0, trim, [x, y0, (z0 + z1) / 2], [0, 0, 0], target);
          vbox(0.012, y1 - y0, 0.025, trim, [x, (y0 + y1) / 2, z0], [0, 0, 0], target);
          vbox(0.012, y1 - y0, 0.025, trim, [x, (y0 + y1) / 2, z1], [0, 0, 0], target);
          vbox(0.025, 0.05, 0.18, chrome, [x + s * 0.01, (y0 + y1) / 2, z1 - 0.18], [0, 0, 0], target);
        };
        SIDES.forEach((s) => {
          vbox(0.03, 0.58, 0.78, tint, [s * (W / 2 + 0.006), 2.16, 1.66], [0, 0, 0], T.head);
          vbox(0.012, 1.45, 0.025, trim, [s * (W / 2 + 0.008), 1.72, 2.2], [0, 0, 0], T.shoulder(s));
          vbox(0.012, 1.45, 0.025, trim, [s * (W / 2 + 0.008), 1.72, 1.2], [0, 0, 0], T.shoulder(s));
          vbox(0.02, 0.04, 0.16, chrome, [s * (W / 2 + 0.008), 1.55, 1.45], [0, 0, 0], T.shoulder(s));
          vbox(0.26, 0.06, 0.7, trim, [s * (W / 2 - 0.05), 0.5, 1.65], [0, 0, 0], T.shoulder(s));
          vbox(0.07, 0.42, 0.26, trim, [s * (W / 2 + 0.26), 2.05, 2.15], [0, 0, 0], T.head);
          vbox(0.012, 0.34, 0.2, tint, [s * (W / 2 + 0.3), 2.05, 2.15], [0, 0, 0], T.head);
          vstrut([s * (W / 2), 2.05, 2.2], [s * (W / 2 + 0.23), 2.05, 2.17], 0.035, 0.035, chrome, T.head, true);
          doorFrame(s, -1.25, -0.2, 1.15, 2.85, T.back);
          doorFrame(s, 0.05, 0.95, 1.15, 2.85, T.back);
          vbox(0.02, 0.42, 0.55, tint, [s * (W / 2 + 0.02), 2.45, 0.5], [0, 0, 0], T.back);
          vbox(0.035, 0.12, 0.36, lampMat, [s * (W / 2 + 0.02), 2.98, -2.7], [0, 0, 0], T.pelvisBack);
          vbox(0.035, 0.12, 0.36, lampMat, [s * (W / 2 + 0.02), 2.98, 0.7], [0, 0, 0], T.back);
          vstrut([s * (W / 2 + 0.04), 2.7, -3.0], [s * (W / 2 + 0.04), 2.7, -1.6], 0.022, 0.022, chrome, T.pelvisBack, true);
          vbox(0.06, 0.12, 2.6, trim, [s * (W / 2 - 0.01), 0.55, -0.6], [0, 0, 0], T.thigh(s));
          vbox(0.2, 0.14, 0.2, s < 0 ? red : blue, [s * 1.28, 3.1, 1.12], [0, 0, 0], T.back);
          vbox(0.2, 0.14, 0.2, s < 0 ? red : blue, [s * 1.28, 3.1, -3.22], [0, 0, 0], T.pelvisBack);
          vbox(0.4, 0.45, 0.03, trim, [s * 1.0, 0.55, -2.75], [0, 0, 0], T.calf(s));
          vwheel(s * 1.2, 2.05, 0.5, 0.44, T.shoulder(s), chrome);
          vwheel(s * 1.2, -2.0, 0.5, 0.46, T.calf(s), chrome);
          vwheel(s * 0.74, -2.0, 0.5, 0.4, T.calf(s), chrome, false, false);
        });
        wells(W, [[2.05, 0.6, 0.5], [-2.0, 0.6, 0.5]], T.pelvis);
        cabin(0.75, 1.5, 2.22, 0.6, T.upperChest);
        groundShadow(W, 6.7);

        // rear: doors with seam, windows and handles, vertical light clusters, step bumper
        vbox(0.03, 2.1, 0.02, trim, [0, 1.85, -3.415], [0, 0, 0], T.pelvisBack);
        vbox(2.9, 0.18, 0.45, steel, [0, 0.62, -3.58], [0, 0, 0], T.pelvisBack);
        for (let k = 0; k < 6; k++) vbox(2.7, 0.012, 0.03, trim, [0, 0.715, -3.4 - k * 0.07], [0, 0, 0], T.pelvisBack);
        vcyl(0.06, 0.07, 0.3, chrome, [0.9, 0.38, -3.3], [Math.PI / 2, 0, 0], T.pelvisBack, 14);
        SIDES.forEach((s) => {
          vbox(0.45, 0.42, 0.03, tint, [s * 0.68, 2.35, -3.415], [0, 0, 0], T.pelvisBack);
          vbox(0.04, 0.18, 0.03, chrome, [s * 0.15, 1.6, -3.43], [0, 0, 0], T.pelvisBack);
          vbox(0.24, 0.22, 0.05, tailMat, [s * 1.22, 1.25, -3.42], [0, 0, 0], T.pelvisBack);
          vbox(0.24, 0.18, 0.05, amber, [s * 1.22, 1.02, -3.42], [0, 0, 0], T.pelvisBack);
          vbox(0.24, 0.14, 0.05, lampMat, [s * 1.22, 0.85, -3.42], [0, 0, 0], T.pelvisBack);
          vglow([s * 1.22, 1.2, -3.46], 0.9, tailGlow, T.pelvisBack, true);
          vbox(0.22, 0.12, 0.05, s < 0 ? red : blue, [s * 0.95, 3.07, -3.42], [0, 0, 0], T.pelvisBack);
        });
      }

      // Swap in a real vehicle model when one exists: normalise its size and heading, then every
      // mesh in it becomes a panel that flies onto the matching robot armour when transforming.
      const real = VEHICLE_MODELS[hero.key];
      if (real) {
        gltfLoader.load(real.src, (gltf) => {
          if (envDisposed) return;
          const wrap = new THREE.Group();
          wrap.add(gltf.scene);
          let box = new THREE.Box3().setFromObject(wrap);
          const raw = box.getSize(new THREE.Vector3());
          wrap.rotation.y = (raw.x > raw.z ? Math.PI / 2 : 0) + (real.yaw ?? 0);
          wrap.updateMatrixWorld(true);
          box = new THREE.Box3().setFromObject(wrap);
          wrap.scale.setScalar(real.length / Math.max(box.getSize(new THREE.Vector3()).z, 1e-3));
          wrap.updateMatrixWorld(true);
          box = new THREE.Box3().setFromObject(wrap);
          const ctr = box.getCenter(new THREE.Vector3());
          wrap.position.set(-ctr.x, -box.min.y, -ctr.z);
          const height = box.max.y - box.min.y;

          veh.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
          veh.clear();
          panels.length = 0;
          wheels.length = 0;
          veh.add(wrap);
          veh.updateMatrixWorld(true);
          const meshes: THREE.Mesh[] = [];
          wrap.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
          const half = real.length / 2;
          meshes.forEach((m) => {
            veh.attach(m);
            // Re-centre each part on its own geometry so it flies and shrinks about itself.
            m.geometry = m.geometry.clone();
            m.geometry.computeBoundingBox();
            const local = m.geometry.boundingBox!.getCenter(new THREE.Vector3());
            m.geometry.translate(-local.x, -local.y, -local.z);
            m.position.copy(local.applyMatrix4(m.matrix));
            m.castShadow = true;
            m.receiveShadow = true;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mat) => {
              if (materials.includes(mat)) return;
              mat.transparent = true;
              mat.userData.base = mat.opacity;
              materials.push(mat);
            });
            const p = m.position;
            const side = p.x >= 0 ? 1 : -1;
            const target = p.z > half * 0.45 ? (p.y < height * 0.4 ? T.shins : T.chest)
              : p.z < -half * 0.45 ? (p.y < height * 0.4 ? T.calf(side) : T.pelvisBack)
              : p.y > height * 0.62 ? (Math.abs(p.x) < 0.4 ? T.upperChest : T.head)
              : Math.abs(p.x) > 0.5 ? (f.doorWings ? T.wing(side) : T.shoulder(side)) : T.back;
            vp(m, target);
          });
          wrap.removeFromParent();
        }, undefined, () => { /* no model file yet: keep the code-built vehicle */ });
      }

      outer.scale.setScalar(hero.layout.scale * 0.8);
      const baseY = GROUND_Y + (hero.layout.y || 0);
      outer.position.set(hero.layout.x, baseY, hero.layout.z);
      outer.userData.heroKey = hero.key;
      materials.forEach((m) => { m.userData.base = m.opacity; });
      emissives.forEach((m) => { m.userData.emi = m.emissiveIntensity; });
      return {
        group: outer, rig, veh, panels, wheels, foldJoints, headRestY: head.position.y, siren, vehicle: hero.vehicle,
        vehMats: [carPaint, carAccent, tint, gunmetal, rimBarrel],
        materials, emissives, ring, introStart: -1, introFrom: -34, introTo: 0, introCam: true, stageHidden: false, wasStaged: false, locked: false, head, phase: Math.random() * Math.PI * 2, baseY,
        act: { shoulders: actShoulders, elbows: actElbows, cannon: actCannon, rigRestY: rig.position.y, headYaw: 0, headPitch: 0 }
      };
    };

    HEROES.forEach((hero) => {
      const rec = buildHero(hero);
      records[hero.key] = rec;
      scene.add(rec.group);
    });

    /* ---------- drifting embers & dust ---------- */
    const EMBERS = lite ? 120 : lowPower ? 260 : 520;
    const eGeo = new THREE.BufferGeometry();
    const ePos = new Float32Array(EMBERS * 3);
    const eCol = new Float32Array(EMBERS * 3);
    const eVel = new Float32Array(EMBERS);
    const warmC = new THREE.Color(0xffa24a);
    const coolC = new THREE.Color(0x8fd8ff);
    for (let i = 0; i < EMBERS; i++) {
      ePos[i * 3] = (Math.random() - 0.5) * 44;
      ePos[i * 3 + 1] = GROUND_Y + Math.random() * 16;
      ePos[i * 3 + 2] = -24 + Math.random() * 30;
      eVel[i] = 0.25 + Math.random() * 0.9;
      const col = Math.random() < 0.7 ? warmC : coolC;
      const k = 0.6 + Math.random() * 0.6;
      eCol[i * 3] = col.r * k;
      eCol[i * 3 + 1] = col.g * k;
      eCol[i * 3 + 2] = col.b * k;
    }
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
    const eMat = new THREE.PointsMaterial({
      size: 0.14, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    scene.add(new THREE.Points(eGeo, eMat));

    /* ---------- transformation FX (first visit to each hero) ---------- */
    const flash = new THREE.PointLight(0xffffff, 0, 28, 2);
    scene.add(flash);
    const SPARKS = 200;
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(SPARKS * 3);
    const sVel = new Float32Array(SPARKS * 3);
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    const sMat = new THREE.PointsMaterial({
      size: 0.16, map: glowTex, color: 0xffe0b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
    });
    const sparks = new THREE.Points(sGeo, sMat);
    sparks.frustumCulled = false;
    scene.add(sparks);
    let sparkT = -1;
    let shakeT = -1;
    const burst = (center: THREE.Vector3, color: number) => {
      for (let i = 0; i < SPARKS; i++) {
        sPos[i * 3] = center.x;
        sPos[i * 3 + 1] = center.y;
        sPos[i * 3 + 2] = center.z;
        const v = new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 7);
        sVel[i * 3] = v.x;
        sVel[i * 3 + 1] = Math.abs(v.y) * 0.8 + 1.5;
        sVel[i * 3 + 2] = v.z;
      }
      sGeo.attributes.position.needsUpdate = true;
      sMat.color.set(color).lerp(new THREE.Color(0xffffff), 0.45);
      sMat.opacity = 1;
      sparkT = 0;
      flash.position.copy(center);
      flash.color.set(color);
      flash.intensity = 900;
      shakeT = 0;
    };
    const easeOutBack = (p: number) => {
      const c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    };
    const easeIO = (n: number, a: number, b: number) => {
      const x = THREE.MathUtils.clamp((n - a) / (b - a), 0, 1);
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    };
    // Intro timeline (seconds) — the sound cues in CinematicAudio.playVehicleIntro match these.
    const DRIVE = 1.7;          // vehicle drives in and skids to a stop
    const TF_START = 2.0;       // armour starts peeling off
    const TF = 1.5;             // robot unfolds and stands
    const INTRO_LOCK = 3.5;     // lock-in impact
    const INTRO_END = 4.2;
    const DRIVE_FROM = -34;
    let lastIntroId = 0;
    let lastStageIntro = 0;
    let introRec: HeroRec | null = null;

    // n = 0: robot folded prone inside the vehicle; n = 1: standing in its rest pose.
    const applyUnfold = (rec: HeroRec, n: number) => {
      rec.rig.rotation.x = (Math.PI / 2) * (1 - easeIO(n, 0.1, 0.7));
      rec.rig.position.y = 1.0 + 2.9 * easeIO(n, 0.1, 0.75);
      rec.rig.scale.setScalar(0.72 + 0.28 * easeIO(n, 0.2, 0.85));
      rec.foldJoints.forEach((j) => {
        const k = easeIO(n, j.from, j.to);
        j.obj.rotation.set(
          j.fold.x + (j.rest.x - j.fold.x) * k,
          j.fold.y + (j.rest.y - j.fold.y) * k,
          j.fold.z + (j.rest.z - j.fold.z) * k
        );
      });
      const hk = n < 0.7 ? 0 : easeOutBack(THREE.MathUtils.clamp((n - 0.7) / 0.3, 0, 1));
      rec.head.position.y = rec.headRestY - 0.6 * (1 - hk);
      rec.head.scale.setScalar(Math.max(0.001, 0.35 + 0.65 * hk));
    };

    // Per-event idle behaviour so the robots act, not just stand.
    //  bumblebee = hackathon: fast, restless, "coding/hammering" hands.
    //  megatron  = presentation arena / warlord: slowly raises and aims his cannon.
    //  shockwave = workshop / logician: head scans the room, one arm lectures/points.
    //  ratchet   = non-technical fun events / medic: friendly wave and nod.
    const shoulderL = (rec: HeroRec) => rec.act.shoulders.find((j) => j.s === -1);
    const shoulderR = (rec: HeroRec) => rec.act.shoulders.find((j) => j.s === 1);
    const elbowL = (rec: HeroRec) => rec.act.elbows.find((j) => j.s === -1);
    const elbowR = (rec: HeroRec) => rec.act.elbows.find((j) => j.s === 1);
    const setJoint = (j: { obj: THREE.Object3D; rest: THREE.Euler } | undefined, dx: number, dy: number, dz: number) => {
      if (!j) return;
      j.obj.rotation.set(j.rest.x + dx, j.rest.y + dy, j.rest.z + dz);
    };
    const resetAction = (rec: HeroRec) => {
      rec.act.headYaw = 0;
      rec.act.headPitch = 0;
    };
    const applyAction = (rec: HeroRec, hero: Hero, t: number, focused: boolean) => {
      const amp = focused ? 1 : 0.62;   // roster heroes idle more calmly than the inspected one
      let bob = 0, swayZ = 0, leanX = 0;
      const sL = shoulderL(rec), sR = shoulderR(rec), eL = elbowL(rec), eR = elbowR(rec);
      switch (hero.key) {
        case 'bumblebee': {
          // Restless builder: quick bounce + alternating hands hammering away at a keyboard.
          const f = t * 3.2;
          bob = Math.sin(f) * 0.10 * amp;
          swayZ = Math.sin(f * 0.5) * 0.03 * amp;
          const type = (ph: number) => -(0.12 + 0.22 * (0.5 + 0.5 * Math.sin(f + ph))) * amp;
          setJoint(sR, Math.sin(f + 0) * 0.05 * amp, 0, 0);
          setJoint(sL, Math.sin(f + Math.PI) * 0.05 * amp, 0, 0);
          setJoint(eR, type(0), 0, 0);
          setJoint(eL, type(Math.PI), 0, 0);
          rec.act.headPitch = 0.05 + Math.sin(f) * 0.05 * amp;
          rec.act.headYaw = Math.sin(f * 0.33) * 0.12 * amp;
          break;
        }
        case 'megatron': {
          // Warlord commanding the arena: leans in and slowly raises his cannon to aim.
          const f = t * 0.7;
          leanX = (0.05 + 0.03 * Math.sin(f)) * amp;
          swayZ = Math.sin(f * 0.6) * 0.04 * amp;
          bob = Math.sin(f) * 0.04 * amp;
          const aim = 0.5 + 0.5 * Math.sin(f);           // 0 = arm down, 1 = cannon levelled
          setJoint(sR, -1.05 * aim * amp, 0, 0.2 * aim * amp);
          setJoint(eR, 0.35 * aim * amp, 0, 0);
          setJoint(sL, Math.sin(f * 0.5) * 0.06 * amp, 0, 0);
          if (rec.act.cannon) setJoint(rec.act.cannon, Math.sin(t * 6) * 0.015 * aim, 0, 0);  // barrel hums
          rec.act.headYaw = Math.sin(f * 0.5) * 0.18 * amp;
          rec.act.headPitch = -0.05 * amp;
          break;
        }
        case 'shockwave': {
          // Cold logician running a lab: head sweeps a scan, one arm lectures/points.
          const f = t * 0.9;
          bob = Math.sin(f * 1.4) * 0.03 * amp;
          const point = 0.5 + 0.5 * Math.sin(f * 0.7);   // raises the pointing arm and holds
          setJoint(sL, -0.95 * point * amp, 0, -0.15 * point * amp);
          setJoint(eL, (-0.4 + 0.3 * Math.sin(f * 2)) * point * amp, 0, 0);
          setJoint(sR, Math.sin(f) * 0.04 * amp, 0, 0);
          rec.act.headYaw = Math.sin(f * 0.8) * 0.55 * amp;   // steady scan
          rec.act.headPitch = Math.sin(f * 1.6) * 0.05 * amp;
          break;
        }
        case 'ratchet': {
          // Friendly medic welcoming the fun events: waves and nods.
          const f = t * 1.8;
          bob = Math.sin(f) * 0.06 * amp;
          swayZ = Math.sin(f * 0.5) * 0.04 * amp;
          setJoint(sR, -1.15 * amp, 0, (0.25 + Math.sin(f * 2.6) * 0.05) * amp);  // arm up
          setJoint(eR, 0, 0, Math.sin(f * 2.6) * 0.5 * amp);                       // hand waves
          setJoint(sL, Math.sin(f * 0.7) * 0.05 * amp, 0, 0);
          rec.act.headPitch = 0.04 + Math.sin(f * 0.9) * 0.06 * amp;               // nodding
          rec.act.headYaw = Math.sin(f * 0.4) * 0.1 * amp;
          break;
        }
      }
      rec.rig.position.y = rec.act.rigRestY + bob;
      rec.rig.rotation.z = swayZ;
      rec.rig.rotation.x = leanX;
    };

    // Headlight beam that sweeps the wet floor while a vehicle drives in.
    const headBeam = new THREE.SpotLight(0xfff1d6, 0, 40, 0.45, 0.6, 1.4);
    scene.add(headBeam, headBeam.target);

    // Tyre smoke / hover dust.
    const SMOKE = 120;
    const smGeo = new THREE.BufferGeometry();
    const smPos = new Float32Array(SMOKE * 3);
    const smCol = new Float32Array(SMOKE * 3);
    const smVel = new Float32Array(SMOKE * 3);
    const smLife = new Float32Array(SMOKE);
    smGeo.setAttribute('position', new THREE.BufferAttribute(smPos, 3));
    smGeo.setAttribute('color', new THREE.BufferAttribute(smCol, 3));
    // fog: false — idle particles are black and parked at the origin; fog would tint all 120 of them
    // and, added together, they showed as a glowing dot in the middle of the stage.
    const smoke = new THREE.Points(smGeo, new THREE.PointsMaterial({
      size: 2.2, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    }));
    smoke.frustumCulled = false;
    scene.add(smoke);
    let smNext = 0;
    const tmpV = new THREE.Vector3();
    const emitSmoke = (rec: HeroRec, n: number) => {
      rec.group.updateMatrixWorld();
      for (let k = 0; k < n; k++) {
        const i = smNext;
        smNext = (smNext + 1) % SMOKE;
        tmpV.set((Math.random() < 0.5 ? -1 : 1) * 1.5, 0.3, -1.95);
        rec.group.localToWorld(tmpV);
        smPos.set([tmpV.x, tmpV.y, tmpV.z], i * 3);
        smVel.set([(Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5], i * 3);
        smLife[i] = 1;
      }
    };

    /* ---------- post-processing: MSAA scene -> sanitize -> bloom -> tone-mapped output ---------- */
    // Post-processing bypasses the canvas' built-in antialiasing, so render into a
    // multisampled target to keep edges clean.
    // Lite mode skips the whole chain: four full-screen passes plus bloom's blur
    // pyramid are what weak GPUs choke on.
    const samples = lowPower ? 0 : Math.min(isPhone ? 2 : 4, renderer.capabilities.maxSamples);
    const composer = lite ? null : new EffectComposer(renderer, new THREE.WebGLRenderTarget(size0.w, size0.h, { type: THREE.HalfFloatType, samples }));
    composer?.setSize(size0.w, size0.h);
    composer?.setPixelRatio(dpr);
    composer?.addPass(new RenderPass(scene, camera));
    // Drop NaN pixels and clamp over-bright speculars before bloom, so one bad
    // pixel can never be blurred into a flickering black block.
    const sanitize = new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          // Bit test instead of isnan(): GPU drivers may optimise isnan() away.
          if (any(greaterThanEqual(floatBitsToUint(c) & uvec3(0x7fffffffu), uvec3(0x7f800000u)))) c = vec3(0.0);
          gl_FragColor = vec4(clamp(c, 0.0, 8.0), 1.0);
        }`
    });
    const bloom = composer ? new UnrealBloomPass(new THREE.Vector2(size0.w, size0.h), 0.22, 0.4, 0.95) : null;
    const outputPass = new OutputPass();
    if (composer && bloom) {
      composer.addPass(sanitize);
      composer.addPass(bloom);
      composer.addPass(outputPass);
    }

    /* ---------- interaction ---------- */
    const mouse = { x: 0, y: 0 };
    let downX = 0, downY = 0, moved = false;
    const raycaster = new THREE.Raycaster();

    const onDown = (cx: number, cy: number) => { downX = cx; downY = cy; moved = false; };
    const onMove = (cx: number, cy: number) => {
      if (Math.abs(cx - downX) + Math.abs(cy - downY) > 8) moved = true;
      mouse.x = (cx / window.innerWidth - 0.5) * 2;
      mouse.y = (cy / window.innerHeight - 0.5) * 2;
    };
    const trySelect = (cx: number, cy: number) => {
      if (moved) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // Hidden heroes still exist in the scene graph — only test visible ones.
      const groups = Object.values(records).filter((r) => r.group.visible).map((r) => r.group);
      const hits = raycaster.intersectObjects(groups, true);
      if (hits.length) {
        let obj: THREE.Object3D | null = hits[0].object;
        while (obj && !obj.userData.heroKey) obj = obj.parent;
        if (obj && obj.userData.heroKey) selectRef.current(obj.userData.heroKey as string);
      }
    };

    const md = (e: MouseEvent) => onDown(e.clientX, e.clientY);
    const mm = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const mu = (e: MouseEvent) => trySelect(e.clientX, e.clientY);
    const ts = (e: TouchEvent) => { if (e.touches[0]) onDown(e.touches[0].clientX, e.touches[0].clientY); };
    const tm = (e: TouchEvent) => { if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY); };
    const te = (e: TouchEvent) => { if (e.changedTouches[0]) trySelect(e.changedTouches[0].clientX, e.changedTouches[0].clientY); };

    const el = renderer.domElement;
    el.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    el.addEventListener('mouseup', mu);
    el.addEventListener('touchstart', ts, { passive: true });
    window.addEventListener('touchmove', tm, { passive: true });
    el.addEventListener('touchend', te);

    const onResize = () => {
      if (!mount) return;
      const s = getSize();
      if (s.w < 2 || s.h < 2) return;
      camera.aspect = s.w / s.h;
      camera.updateProjectionMatrix();
      renderer.setSize(s.w, s.h);
      composer?.setSize(s.w, s.h);
      bloom?.setSize(s.w, s.h);
      if (reflector) reflector.getRenderTarget().setSize(Math.floor(s.w * reflectScale), Math.floor(s.h * reflectScale));
    };
    window.addEventListener('resize', onResize);
    // Re-sync when the pane goes from hidden (0x0) to visible.
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    /* ---------- render loop ---------- */
    const clock = new THREE.Clock();
    const camTarget = new THREE.Vector3(0, 2.6, 18);
    const lookNow = new THREE.Vector3(0, 1.7, -1);
    const lookTarget = new THREE.Vector3(0, 1.7, -1);
    let raf = 0;
    let warmFrames = 0;        // frames rendered so far (shaders compile during these)
    let skipOdd = false;
    let perfAcc = 0, perfFrames = 0, headroomWindows = 0, slowWindows = 0;
    // Bloom, the mirror floor and shadow maps are the costly extras. If frames still run long,
    // they are switched off for the rest of the visit before the render scale is touched.
    let effectsOn = !!composer || !!reflector || renderer.shadowMap.enabled;
    const dropEffects = () => {
      effectsOn = false;
      if (reflector) reflector.visible = false;
      const fm = floor.material as THREE.MeshStandardMaterial;
      fm.transparent = false;
      fm.opacity = 1;
      key.castShadow = false;
      renderer.shadowMap.enabled = false;
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => { mm.needsUpdate = true; });
      });
      // Let the stylesheet drop its heavier decoration too.
      const cl = document.documentElement.classList;
      cl.remove('tier-high', 'tier-mid');
      cl.add('tier-low');
    };
    // On portrait screens the roster is squeezed toward the middle so all four leaders stay in frame
    // (1 on landscape / desktop, down to 0.45 on a tall phone).
    const homeSpread = () => THREE.MathUtils.clamp(camera.aspect * 1.0, 0.45, 1);
    const applyDpr = () => {
      renderer.setPixelRatio(dpr);
      composer?.setPixelRatio(dpr);
      onResize();
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      // Skip while the canvas has no drawing buffer (pane hidden) to avoid
      // incomplete-framebuffer errors from the post-processing passes.
      if (!renderer.domElement.width || !renderer.domElement.height) return;
      // Behind the opaque entry screen: render a short warm-up, then idle.
      if ((pausedRef.current || sceneGate.scroll || sceneGate.page || sceneGate.glide) && warmFrames > 45) { clock.getDelta(); perfAcc = perfFrames = 0; return; }
      // Scrolled down into the page content the scene is mostly covered: draw at half rate.
      // Full rate only while a leader is actually on the events stage.
      const onStage = !!stage?.current.key && !!records[stage.current.key];
      const throttled = window.scrollY > window.innerHeight * 0.8 && !onStage;
      if (throttled) {
        skipOdd = !skipOdd;
        if (skipOdd) return;
      }
      const rawDt = clock.getDelta();
      warmFrames++;
      // Report ready only after a warm-up: shaders are compiled and the render scale has settled
      // during these frames, so none of that work is left for the entry screen.
      if (warmFrames === 40) onReadyRef.current?.();
      // Adaptive resolution: step the render scale down quickly when frames run long,
      // and back up only after sustained headroom (each change reallocates targets).
      // While scrolled down only every other frame is drawn, so halve the gap to compare like for like.
      const frameDt = throttled ? rawDt / 2 : rawDt;
      if (!pausedRef.current && warmFrames > 30 && frameDt < 0.25) {
        perfAcc += frameDt;
        perfFrames++;
        if (perfAcc > 1.2) {
          const avg = perfAcc / perfFrames;
          perfAcc = perfFrames = 0;
          slowWindows = avg > 1 / 45 ? slowWindows + 1 : 0;
          // Two slow windows in a row, so a one-off shader-compile stall doesn't trigger it.
          if (slowWindows >= 2 && effectsOn) {
            headroomWindows = 0;
            dropEffects();
          } else if (slowWindows && effectsOn) {
            // wait for the next window before deciding
          } else if (avg > 1 / 45 && dpr > DPR_MIN) {
            dpr = Math.max(DPR_MIN, +(dpr - 0.15).toFixed(2));
            headroomWindows = 0;
            applyDpr();
          } else if (avg > 1 / 40) {
            // Effects already off and at the lowest render scale: never let the scale creep back up into lag.
            dprCap = dpr;
            headroomWindows = 0;
          } else if (avg < 1 / 57 && dpr < dprCap) {
            if (++headroomWindows >= 4) {
              dpr = Math.min(dprCap, +(dpr + 0.1).toFixed(2));
              headroomWindows = 0;
              applyDpr();
            }
          } else {
            headroomWindows = 0;
          }
        }
      } else {
        perfAcc = perfFrames = 0;
      }
      const dt = Math.min(rawDt, 0.05);
      const time = reduceMotion ? 0 : clock.elapsedTime;
      const focus = focusRef.current;

      // First visit to a hero: it arrives as its vehicle, skids to centre stage and transforms.
      const req = introRef.current;
      if (req && req.id !== lastIntroId) {
        lastIntroId = req.id;
        const rec = records[req.key];
        if (rec && !reduceMotion) {
          rec.introStart = clock.elapsedTime;
          rec.introFrom = DRIVE_FROM;
          rec.introTo = 0;
          rec.introCam = true;
          rec.locked = false;
          rec.group.visible = true;
          rec.group.position.set(DRIVE_FROM, GROUND_Y, 0);
          rec.group.rotation.y = Math.PI / 2;
          rec.materials.forEach((m) => { m.opacity = m.userData.base ?? 1; });
          rec.veh.visible = true;
          rec.veh.position.set(0, 0, 0);
          rec.veh.rotation.set(0, 0, 0);
          rec.panels.forEach((p) => {
            p.obj.position.copy(p.p0);
            p.obj.rotation.copy(p.r0);
            p.obj.scale.setScalar(1);
          });
          rec.rig.visible = false;
          applyUnfold(rec, 0);
          introRec = rec;
          camera.position.set(4, 0.2, 13);
          lookNow.set(-18, -1.5, 0);
        }
      }

      // Events stage (scrolling the events section): one leader on the floor, the rest hidden.
      const st = stage?.current;
      const staging = !focus && !!st?.key;
      // Visible half-width of the stage floor (z = 0) at the current camera distance.
      const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.abs(camera.position.z) * camera.aspect;
      if (st && st.introId !== lastStageIntro) {
        lastStageIntro = st.introId;
        const rec = records[st.introKey];
        if (rec && !reduceMotion && !focus) {
          rec.introStart = clock.elapsedTime;
          rec.introFrom = st.fromU * halfW;
          rec.introTo = st.standU * halfW;
          rec.introCam = false;
          rec.locked = false;
          rec.group.visible = true;
          rec.group.position.set(rec.introFrom, GROUND_Y, 0);
          rec.group.rotation.y = Math.sign(rec.introTo - rec.introFrom) * Math.PI / 2;
          rec.materials.forEach((m) => { m.opacity = m.userData.base ?? 1; });
          rec.veh.visible = true;
          rec.veh.position.set(0, 0, 0);
          rec.veh.rotation.set(0, 0, 0);
          rec.panels.forEach((p) => {
            p.obj.position.copy(p.p0);
            p.obj.rotation.copy(p.r0);
            p.obj.scale.setScalar(1);
          });
          rec.rig.visible = false;
          applyUnfold(rec, 0);
          introRec = rec;
        }
      }

      // Theme tint: the gate, backlight, sky glow and warm beams take on the inspected hero's colour.
      accentTarget.set(focus ? heroByKey(focus)!.colors.glow : DEFAULT_ACCENT);
      accentNow.lerp(accentTarget, 0.04);
      gateMat.color.copy(accentNow).multiplyScalar(1.6);
      gateGlowMat.color.copy(accentNow).multiplyScalar(0.32);
      gateLight.color.copy(accentNow);
      skyMat.uniforms.uGlow.value.copy(accentNow).multiplyScalar(0.28);
      skyMat.uniforms.uTime.value = time;
      beams.forEach((b) => {
        if (b.warm) b.mat.uniforms.uColor.value.copy(accentNow);
        b.mesh.rotation.z = b.tilt + Math.sin(time * 0.25 + b.phase) * 0.22;
      });
      segs.rotation.z += reduceMotion ? 0 : dt * 0.06;
      beaconMat.opacity = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(time * 2.4), 6);

      HEROES.forEach((hero) => {
        const rec = records[hero.key];
        const focused = focus === hero.key;
        const staged = staging && st!.key === hero.key;
        // Just lost the stage but still on screen: keep it visible while it walks off the edge.
        const leaving = staging && !staged && st!.leaveKey === hero.key && rec.group.visible
          && Math.abs(rec.group.position.x) < halfW * 1.15;
        const hidden = (!!focus && !focused) || (staging && !staged && !leaving);

        // Fade + fully remove the non-inspected heroes so they never overlap the subject.
        const targetOpacity = hidden ? 0 : 1;
        rec.materials.forEach((m) => { m.opacity += (targetOpacity * (m.userData.base ?? 1) - m.opacity) * 0.14; });
        if (hidden) {
          if (rec.materials[0].opacity < 0.04) rec.group.visible = false;
        } else {
          rec.group.visible = true;
        }

        // Leaving a hero mid-transform (e.g. tapping Home right after opening it): stop the
        // intro at once and snap the rig to its finished pose so it eases straight back home.
        if (!focused && !staged && rec.introStart >= 0) {
          applyUnfold(rec, 1);
          rec.panels.forEach((p) => { p.obj.position.copy(p.p0); p.obj.rotation.copy(p.r0); p.obj.scale.setScalar(1); });
          rec.rig.visible = true;   // aborting during drive-in: show the robot body (the car never finished transforming)
          rec.veh.visible = false;
          rec.ring.scale.setScalar(1);
          rec.introStart = -1;
          if (introRec === rec) introRec = null;
          headBeam.intensity = 0;
        }

        // Inspected hero walks to centre stage on the floor; the rest hold their roster marks.
        const g = rec.group;
        const ease = focused ? 0.1 : staged ? 0.09 : 0.14;
        const tx = focused ? 0 : staged ? st!.u * halfW : hero.layout.x * homeSpread();
        const prevX = g.position.x;
        // Joining the events stage: start right at the target (an off-screen edge), not from home.
        if (staged && !rec.wasStaged && rec.introStart < 0) {
          g.position.set(st!.enterU * halfW, GROUND_Y, 0);
          g.rotation.y = Math.sign(st!.u - st!.enterU) * Math.PI / 2;
        }
        rec.wasStaged = staged;
        if (leaving) {
          // Walk (briskly) to the edge it was headed for; it hides once fully off screen.
          rec.stageHidden = true;
          g.position.x += (st!.leaveU * halfW - g.position.x) * 0.11;
          g.position.y += (GROUND_Y - g.position.y) * 0.11;
          g.position.z += (0 - g.position.z) * 0.11;
        } else if (staging && !staged) {
          // Off stage while the events stage runs: stays hidden where it is.
          rec.stageHidden = true;
        } else if (!staging && rec.stageHidden) {
          // Stage over (back on the main page): it is invisible right now, so drop it straight home.
          rec.stageHidden = false;
          g.position.set(hero.layout.x * homeSpread(), rec.baseY, hero.layout.z);
        } else {
          g.position.x += (tx - g.position.x) * ease;
          g.position.z += ((focused || staged ? 0 : hero.layout.z) - g.position.z) * ease;
          g.position.y += ((focused || staged ? GROUND_Y : rec.baseY) - g.position.y) * ease;
        }

        if (staged) st!.settled = rec.introStart < 0 && Math.abs(g.position.x - st!.u * halfW) < halfW * 0.04;

        if ((staged || leaving) && rec.introStart < 0) {
          // On the events stage: face the way it travels while crossing, then turn to the camera.
          const vx = (g.position.x - prevX) / Math.max(dt, 1e-4);
          const want = Math.abs(vx) > 1.2 ? Math.sign(vx) * Math.PI / 2 : Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z) * 0.6;
          const wrapped = Math.atan2(Math.sin(g.rotation.y), Math.cos(g.rotation.y));
          g.rotation.y = wrapped + (want - wrapped) * 0.12;
        } else if (focused) {
          if (rec.introStart < 0) g.rotation.y += reduceMotion ? 0 : dt * 0.22;   // slow turntable
        } else {
          const wrapped = Math.atan2(Math.sin(g.rotation.y), Math.cos(g.rotation.y));
          const faceCam = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
          g.rotation.y = wrapped + (faceCam * 0.55 + Math.sin(time * 0.3 + rec.phase) * 0.06 - wrapped) * 0.05;
        }
        // Idle "action" pose (per event) whenever the robot is standing, not mid-transform.
        if (rec.introStart < 0 && !reduceMotion) applyAction(rec, hero, time, focused);
        else resetAction(rec);
        rec.head.rotation.y += (mouse.x * 0.35 + rec.act.headYaw - rec.head.rotation.y) * 0.08;
        rec.head.rotation.x += (mouse.y * 0.15 + rec.act.headPitch - rec.head.rotation.x) * 0.08;

        let power = 1;
        if (rec.introStart >= 0) {
          const t = clock.elapsedTime - rec.introStart;
          const sc = hero.layout.scale * 0.8;
          if (t < TF_START) {
            // Drive in: hard braking into a sideways skid that ends nose-to-camera.
            const u = Math.min(t / DRIVE, 1);
            const prevX = g.position.x;
            g.position.set(rec.introTo + (rec.introFrom - rec.introTo) * Math.pow(1 - u, 3), GROUND_Y, 0);
            g.rotation.y = Math.sign(rec.introTo - rec.introFrom) * (Math.PI / 2) * (1 - easeIO(t, DRIVE - 0.7, TF_START));
            const speed = Math.abs(g.position.x - prevX) / Math.max(dt, 1e-4) / sc;
            rec.wheels.forEach((w) => { w.obj.rotation.x += (speed * dt) / w.r; });
            const brake = Math.sin(Math.PI * THREE.MathUtils.clamp((t - (DRIVE - 0.8)) / 1.1, 0, 1));
            rec.veh.rotation.x = 0.07 * brake;     // nose dives under braking
            rec.veh.rotation.z = -0.05 * brake;    // body roll through the skid
            rec.veh.position.y = rec.vehicle === 'tank' ? 0.25 + Math.sin(t * 7) * 0.05 : 0;
            if (rec.vehicle === 'tank') emitSmoke(rec, 1);
            else if (t > DRIVE - 0.75 && t < DRIVE + 0.15) emitSmoke(rec, 3);
            // Panels shiver as they unlatch, just before breaking away.
            if (t > TF_START - 0.25) {
              rec.panels.forEach((p) => {
                p.obj.position.set(p.p0.x + (Math.random() - 0.5) * 0.04, p.p0.y + (Math.random() - 0.5) * 0.04, p.p0.z);
              });
            }
            g.updateMatrixWorld();
            headBeam.position.set(0, 1.1, 3.4);
            g.localToWorld(headBeam.position);
            headBeam.target.position.set(0, -0.5, 14);
            g.localToWorld(headBeam.target.position);
            headBeam.color.set(0xfff1d6);
            headBeam.intensity = 260;
          } else {
            // Transform: armour panels peel off along arcs onto the robot while it unfolds and stands.
            g.position.set(rec.introTo, GROUND_Y, 0);
            g.rotation.y = 0;
            rec.veh.rotation.set(0, 0, 0);
            rec.veh.position.y = 0;
            rec.rig.visible = true;
            headBeam.intensity *= 0.85;
            const tt = t - TF_START;
            applyUnfold(rec, Math.min(tt / TF, 1));
            rec.panels.forEach((p) => {
              const u = THREE.MathUtils.clamp((tt - p.delay) / 0.75, 0, 1);
              const e = easeIO(u, 0, 1);
              const a = 1 - e;
              // Quadratic Bézier arc from the vehicle pose to the matching robot armour.
              p.obj.position.set(
                a * a * p.p0.x + 2 * a * e * p.mid.x + e * e * p.target.x,
                a * a * p.p0.y + 2 * a * e * p.mid.y + e * e * p.target.y,
                a * a * p.p0.z + 2 * a * e * p.mid.z + e * e * p.target.z
              );
              p.obj.rotation.set(p.r0.x + p.spin.x * e, p.r0.y + p.spin.y * e, p.r0.z + p.spin.z * e);
              p.obj.scale.setScalar(u < 0.7 ? 1 : Math.max(0.001, 1 - (u - 0.7) / 0.3));
            });
            if (t >= INTRO_LOCK && !rec.locked) {
              rec.locked = true;
              rec.veh.visible = false;
              burst(new THREE.Vector3(rec.introTo, GROUND_Y + 4.3 * sc, 0.4), hero.colors.glow);
            }
            const rt = t - INTRO_LOCK;
            rec.ring.scale.setScalar(rt > 0 && rt < 0.8 ? 1 + rt * 5 : 1);
            // Optics stay dim while transforming, then flicker on at lock-in.
            power = t < INTRO_LOCK ? 0.15 : t < INTRO_LOCK + 0.35 ? (Math.random() > 0.45 ? 1.6 : 0.2) : 1;
            if (t > INTRO_END) {
              applyUnfold(rec, 1);
              rec.panels.forEach((p) => {
                p.obj.position.copy(p.p0);
                p.obj.rotation.copy(p.r0);
                p.obj.scale.setScalar(1);
              });
              rec.veh.visible = false;
              rec.ring.scale.setScalar(1);
              rec.introStart = -1;
              if (introRec === rec) introRec = null;
              headBeam.intensity = 0;
            }
          }
        }
        const pulse = power * (focused ? 1.25 : 1) * (0.88 + 0.12 * Math.sin(time * 2.5 + rec.phase));
        rec.emissives.forEach((m) => { m.emissiveIntensity = m.userData.emi * pulse; });
        // Ambulance light bar strobes while it drives in.
        if (rec.siren && rec.introStart >= 0 && clock.elapsedTime - rec.introStart < TF_START) {
          const on = Math.sin(clock.elapsedTime * 16) > 0;
          rec.siren[0].emissiveIntensity = on ? 5 : 0.3;
          rec.siren[1].emissiveIntensity = on ? 0.3 : 5;
        }
      });

      if (introRec && introRec.introCam) {
        // Intro camera: tracks the vehicle in low, then rises and pushes in as the robot stands.
        const it = clock.elapsedTime - introRec.introStart;
        const gp = introRec.group.position;
        if (it < TF_START) {
          camTarget.set(gp.x * 0.3 + 3.5, 0.3, 12.5);
          lookTarget.set(gp.x * 0.85, -1.2, 0);
        } else {
          const k = easeIO(it, TF_START, INTRO_LOCK);
          camTarget.set(3.5 - 3.5 * k + mouse.x * 0.3, 0.3 + 2.1 * k, 12.5 + 1.5 * k);
          lookTarget.set(0, -1.2 + 3.1 * k, 0);
        }
      } else if (!focus) {
        // Sideways drift is kept small so the gate ring stays centred behind the hero wordmark;
        // tall phone screens only see a narrow slice of the stage, so pull the camera back (see homeSpread).
        camTarget.set(mouse.x * 0.25 + Math.sin(time * 0.08) * 0.1, 2.6 + mouse.y * 0.5, 18 + (1 - homeSpread()) * 20);
        // ...and aim higher so the roster sits lower, clear of the title and countdown card.
        lookTarget.set(0, 1.7 + (1 - homeSpread()) * 5, -1);
      } else {
        // Fixed centre-stage framing for whichever hero is inspected.
        camTarget.set(mouse.x * 0.8, 2.4 + mouse.y * 0.4, 14);
        lookTarget.set(0, 1.9, 0);
      }
      // Frame-rate independent easing, so the camera keeps up on slow devices too.
      const camK = 1 - Math.exp(-(introRec && introRec.introCam ? 5.7 : 3.1) * Math.min(rawDt, 0.5));
      camera.position.lerp(camTarget, camK);
      lookNow.lerp(lookTarget, camK);
      if (shakeT >= 0) {
        shakeT += dt;
        const a = Math.max(0, 0.18 * (1 - shakeT / 0.45));
        camera.position.x += (Math.random() - 0.5) * a;
        camera.position.y += (Math.random() - 0.5) * a;
        if (shakeT > 0.45) shakeT = -1;
      }
      camera.lookAt(lookNow);

      // Floor stands fill the free space between each screen edge and whichever is nearer:
      // the countdown (a fixed 672px-wide block) or the legs of the side robots. They
      // scale with the viewport so they never overlap either. The 1.15 factor covers
      // the extra projected width of the angled board.
      const showStands = !focus && !introRec && !staging && standMQ.matches;
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
      const halfPx = (mount.clientWidth || window.innerWidth) / 2;
      const legNdc = Math.max(...['megatron', 'bumblebee'].map((k) => {
        const L = heroByKey(k)!.layout;
        return (Math.abs(L.x) + 1.1 * L.scale * 0.8) / ((18 - L.z) * tanH);
      }));
      const outerNdc = 1 - 18 / halfPx;
      const innerNdc = Math.max((336 + 46) / halfPx, legNdc + 24 / halfPx);
      const freeNdc = Math.max(0, outerNdc - innerNdc);
      const centreNdc = (outerNdc + innerNdc) / 2;
      const standScale = THREE.MathUtils.clamp(freeNdc / (1.15 * STAND_W / (STAND_DEPTH * tanH)), 0.3, 1.35);
      stands.forEach(({ grp, side }) => {
        grp.visible = showStands;
        if (!showStands) return;
        grp.scale.setScalar(standScale);
        grp.position.x = side * centreNdc * tanH * STAND_DEPTH;
        grp.position.z = 18 - STAND_DEPTH;
        grp.lookAt(grp.position.x * 0.55, GROUND_Y, 18);
      });

      if (sparkT >= 0) {
        sparkT += dt;
        for (let i = 0; i < SPARKS; i++) {
          sVel[i * 3 + 1] -= 9.8 * dt;
          sPos[i * 3] += sVel[i * 3] * dt;
          sPos[i * 3 + 1] += sVel[i * 3 + 1] * dt;
          sPos[i * 3 + 2] += sVel[i * 3 + 2] * dt;
          if (sPos[i * 3 + 1] < GROUND_Y) {
            sPos[i * 3 + 1] = GROUND_Y;
            sVel[i * 3 + 1] *= -0.35;
            sVel[i * 3] *= 0.7;
            sVel[i * 3 + 2] *= 0.7;
          }
        }
        sGeo.attributes.position.needsUpdate = true;
        sMat.opacity = Math.max(0, 1 - sparkT / 1.4);
        if (sparkT > 1.4) sparkT = -1;
      }
      flash.intensity *= 0.9;
      if (bloom) bloom.strength = 0.55 + Math.min(flash.intensity / 900, 1) * 0.9;

      // Sky life: drifting cloud banks and mist, crossing air traffic with strobes.
      if (!reduceMotion) {
        cloudLayers.forEach((tx, i) => { tx.offset.x += dt * 0.0015 * (i % 2 ? 1 : -1); });
        mistLayers.forEach((tx, i) => { tx.offset.x += dt * 0.004 * (i + 1); tx.offset.y += dt * 0.002; });
      }
      craft.forEach((c, i) => {
        const u = (((c.phase + time * c.speed) % 1) + 1) % 1;
        const x = -130 + u * 260;
        cPos.set([x, c.y, c.z, x + 1.4, c.y - 0.1, c.z], i * 6);
        const strobe = Math.pow(Math.max(0, Math.sin(time * 5 + i * 1.3)), 18);
        cCol.set([strobe, strobe, strobe, 1.0, 0.15, 0.1], i * 6);
      });
      cGeo.attributes.position.needsUpdate = true;
      cGeo.attributes.color.needsUpdate = true;

      // A couple of neon billboards buzz and flicker.
      boards.forEach((m, i) => {
        if (i % 3 === 1 && Math.random() < 0.015) m.color.setScalar(0.22);
        else m.color.lerp(boardBright, 0.2);
      });
      // Tyre smoke drifts, spreads and fades.
      for (let i = 0; i < SMOKE; i++) {
        if (smLife[i] <= 0) {
          smCol[i * 3] = smCol[i * 3 + 1] = smCol[i * 3 + 2] = 0;
          continue;
        }
        smLife[i] -= dt * 0.8;
        smPos[i * 3] += smVel[i * 3] * dt;
        smPos[i * 3 + 1] += smVel[i * 3 + 1] * dt;
        smPos[i * 3 + 2] += smVel[i * 3 + 2] * dt;
        smVel[i * 3] *= 0.97;
        smVel[i * 3 + 2] *= 0.97;
        const c = Math.max(0, smLife[i]) * 0.22;
        smCol[i * 3] = c;
        smCol[i * 3 + 1] = c * 1.02;
        smCol[i * 3 + 2] = c * 1.08;
      }
      smGeo.attributes.position.needsUpdate = true;
      smGeo.attributes.color.needsUpdate = true;

      if (!reduceMotion) {
        const arr = eGeo.attributes.position.array as Float32Array;
        for (let i = 0; i < EMBERS; i++) {
          arr[i * 3 + 1] += eVel[i] * dt;
          arr[i * 3] += Math.sin(time * 0.6 + i) * 0.004;
          if (arr[i * 3 + 1] > GROUND_Y + 16) {
            arr[i * 3 + 1] = GROUND_Y;
            arr[i * 3] = (Math.random() - 0.5) * 44;
          }
        }
        eGeo.attributes.position.needsUpdate = true;
      }

      if (composer && effectsOn) {
        renderer.shadowMap.needsUpdate = true;
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();

    /* ---------- cleanup ---------- */
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('mousedown', md);
      window.removeEventListener('mousemove', mm);
      el.removeEventListener('mouseup', mu);
      el.removeEventListener('touchstart', ts);
      window.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      window.removeEventListener('resize', onResize);
      ro.disconnect();

      reflector?.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((m) => m.dispose());
        }
      });
      textures.forEach((t) => t.dispose());
      composer?.dispose();
      bloom?.dispose();
      outputPass.dispose();
      sanitize.dispose();
      envDisposed = true;
      pmrem.dispose();
      envRT.dispose();
      renderer.dispose();
      if (mount && renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} className="fixed inset-0 z-0" />;
};

/* ============================ MOTION ============================== */
// Fest palette combination: red, yellow, purple, Ratchet-cyan — spread across repeated UI
// groups (countdown, stat tiles, entry motes) so the site reads multi-colour, not all-yellow.
const QUAD = [
  { text: 'text-rose-400',    border: 'border-rose-500/50',    glow: 'shadow-[0_0_26px_rgba(244,63,94,0.22)]',  dot: '#fb7185' },   // red
  { text: 'text-amber-400',   border: 'border-amber-500/50',   glow: 'shadow-[0_0_26px_rgba(250,204,21,0.22)]', dot: '#fbbf24' },   // yellow
  { text: 'text-fuchsia-400', border: 'border-fuchsia-500/50', glow: 'shadow-[0_0_26px_rgba(217,70,239,0.22)]', dot: '#e879f9' },   // purple
  { text: 'text-cyan-400',    border: 'border-cyan-500/50',    glow: 'shadow-[0_0_26px_rgba(34,211,238,0.22)]', dot: '#22d3ee' }    // cyan
];

// Cards sit on a neutral border; their theme border and glow only light up on hover.
const onHover = (cls: string) => cls.split(' ').map((c) => `hover:${c}`).join(' ');

const GATE_MOTES = Array.from({ length: 26 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
  return { left: r(1) * 100, size: 1.5 + r(2) * 2.5, dur: 9 + r(3) * 10, delay: -r(4) * 18, color: QUAD[Math.floor(r(5) * 4) % 4].dot };
});

const MOTION_CSS = `
@keyframes heroIn { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
.hero-in { animation: heroIn .8s cubic-bezier(.2,.8,.2,1) both; }
@keyframes hudIn {
  0% { opacity: 0; transform: translateY(16px) scale(.97); }
  12% { opacity: 1; transform: none; }
  85% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateY(-8px); }
}
.hud-in { animation: hudIn 4.4s ease both; }
@keyframes hudBar { from { width: 0%; } to { width: 100%; } }
.hud-bar { animation: hudBar 3.5s cubic-bezier(.4,0,.2,1) both; }
@keyframes hudFlash { 0%, 76% { opacity: 0; } 80% { opacity: 1; } 100% { opacity: 0; } }
.hud-flash { animation: hudFlash 4.4s ease-out both; }

/* On landscape screens these panels live in the 3D scene as floor stands instead. */
@media (min-width: 768px) and (min-aspect-ratio: 6/5) { .hud-flat { display: none !important; } }
.kpr-bold { filter: drop-shadow(0 2px 3px rgba(0,0,0,0.9)) drop-shadow(0 0 16px rgba(2,6,23,0.85)); }

/* HUD panels slide/fade in and a thin scan-line travels down them. */
@keyframes hudPanelIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.hud-panel-in { animation: hudPanelIn .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes hudScan { 0% { transform: translateY(-100%); opacity: 0; } 12% { opacity: .8; } 88% { opacity: .8; } 100% { transform: translateY(1100%); opacity: 0; } }
.hud-scan { animation: hudScan 4.5s linear infinite; }

/* ---------- Entry screen: midnight stage, perspective grid, light beams, motes ---------- */
.gate-bg {
  background:
    radial-gradient(ellipse 60% 48% at 50% 40%, rgba(37,99,235,.22), transparent 70%),
    radial-gradient(ellipse 90% 60% at 50% 105%, rgba(250,204,21,.08), transparent 62%),
    linear-gradient(180deg, #01030a 0%, #040a1c 52%, #01030a 100%);
}
.gate-grid {
  position: absolute; left: -40%; right: -40%; bottom: 0; height: 46%; overflow: hidden;
  transform: perspective(480px) rotateX(64deg); transform-origin: 50% 100%;
  -webkit-mask-image: linear-gradient(to top, #000 0%, rgba(0,0,0,.55) 45%, transparent 92%);
          mask-image: linear-gradient(to top, #000 0%, rgba(0,0,0,.55) 45%, transparent 92%);
}
.gate-grid::before {
  content: ''; position: absolute; left: 0; right: 0; top: -72px; bottom: 0;
  background-image:
    linear-gradient(rgba(96,165,250,.20) 1px, transparent 1px),
    linear-gradient(90deg, rgba(96,165,250,.20) 1px, transparent 1px);
  background-size: 72px 72px;
  animation: gateGrid 7s linear infinite; will-change: transform;
}
@keyframes gateGrid { to { transform: translateY(72px); } }
.gate-beam {
  position: absolute; top: -25%; width: 34vw; height: 130%;
  background: linear-gradient(180deg, rgba(147,197,253,.13), rgba(147,197,253,0) 72%);
  transform-origin: 50% 0; animation: gateBeam 11s ease-in-out infinite alternate;
}
@keyframes gateBeam { from { transform: rotate(var(--r0)); } to { transform: rotate(var(--r1)); } }
.gate-mote {
  position: absolute; bottom: -12px; border-radius: 9999px;
  animation: gateMote linear infinite; will-change: transform, opacity;
}
@keyframes gateMote {
  0% { transform: translateY(0); opacity: 0; }
  12% { opacity: .9; }
  80% { opacity: .5; }
  100% { transform: translateY(-78vh); opacity: 0; }
}

/* Emblem: cool rim halo, slow HUD rings and a metallic light sweep masked to the logo. */
.gate-halo { background: radial-gradient(circle, rgba(96,165,250,.30) 0%, rgba(30,64,175,.12) 42%, transparent 68%); }
.gate-ring { animation: gateSpin 40s linear infinite; }
.gate-ring-rev { animation: gateSpin 60s linear infinite reverse; }
@keyframes gateSpin { to { transform: rotate(360deg); } }
.gate-logo {
  filter: drop-shadow(0 0 1px rgba(226,232,240,.55)) drop-shadow(0 0 14px rgba(148,197,255,.25)) drop-shadow(0 22px 30px rgba(0,0,0,.85)) brightness(1.12) contrast(1.08);
}
.gate-sheen {
  overflow: hidden;
  -webkit-mask: url(${BASE}assets/logo-hd.webp) center / contain no-repeat;
          mask: url(${BASE}assets/logo-hd.webp) center / contain no-repeat;
}
/* The light band slides with transform (compositor only) instead of repainting background-position. */
.gate-sheen::before {
  content: ''; position: absolute; top: 0; bottom: 0; left: -100%; width: 100%;
  background: linear-gradient(105deg, transparent 20%, rgba(255,255,255,.62) 50%, transparent 80%);
  animation: gateSheen 6s ease-in-out 1s infinite; will-change: transform;
}
@keyframes gateSheen { 0% { transform: translateX(0); } 28%, 100% { transform: translateX(200%); } }

/* Brand type: brushed-silver OPTIMUS, Transformers-yellow '27 (shared with the home hero). */
.metal-text {
  background: linear-gradient(180deg, #ffffff 0%, #eef2f7 38%, #9aa6b8 52%, #e2e8f0 70%, #ffffff 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 rgba(0,0,0,.55)) drop-shadow(0 0 22px rgba(148,197,255,.18));
}
.gold-text {
  background: linear-gradient(180deg, #fff8c4 0%, #fde047 34%, #facc15 56%, #f59e0b 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 2px 0 rgba(0,0,0,.55)) drop-shadow(0 0 20px rgba(250,204,21,.35));
}

/* ENTER = the insignia itself: lifts and brightens on hover, clear focus ring. */
.gate-emblem { transition: transform .25s ease, filter .25s ease; border-radius: 9999px; }
.gate-emblem:hover { transform: scale(1.06); filter: brightness(1.15); }
.gate-emblem:active { transform: scale(.97); }
.gate-emblem:focus-visible { outline: 3px solid #e0f2fe; outline-offset: 10px; }
.gate-emblem:hover .gate-halo { opacity: 1; }
.gate-halo { opacity: .8; transition: opacity .25s ease; }

/* Staggered reveal of the entry content. */
@keyframes gateRise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
.gate-rise { animation: gateRise .8s cubic-bezier(.2,.8,.2,1) both; }
@keyframes emblemIn { from { opacity: 0; transform: scale(.9); filter: brightness(1.5) blur(4px); } to { opacity: 1; transform: none; filter: none; } }
.emblem-in { animation: emblemIn .6s cubic-bezier(.2,.8,.2,1) both; }
/* Hold every reveal at its first frame until the insignia is decoded, so logo and title start together. */
.gate-hold .gate-rise, .gate-hold .emblem-in { animation-play-state: paused; }

/* ENTER sequence (~2.3s, transform + opacity only so it stays on the compositor):
   text fades; the insignia flies to centre and grows broad; it dissolves into a large
   OPTIMUS '27 title; the title swells and fades as the backdrop opens onto the site. */
.gate-leave { pointer-events: none; }
@keyframes gateFadeOut { to { opacity: 0; transform: translateY(-10px); } }
.gate-leave .gate-fade { animation: gateFadeOut .3s ease forwards !important; }
@keyframes gateFadeQuick { to { opacity: 0; } }
/* the insignia + its rings just fade out — the OPTIMUS '27 title is the hero of the transition */
.gate-leave .gate-emblem, .gate-leave .gate-halo, .gate-leave .gate-ring, .gate-leave .gate-ring-rev, .gate-leave .gate-sheen {
  animation: gateFadeQuick .3s ease forwards !important;
}
/* OPTIMUS '27 flies in and lands on the home hero title (driven by JS FLIP in enterSite). */
.gate-title-burst .opt-word { will-change: transform, opacity; }
@keyframes gateBgOut { to { opacity: 0; } }
/* backdrop holds dark through the ~1s title stand, then fades as the title flies to its slot */
.gate-leave .gate-stage { animation: gateBgOut .9s ease 1.4s forwards; }
/* Hero fades in by opacity only (no scale) so its title holds still for the landing. */
@keyframes sceneIn { from { opacity: 0; } to { opacity: 1; } }
.scene-in { animation: sceneIn .7s ease .1s both; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
.fade-in { animation: fadeIn .7s ease .25s both; }

/* ---------- Prize-pool section (transparent: the 3D robot scene shows through) ---------- */
.prize-sec { background: #03050b; }
/* Prize vault backdrop */
/* Pass deck: Cybertronian access keys. Laptops+: one overlapping row, the active key rises out
   of the deck while the rest sit tilted back and dimmed. Below lg: a plain grid. */
.cert-grid { opacity: .9;
  background-image:
    linear-gradient(rgba(34,211,238,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,.07) 1px, transparent 1px),
    linear-gradient(rgba(34,211,238,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,.035) 1px, transparent 1px);
  background-size: 96px 96px, 96px 96px, 24px 24px, 24px 24px;
  -webkit-mask-image: radial-gradient(ellipse 70% 65% at 50% 45%, #000 30%, transparent 80%); mask-image: radial-gradient(ellipse 70% 65% at 50% 45%, #000 30%, transparent 80%); }
.cert-beam { transform: translateX(-50%); clip-path: polygon(44% 100%, 56% 100%, 92% 0, 8% 0);
  background: linear-gradient(0deg, rgba(34,211,238,.20), rgba(34,211,238,.06) 55%, transparent); }
/* The certificate sheet: notched 1px cyan-to-gold border (outer layer) around a dark glass plate */
.cert-plate { padding: 1px; clip-path: polygon(26px 0, calc(100% - 26px) 0, 100% 26px, 100% calc(100% - 26px), calc(100% - 26px) 100%, 26px 100%, 0 calc(100% - 26px), 0 26px);
  background: linear-gradient(135deg, rgba(34,211,238,.85), rgba(250,204,21,.55) 50%, rgba(34,211,238,.85));
  transform-origin: 50% 50%; animation: certUnfold 1.05s cubic-bezier(.65,0,.25,1) both; }
.cert-plate-in { clip-path: polygon(25px 0, calc(100% - 25px) 0, 100% 25px, 100% calc(100% - 25px), calc(100% - 25px) 100%, 25px 100%, 0 calc(100% - 25px), 0 25px);
  background:
    radial-gradient(ellipse 70% 55% at 50% 30%, rgba(34,211,238,.10), transparent 70%),
    linear-gradient(180deg, rgba(8,20,40,.94), rgba(3,8,20,.96)); }
.cert-plate-in::before { content: ''; position: absolute; inset: 22px; border: 1px dashed rgba(34,211,238,.28); pointer-events: none; }
/* Unfold: a bright line opens out from the centre, then the sheet opens up and down */
@keyframes certUnfold {
  0% { transform: scale(.02, .006); opacity: 0; filter: brightness(2.2); }
  12% { opacity: 1; }
  48% { transform: scale(1, .006); filter: brightness(2.2); }
  100% { transform: scale(1, 1); filter: brightness(1); }
}
.cert-in { animation: certIn .6s cubic-bezier(.2,.8,.2,1) both; }
@keyframes certIn { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.cert-scan { position: absolute; left: 0; right: 0; top: 0; height: 22%; pointer-events: none;
  background: linear-gradient(180deg, transparent, rgba(34,211,238,.05) 70%, rgba(165,243,252,.16) 100%);
  border-bottom: 1px solid rgba(165,243,252,.3); animation: certScan 5s cubic-bezier(.45,0,.55,1) 1.2s infinite both; will-change: transform; }
@keyframes certScan { 0% { transform: translateY(-100%); opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { transform: translateY(460%); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .cert-plate, .cert-in, .cert-scan { animation: none; } }
.cert-corner::after { content: ''; position: absolute; inset: 7px; border: inherit; border-color: rgba(34,211,238,.18); }
.pass-deck { display: grid; grid-template-columns: 1fr; gap: 1.25rem; }
@media (min-width: 768px) { .pass-deck { grid-template-columns: 1fr 1fr; } }
.pass-card { --c: #f5c518; position: relative; min-width: 0; cursor: pointer; padding: 1px;
  background: linear-gradient(160deg, var(--c), color-mix(in srgb, var(--c) 18%, transparent) 45%, color-mix(in srgb, var(--c) 45%, transparent));
  clip-path: polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 22px 100%, 0 calc(100% - 22px));
  transition: transform .45s cubic-bezier(.2,.8,.2,1), filter .35s ease; }
.pass-in { position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden;
  background: linear-gradient(180deg, rgba(13,19,34,.97), rgba(3,7,16,.98));
  clip-path: polygon(0 0, calc(100% - 21px) 0, 100% 21px, 100% 100%, 21px 100%, 0 calc(100% - 21px)); }
.pass-in::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse 70% 50% at 85% 100%, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%); }
.pass-head { display: flex; align-items: center; gap: .75rem; padding: .9rem 1.4rem; overflow: hidden;
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%);
  border-bottom: 1px solid color-mix(in srgb, var(--c) 30%, transparent); }
.pass-hatch { width: 54px; height: 11px; flex-shrink: 0;
  background: repeating-linear-gradient(115deg, var(--c) 0 3px, transparent 3px 7px); opacity: .9; }
.pass-num { position: absolute; right: 1.1rem; bottom: .2rem; font-size: 6.5rem; line-height: 1; font-weight: 900;
  color: transparent; -webkit-text-stroke: 1.2px color-mix(in srgb, var(--c) 55%, transparent); letter-spacing: -.04em; pointer-events: none; }
.pass-book { position: relative; z-index: 1; }
.pass-card:hover .pass-book { text-decoration: underline; text-underline-offset: 5px; }
@media (min-width: 1024px) {
  .pass-deck { display: flex; justify-content: center; align-items: center; perspective: 1400px; min-height: 34rem; }
  .pass-card { flex: 0 0 min(25.5rem, 33vw); filter: brightness(.62) saturate(.8);
    transform: translateY(14px) rotateY(-9deg) scale(.93); }
  .pass-card + .pass-card { margin-left: -9.5rem; }
  .pass-card.pass-on { filter: none; transform: translateY(-14px) rotateY(0) scale(1.03); }
  .pass-card.pass-on ~ .pass-card { transform: translateY(14px) rotateY(9deg) scale(.93); }
  .pass-deck.is-rest .pass-card { filter: none; transform: none; }
}
@media (prefers-reduced-motion: reduce) { .pass-card { transition: none; } }
.pv-vault-wrap { -webkit-mask-image: linear-gradient(180deg, #000 0, #000 15rem, transparent 25rem); mask-image: linear-gradient(180deg, #000 0, #000 15rem, transparent 25rem); }
@media (min-width: 640px) { .pv-vault-wrap { -webkit-mask-image: linear-gradient(180deg, #000 0, #000 18rem, transparent 29rem); mask-image: linear-gradient(180deg, #000 0, #000 18rem, transparent 29rem); } }
.pv-vault { transform: translate(-50%, -50%); animation: pvTurn 90s linear infinite; will-change: transform; }
.pv-vault-in { animation-duration: 60s; animation-direction: reverse; }
@keyframes pvTurn { from { transform: translate(-50%, -50%) rotate(0deg); } to { transform: translate(-50%, -50%) rotate(360deg); } }
.pv-beam { background: linear-gradient(0deg, rgba(250,204,21,.16), rgba(250,204,21,.04) 55%, transparent);
  clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%); }
.pv-beam-r { background: linear-gradient(0deg, rgba(34,211,238,.14), rgba(34,211,238,.03) 55%, transparent); }
.pv-floor { background:
    linear-gradient(0deg, rgba(250,204,21,.10), transparent 70%),
    repeating-linear-gradient(90deg, rgba(250,204,21,.10) 0 1px, transparent 1px 70px),
    repeating-linear-gradient(0deg, rgba(250,204,21,.08) 0 1px, transparent 1px 42px);
  transform: perspective(500px) rotateX(58deg); transform-origin: bottom center;
  -webkit-mask-image: linear-gradient(0deg, #000 30%, transparent); mask-image: linear-gradient(0deg, #000 30%, transparent); }
.tf-hex-fade { -webkit-mask-image: linear-gradient(180deg, #000 60%, transparent); mask-image: linear-gradient(180deg, #000 60%, transparent); }
/* Energon conduit: a thin gold line with two bright pulses travelling down it (transform-only) */
.pv-conduit { width: 2px; transform: translateX(-50%); overflow: hidden;
  background: linear-gradient(180deg, rgba(250,204,21,.05), rgba(250,204,21,.55) 50%, rgba(250,204,21,.05)); box-shadow: 0 0 12px rgba(250,204,21,.35); }
.pv-conduit i { position: absolute; left: -2px; width: 6px; height: 34px; top: -34px; border-radius: 6px;
  background: linear-gradient(180deg, transparent, #fff6b8, #facc15, transparent); filter: drop-shadow(0 0 6px rgba(250,204,21,.9));
  animation: pvPulse 1.6s cubic-bezier(.5,0,.5,1) infinite; will-change: transform; }
.pv-conduit i + i { animation-delay: .8s; }
@keyframes pvPulse { from { transform: translateY(0); } to { transform: translateY(calc(6rem + 68px)); } }
.pv-glyphs {
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 22rem); mask-image: linear-gradient(180deg, transparent, #000 22rem);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120' fill='none' stroke='%23facc15' stroke-width='1.2'%3E%3Cpath d='M10 10h18v8H18v10M50 12h20M60 12v16M90 10l10 10-10 10M14 60h14l6 6v12M54 56h12v12H54zM92 60h16M100 52v16M12 100h10l8-8M52 96v14h16M90 100h20v10'/%3E%3C/svg%3E");
  background-size: 120px 120px; }
/* Prize figures: gold winner, silver, bronze */
.pz-gold { background: linear-gradient(180deg, #fff6b8 0%, #fde047 35%, #facc15 60%, #d97706 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pz-silver { background: linear-gradient(180deg, #ffffff 0%, #e2e8f0 45%, #94a3b8 70%, #cbd5e1 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pz-bronze { background: linear-gradient(180deg, #ffe4c7 0%, #f0a868 40%, #c2702e 70%, #8a4b1c 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.prize-glow { background: radial-gradient(circle, rgba(250,204,21,.28) 0%, rgba(217,154,28,.1) 45%, transparent 70%); animation: prizeGlow 5s ease-in-out infinite; }
@keyframes prizeGlow { 0%,100% { opacity: .65; } 50% { opacity: 1; } }
.prize-mote { background: #fde68a; box-shadow: 0 0 8px rgba(250,204,21,.9); opacity: 0; }
.prize-in .prize-mote { animation: prizeMote linear infinite; }
@keyframes prizeMote { 0% { transform: translateY(14px); opacity: 0; } 15% { opacity: .85; } 80% { opacity: .5; } 100% { transform: translateY(-60px); opacity: 0; } }
.prize-trophy { perspective: 850px; filter: drop-shadow(0 14px 26px rgba(0,0,0,.6)) drop-shadow(0 0 22px rgba(250,204,21,.3)); }
.tr-3d { transform-style: preserve-3d; }
/* idle after the parts assemble: gentle float + a slow mechanical 3D twist */
.prize-in .tr-3d { animation: trophyFloat 5s ease-in-out 1.4s infinite, trophyTwist 7s ease-in-out 1.6s infinite; }
@keyframes trophyFloat { 0%,100% { transform: translateY(0) rotateY(0); } 50% { transform: translateY(-9px) rotateY(0); } }
@keyframes trophyTwist { 0%,100% { transform: rotateY(-13deg); } 50% { transform: rotateY(13deg); } }
/* transformer-style assembly: each part flies/snaps into place, staggered, with a slight overshoot */
.tr-cup, .tr-hL, .tr-hR, .tr-base, .tr-star { opacity: 0; transform-box: fill-box; transform-origin: center; }
.prize-in .tr-cup  { animation: trCup  .7s cubic-bezier(.2,1.5,.35,1) .05s both; }
.prize-in .tr-base { animation: trBase .6s cubic-bezier(.2,1.5,.35,1) .22s both; }
.prize-in .tr-hL   { animation: trHL   .55s cubic-bezier(.2,1.6,.35,1) .42s both; }
.prize-in .tr-hR   { animation: trHR   .55s cubic-bezier(.2,1.6,.35,1) .42s both; }
.prize-in .tr-star { animation: trStar .6s cubic-bezier(.2,1.7,.35,1) .62s both; }
@keyframes trCup  { from { opacity: 0; transform: translateY(-26px) scale(.5) rotate(-12deg); } to { opacity: 1; transform: none; } }
@keyframes trBase { from { opacity: 0; transform: translateY(32px) scale(.55); } to { opacity: 1; transform: none; } }
@keyframes trHL   { from { opacity: 0; transform: translateX(-36px) rotate(-38deg); } to { opacity: 1; transform: none; } }
@keyframes trHR   { from { opacity: 0; transform: translateX(36px) rotate(38deg); } to { opacity: 1; transform: none; } }
@keyframes trStar { from { opacity: 0; transform: scale(0) rotate(-200deg); } to { opacity: 1; transform: none; } }
.prize-sweep { transform: translateX(-80px); opacity: 0; }
.prize-in .prize-sweep { animation: prizeSweep 1.1s ease-out .75s 1 both; }
@keyframes prizeSweep { 0% { transform: translateX(-80px); opacity: 0; } 30% { opacity: .85; } 100% { transform: translateX(220px); opacity: 0; } }
/* pass cards + stat tiles: lift, glow and a sheen on hover */
.lift-card { transition: transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s ease, border-color .25s ease; }
.lift-card:hover { transform: translateY(-8px); }
.lift-card::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0;
  background: linear-gradient(115deg, transparent 40%, rgba(255,255,255,.12) 50%, transparent 60%);
  background-size: 220% 100%; background-position: 150% 0; transition: opacity .3s ease;
}
.lift-card:hover::after { opacity: 1; animation: cardSheen 1s ease-out; }
@keyframes cardSheen { from { background-position: 150% 0; } to { background-position: -40% 0; } }
.stat-tile { transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease, border-color .22s ease; }
.stat-tile:hover { transform: translateY(-6px); }
.stat-tile .stat-ico { transition: transform .22s cubic-bezier(.2,1.5,.4,1); }
.stat-tile:hover .stat-ico { transform: scale(1.14) rotate(-6deg); }
.prize-rise { opacity: 0; }
.prize-in .prize-rise { animation: prizeRise .7s cubic-bezier(.2,.8,.2,1) both; }
@keyframes prizeRise { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
.prize-amount { font-family: 'Archivo', ui-sans-serif, system-ui, sans-serif; font-stretch: 125%; font-variant-numeric: tabular-nums; filter: drop-shadow(0 3px 0 rgba(0,0,0,.5)) drop-shadow(0 0 28px rgba(250,204,21,.4)); }
.prize-plus { opacity: 0; margin-left: .04em; }
.prize-plus-on { animation: prizePlus .5s cubic-bezier(.2,1.3,.4,1) both; }
@keyframes prizePlus { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
.prize-heading-sweep {
  position: absolute; inset: 0; pointer-events: none; border-radius: 12px;
  background: linear-gradient(110deg, transparent 38%, rgba(255,255,255,.55) 50%, transparent 62%);
  background-size: 260% 100%; background-repeat: no-repeat; opacity: 0;
}
.prize-in .prize-heading-sweep { animation: prizeHeadSweep 1.3s ease-out .8s 1 both; }
@keyframes prizeHeadSweep { 0% { background-position: 150% 0; opacity: 1; } 100% { background-position: -50% 0; opacity: 0; } }

/* Hero → techno-fest hand-off (vars set by TechnoFestSection on scroll): the hero HUD lifts and fades,
   the fixed 3D arena dims into dark steel. */
.hero-band { opacity: calc(1 - var(--hero-out, 0) * 0.95); transform: translateY(calc(var(--hero-out, 0) * -7vh)); }
.scene-dim { background: #03050b; opacity: calc(var(--scene-dim, 0) * 0.82); }
.tf-horizon { top: calc(var(--fade) * 0.82); --d: clamp(0, calc(var(--p) * 3.4 - 0.12), 1);
  opacity: clamp(0, calc((0.92 - var(--p)) * 4), 1); }
.tf-hz-line { fill: none; stroke: url(#tfHz); stroke-width: 2.2; vector-effect: non-scaling-stroke;
  stroke-dasharray: 1; stroke-dashoffset: calc(1 - var(--d)); filter: drop-shadow(0 0 6px rgba(34,211,238,.9)); }
.tf-hz-core { position: absolute; left: 50%; top: 75%; width: 14px; height: 14px; transform: translate(-50%, -50%) rotate(45deg) scale(calc(0.4 + var(--d) * 0.6));
  background: #fff6c2; box-shadow: 0 0 14px 4px rgba(250,204,21,.85), 0 0 40px 12px rgba(34,211,238,.35); }
@media (prefers-reduced-motion: reduce) { .hero-band { opacity: 1; transform: none; } .tf-horizon { display: none; } }

/* Techno-fest section: no hard edge with the hero — its top dissolves into the 3D arena through a soft
   fade that is long while the section is just rising (the hero melts into dark steel) and tightens as it
   scrolls in. Words slide in from the sides. */
.tf-sec {
  --fade: calc(5vh + (1 - var(--p)) * 30vh);
  -webkit-mask-image: linear-gradient(180deg, transparent 0, rgba(0,0,0,.35) calc(var(--fade) * .45), #000 var(--fade));
  mask-image: linear-gradient(180deg, transparent 0, rgba(0,0,0,.35) calc(var(--fade) * .45), #000 var(--fade));
}
.tf-word {
  --q: clamp(0, calc(var(--p) * 2.3 - var(--i) * 0.09), 1);
  transform: translateX(calc((1 - var(--q)) * var(--from) * 38vw)) skewX(calc((1 - var(--q)) * var(--from) * -12deg));
  opacity: var(--q);
  will-change: transform, opacity;
}
.tf-kicker {
  --q: clamp(0, calc((var(--p) - 0.6) * 6), 1);
  opacity: var(--q); transform: translateY(calc((1 - var(--q)) * 18px)); letter-spacing: calc(0.06em + (1 - var(--q)) * 0.3em);
}
.tf-stat {
  --q: clamp(0, calc((var(--p) - 0.72) * 8 - var(--k) * 0.3), 1);
  opacity: var(--q); transform: translateY(calc((1 - var(--q)) * 34px));
  /* chamfered Cybertron plate: the outer layer is the gold edge, the inner one the panel */
  background: linear-gradient(135deg, rgba(250,204,21,.75), rgba(34,211,238,.35) 60%, rgba(250,204,21,.5));
  padding: 1px;
  clip-path: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px);
}
.tf-stat-in {
  background: linear-gradient(180deg, rgba(15,23,42,.96), rgba(3,7,18,.96));
  clip-path: polygon(13px 0, 100% 0, 100% calc(100% - 13px), calc(100% - 13px) 100%, 0 100%, 0 13px);
}
.tf-energon { background: linear-gradient(180deg, #ecfeff 0%, #67e8f9 35%, #22d3ee 60%, #0891b2 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tf-decepticon { background: linear-gradient(180deg, #f5e8ff 0%, #d8b4fe 35%, #a855f7 60%, #7e22ce 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
/* click flash: a bright energon pulse ripples across the words, one after another */
.tf-zap .tf-word { animation: tfZap .7s ease-out both; animation-delay: calc(var(--i) * 60ms); }
@keyframes tfZap {
  0% { filter: brightness(1); }
  30% { filter: brightness(1.9) drop-shadow(0 0 18px rgba(103,232,249,.85)); }
  100% { filter: brightness(1); }
}
.tf-emblem { transform: translate(-50%, -50%) scale(calc(0.75 + var(--p) * 0.35)) rotate(calc((1 - var(--p)) * -20deg)); }
.tf-metal { background: linear-gradient(180deg, #ffffff 0%, #e2e8f0 45%, #94a3b8 60%, #e2e8f0 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tf-gold { background: linear-gradient(180deg, #fff6b8 0%, #fde047 35%, #facc15 60%, #f59e0b 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tf-hex {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100' viewBox='0 0 56 100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0 0v34' fill='none' stroke='%23facc15' stroke-width='1'/%3E%3C/svg%3E");
  background-size: 56px 100px;
}

/* Click burst: a thin gold ring and energy sparks flying out from the pointer */
.click-burst { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 9999; }
.click-burst .cb-ring {
  position: absolute; left: -14px; top: -14px; width: 28px; height: 28px; border-radius: 9999px;
  border: 1.5px solid rgba(250,204,21,.9); box-shadow: 0 0 10px rgba(250,204,21,.45);
  animation: cbRing .45s cubic-bezier(.2,.8,.2,1) forwards;
}
.click-burst .cb-spark {
  position: absolute; left: -2.5px; top: -2.5px; width: 5px; height: 5px;
  animation: cbSpark .55s cubic-bezier(.15,.75,.3,1) forwards;
}
.click-burst .cb-spark.cb-shard { left: -3px; top: -3px; width: 6px; height: 6px; transform: rotate(45deg); }
@keyframes cbRing { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
@keyframes cbSpark {
  0% { transform: translate(0, 0) rotate(var(--rot)) scale(1); opacity: 1; }
  70% { opacity: 1; }
  100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scale(.4); opacity: 0; }
}

/* Header: transparent at the top, dark glass once scrolled (solid on weak GPUs: no blur over the 3D canvas) */
.site-header { border-bottom: 1px solid transparent; transition: background-color .35s ease, border-color .35s ease, box-shadow .35s ease; }
.site-header.hdr-solid {
  background-color: rgba(3,7,18,.82); border-bottom-color: rgba(51,65,85,.6); box-shadow: 0 8px 24px rgba(0,0,0,.35);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
}
.tier-low .site-header.hdr-solid { background-color: rgba(3,7,18,.95); -webkit-backdrop-filter: none; backdrop-filter: none; }

/* Audio pill equaliser bars */
.eq-bar { transform-origin: bottom; animation: eqBar 0.9s ease-in-out infinite alternate; }
@keyframes eqBar { from { transform: scaleY(0.35); } to { transform: scaleY(1); } }

/* Weaker GPUs: drop effects that force full repaints while things animate over the 3D canvas. */
/* Low tier: the techno-fest top fade stays a fixed length (no mask repaint on every scroll frame),
   glows lose their blur filters, the pass deck dims with opacity instead of a filter, and the
   certificate hologram skips its drop-shadow, flicker and glass blur. */
.tier-low .tf-sec { --fade: 24vh; }
.tier-low .tf-hz-line { filter: none; stroke-width: 2.6; }
.tier-low .tf-hz-core { box-shadow: 0 0 10px 3px rgba(250,204,21,.7); }
.tier-low .pass-card { filter: none !important; transition: transform .4s cubic-bezier(.2,.8,.2,1), opacity .3s ease; }
.tier-low .pass-deck:not(.is-rest) .pass-card:not(.pass-on) { opacity: .72; }
.tier-low .cert-plate { animation-name: certUnfoldLite; }
@keyframes certUnfoldLite { 0% { transform: scale(.02, .006); opacity: 0; } 12% { opacity: 1; } 48% { transform: scale(1, .006); } 100% { transform: scale(1, 1); } }
.tier-low .backdrop-blur-sm { -webkit-backdrop-filter: none; backdrop-filter: none; }
.tier-low .pv-vault, .tier-low .cert-scan { animation: none; }
.tier-low .prize-trophy, .tier-mid .prize-trophy { filter: none; }
.tier-low .blur-2xl, .tier-low .blur-3xl, .tier-mid .blur-2xl, .tier-mid .blur-3xl { display: none; }
.tier-low .prize-mote, .tier-low .gate-mote { display: none; }
.tier-low .lift-card::after { display: none; }

@media (prefers-reduced-motion: reduce) {
  .hero-in, .hud-in, .hud-bar, .hud-flash, .hud-panel-in, .hud-scan,
  .gate-grid, .gate-beam, .gate-ring, .gate-ring-rev, .gate-sheen,
  .gate-rise, .emblem-in, .scene-in, .fade-in,
  .prize-glow, .prize-mote, .prize-sweep, .prize-rise, .prize-plus-on, .prize-heading-sweep,
  .tr-3d, .tr-cup, .tr-base, .tr-hL, .tr-hR, .tr-star, .eq-bar { animation: none !important; }
  .click-burst { display: none; }
  .pv-vault, .pv-conduit i { animation: none; }
  .tf-zap .tf-word { animation: none; }
  .prize-trophy, .prize-rise, .prize-plus, .tr-cup, .tr-base, .tr-hL, .tr-hR, .tr-star { opacity: 1 !important; transform: none !important; }
  .lift-card:hover, .stat-tile:hover { transform: none; }
  .gate-mote, .gate-sheen { display: none; }
  .hud-flash { opacity: 0; }
  .gate-emblem, .gate-emblem:hover, .gate-emblem:active { transform: none; }
}
`;

/* ===================== COUNTDOWN ===================== */
// Its own component so the per-second tick re-renders only these digits, not the whole page.
const computeLeft = () => {
  const diff = EVENT_DATE.getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    days: Math.floor(diff / 86400000),
    hours: Math.floor(diff / 3600000) % 24,
    minutes: Math.floor(diff / 60000) % 60,
    seconds: Math.floor(diff / 1000) % 60
  };
};

function Countdown() {
  const [timeLeft, setTimeLeft] = useState(computeLeft);
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(computeLeft()), 1000);
    return () => clearInterval(id);
  }, []);
  // Plain, widely tracked white figures separated by colons, labels underneath.
  return (
    <div className="pt-4 mx-auto pointer-events-auto flex items-start justify-center gap-3 sm:gap-6 text-white" style={{ textShadow: '0 2px 18px rgba(0,0,0,.65)' }}>
      {[
        { label: 'DAYS', val: timeLeft.days },
        { label: 'HOURS', val: timeLeft.hours },
        { label: 'MINUTES', val: timeLeft.minutes },
        { label: 'SECONDS', val: timeLeft.seconds }
      ].map((item, i) => (
        <React.Fragment key={item.label}>
          {i > 0 && (
            <span className="font-sans font-semibold leading-none text-slate-300/80" style={{ fontSize: 'clamp(1.75rem, 5.5vw, 3.25rem)' }}>:</span>
          )}
          <div className="flex flex-col items-center">
            <span
              className="font-sans font-semibold leading-none tabular-nums"
              style={{ fontSize: 'clamp(1.75rem, 5.5vw, 3.25rem)', letterSpacing: '0.28em', marginRight: '-0.28em' }}
            >
              {String(item.val).padStart(2, '0')}
            </span>
            <span className="mt-3 font-sans font-bold text-[9px] sm:text-xs text-slate-200" style={{ letterSpacing: '0.3em', marginRight: '-0.3em' }}>
              {item.label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ===================== SUB-PAGES (certificate, my pass) ===================== */
// Each lives at its own hash so Back/Forward and shared links work.
type SubPage = 'certificate' | 'mypass' | null;
const subPageFromHash = (): SubPage => {
  const h = window.location.hash;
  if (h.startsWith('#certificate')) return 'certificate';
  if (h === '#mypass') return 'mypass';
  return null;
};

// Every event across the four arenas, for certificate titles.
const ALL_EVENTS = HEROES.flatMap((h) => h.events.map((ev) => ({ ...ev, heroName: h.name, theme: h.theme })));

// Certificates unlock once the fest is over (end of Feb 5, 2027). On the dev server,
// add ?certdemo to the URL to preview them early with sample attendance.
const CERTIFICATES_OPEN = new Date('2027-02-06T00:00:00');
const certificatesOpen = () =>
  (import.meta.env.DEV && new URLSearchParams(window.location.search).has('certdemo')) || Date.now() >= CERTIFICATES_OPEN.getTime();

const loadImage = (src: string) => new Promise<HTMLImageElement | null>((res) => {
  const im = new Image();
  im.onload = () => res(im);
  im.onerror = () => res(null);
  im.src = src;
});

// Draws one event's certificate onto a 2000×1414 canvas (A4 landscape ratio).
async function drawCertificate(name: string, id: string, eventTitle: string) {
  const W = 2000, H = 1414;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  await Promise.all([
    "900 120px 'Archivo'", "400 40px 'Inter'", "700 40px 'Inter'", "600 30px 'IBM Plex Mono'"
  ].map((f) => document.fonts?.load(f).catch(() => undefined)));
  const [logo, kpr, acmw, nexora] = await Promise.all(
    ['assets/logo-hd.webp', 'assets/kpr-hd.png', 'assets/acmw.png', 'assets/nexora.png'].map((f) => loadImage(BASE + f))
  );
  const stretch = (v: 'expanded' | 'normal') => { g.fontStretch = v; };
  const spaced = (px: number) => { g.letterSpacing = `${px}px`; };
  // Shrinks a font size until the text fits the given width.
  const fit = (text: string, weight: number, family: string, start: number, min: number, maxW: number) => {
    let size = start;
    g.font = `${weight} ${size}px ${family}`;
    while (g.measureText(text).width > maxW && size > min) {
      size -= 2;
      g.font = `${weight} ${size}px ${family}`;
    }
  };

  // Background: deep navy with a warm glow behind the name.
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a1226');
  bg.addColorStop(1, '#03060f');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 0.55, 40, W / 2, H * 0.55, 900);
  glow.addColorStop(0, 'rgba(250,204,21,0.16)');
  glow.addColorStop(1, 'rgba(250,204,21,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  // Double gold frame with corner brackets.
  g.strokeStyle = '#facc15';
  g.lineWidth = 6;
  g.strokeRect(50, 50, W - 100, H - 100);
  g.strokeStyle = 'rgba(250,204,21,0.45)';
  g.lineWidth = 2;
  g.strokeRect(74, 74, W - 148, H - 148);
  g.strokeStyle = '#facc15';
  g.lineWidth = 6;
  ([[50, 50, 1, 1], [W - 50, 50, -1, 1], [50, H - 50, 1, -1], [W - 50, H - 50, -1, -1]] as const).forEach(([x, y, sx, sy]) => {
    g.beginPath();
    g.moveTo(x + sx * 110, y + sy * 26);
    g.lineTo(x + sx * 26, y + sy * 26);
    g.lineTo(x + sx * 26, y + sy * 110);
    g.stroke();
  });

  // Header logos: fest insignia left, KPR right.
  if (logo) g.drawImage(logo, 150, 120, 170, 170);
  if (kpr) {
    const h = 130, w = (kpr.naturalWidth / kpr.naturalHeight) * h;
    g.drawImage(kpr, W - 150 - w, 140, w, h);
  }

  // Wordmark: white OPTIMUS, gold '27.
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  stretch('expanded');
  spaced(4);
  g.font = "900 96px 'Archivo', sans-serif";
  const word = 'OPTIMUS ', year = "'27";
  const ww = g.measureText(word).width, yw = g.measureText(year).width;
  const x0 = W / 2 - (ww + yw) / 2;
  g.fillStyle = '#e2e8f0';
  g.fillText(word, x0, 260);
  g.fillStyle = '#facc15';
  g.fillText(year, x0 + ww, 260);
  g.textAlign = 'center';
  stretch('normal');
  spaced(14);
  g.font = "600 26px 'IBM Plex Mono', monospace";
  g.fillStyle = '#94a3b8';
  g.fillText('NATIONAL LEVEL TECHNO FEST', W / 2, 320);

  // Title
  spaced(18);
  g.font = "700 46px 'Inter', sans-serif";
  g.fillStyle = '#facc15';
  g.fillText('CERTIFICATE OF PARTICIPATION', W / 2, 450);
  g.strokeStyle = 'rgba(250,204,21,0.5)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(W / 2 - 330, 485); g.lineTo(W / 2 + 330, 485); g.stroke();

  spaced(2);
  g.font = "400 34px 'Inter', sans-serif";
  g.fillStyle = '#cbd5e1';
  g.fillText('This is to certify that', W / 2, 570);

  // Name, shrunk to fit long names.
  stretch('expanded');
  spaced(3);
  fit(name, 900, "'Archivo', sans-serif", 110, 48, W - 420);
  g.fillStyle = '#ffffff';
  g.fillText(name, W / 2, 700);
  stretch('normal');
  g.strokeStyle = 'rgba(148,163,184,0.5)';
  g.beginPath(); g.moveTo(W / 2 - 520, 740); g.lineTo(W / 2 + 520, 740); g.stroke();

  spaced(8);
  g.font = "600 28px 'IBM Plex Mono', monospace";
  g.fillStyle = '#facc15';
  g.fillText(`OPTIMUS ID · ${id}`, W / 2, 792);

  spaced(1);
  g.font = "400 34px 'Inter', sans-serif";
  g.fillStyle = '#cbd5e1';
  g.fillText('has participated in', W / 2, 880);
  // The event this certificate is for.
  spaced(6);
  fit(eventTitle, 700, "'Inter', sans-serif", 50, 30, W - 500);
  g.fillStyle = '#facc15';
  g.fillText(eventTitle, W / 2, 950);
  spaced(1);
  g.font = "400 34px 'Inter', sans-serif";
  g.fillStyle = '#cbd5e1';
  g.fillText("at OPTIMUS '27, the National Level Techno Fest held at KPR Institute of", W / 2, 1020);
  g.fillText('Engineering and Technology, Coimbatore, on 4 – 5 February 2027.', W / 2, 1068);

  // Signature lines
  spaced(6);
  g.font = "600 24px 'IBM Plex Mono', monospace";
  g.fillStyle = '#94a3b8';
  g.strokeStyle = 'rgba(148,163,184,0.6)';
  ([[W * 0.22, 'FACULTY COORDINATOR'], [W * 0.78, 'PRINCIPAL']] as const).forEach(([sx, label]) => {
    g.beginPath(); g.moveTo(sx - 200, 1190); g.lineTo(sx + 200, 1190); g.stroke();
    g.fillText(label, sx, 1232);
  });

  // Sponsors, bottom centre
  spaced(10);
  g.font = "600 20px 'IBM Plex Mono', monospace";
  g.fillStyle = '#67e8f9';
  g.fillText('PRESENTED BY', W / 2, 1185);
  const sh = 64;
  const aw = acmw ? (acmw.naturalWidth / acmw.naturalHeight) * sh : 0;
  const nw = nexora ? (nexora.naturalWidth / nexora.naturalHeight) * sh : 0;
  const gap = acmw && nexora ? 40 : 0;
  let lx = W / 2 - (aw + gap + nw) / 2;
  if (acmw) { g.drawImage(acmw, lx, 1210, aw, sh); lx += aw + gap; }
  if (nexora) g.drawImage(nexora, lx, 1210, nw, sh);
  spaced(0);
  return cv;
}

const canvasUrl = (cv: HTMLCanvasElement) => new Promise<string>((res, rej) =>
  cv.toBlob((b) => (b ? res(URL.createObjectURL(b)) : rej(new Error('canvas'))), 'image/png'));

const DemoNote = ({ children }: { children: React.ReactNode }) => (
  <p className="max-w-xl mx-auto mt-6 rounded-xl border border-dashed border-slate-700 bg-slate-950/70 px-4 py-3 text-[11px] font-mono text-slate-400 text-center">
    DEMO · {children}
  </p>
);

type CertResult = { eventId: string; title: string; arena: string; url: string; file: string };

// Certificate page backdrop — "Autobot records": a blueprint grid, a projector beam rising from below
// and HUD corner brackets. Fixed behind the page content (and over the 3D scene). The certificate itself
// is CertFrame, which holds the page content.
function CertBackdrop() {
  useEffect(() => {
    sceneGate.page = true;
    return () => { sceneGate.page = false; };
  }, []);
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_60%_at_50%_38%,#0b2442_0%,#060e1e_55%,#03050b_100%)]" />
      <div className="cert-grid absolute inset-0" />
      {/* Projector beam rising from the console below the form */}
      <div className="cert-beam absolute left-1/2 bottom-0 w-[min(140vw,1200px)] h-[78%]" />
      {/* HUD corner brackets */}
      {[
        'top-24 left-4 sm:left-8 border-t-2 border-l-2',
        'top-24 right-4 sm:right-8 border-t-2 border-r-2',
        'bottom-6 left-4 sm:left-8 border-b-2 border-l-2',
        'bottom-6 right-4 sm:right-8 border-b-2 border-r-2'
      ].map((c) => (
        <span key={c} className={`cert-corner absolute w-12 h-12 sm:w-20 sm:h-20 border-cyan-400/45 ${c}`} />
      ))}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_85%_70%_at_50%_45%,transparent_40%,rgba(3,5,11,.75)_100%)]" />
    </div>
  );
}

// The page content sits inside a holographic certificate: notched cyan border, an inner dashed rule,
// gold corner filigree, a scan line, and a signature / seal row at the foot. On entry it unfolds from
// its centre — a bright line opens sideways, then the sheet opens up and down — and the content
// rises in after it.
function CertFrame({ children }: { children: React.ReactNode }) {
  const signature = (d: string, role: string) => (
    <div className="flex-1 min-w-0 max-w-[13rem] text-center">
      <svg viewBox="0 0 200 40" className="w-full h-8 sm:h-10" fill="none" aria-hidden="true">
        <path d={d} stroke="rgba(165,243,252,.75)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <div className="h-px bg-cyan-300/50" />
      <p className="mt-1.5 text-[9px] sm:text-[10px] font-mono font-bold tracking-[0.25em] text-cyan-200/80">{role}</p>
    </div>
  );
  return (
    <div className="cert-plate relative mt-6">
      <div className="cert-plate-in relative overflow-hidden px-5 sm:px-12 lg:px-16 pt-10 sm:pt-12 pb-8 sm:pb-10">
        {['top-3 left-3 border-t-2 border-l-2', 'top-3 right-3 border-t-2 border-r-2', 'bottom-3 left-3 border-b-2 border-l-2', 'bottom-3 right-3 border-b-2 border-r-2'].map((c) => (
          <span key={c} className={`absolute w-8 h-8 sm:w-12 sm:h-12 border-amber-400/70 pointer-events-none ${c}`} aria-hidden="true" />
        ))}
        <span className="cert-scan" aria-hidden="true" />
        <div className="relative">{children}</div>
        {/* Signatures and the seal, like the foot of a printed certificate */}
        <div className="cert-in relative mt-8 sm:mt-10 flex items-end justify-between gap-3 sm:gap-8" style={{ animationDelay: '1.35s' }} aria-hidden="true">
          {signature('M10 30 C30 8 45 34 62 18 S92 10 104 24 S140 28 150 14 S180 20 190 26', 'FEST CONVENOR')}
          <div className="relative shrink-0 w-20 h-20 sm:w-24 sm:h-24 rounded-full border-2 border-amber-400/70 flex items-center justify-center">
            <span className="absolute inset-1.5 rounded-full border border-dashed border-amber-300/50" />
            <img src={BASE + 'assets/logo-hd.webp'} alt="" className="w-11 h-11 sm:w-14 sm:h-14 object-contain opacity-80" />
          </div>
          {signature('M12 26 C26 12 40 30 56 20 S80 6 98 22 C110 32 128 10 146 20 S176 28 188 16', 'PRINCIPAL · KPRIET')}
        </div>
      </div>
    </div>
  );
}

function CertificatePage({ onHome }: { onHome: () => void }) {
  const [optimusId, setOptimusId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<null | 'locked' | 'none'>(null);
  const [results, setResults] = useState<{ name: string; id: string; certs: CertResult[] } | null>(null);
  const [onResults, setOnResults] = useState(false);

  useEffect(() => () => results?.certs.forEach((c) => URL.revokeObjectURL(c.url)), [results]);
  // The results view is its own history entry (#certificate/results): Back returns to the form.
  useEffect(() => {
    if (window.location.hash === '#certificate/results') history.replaceState(null, '', '#certificate');
    // Results stay in memory, so Back shows the form and Forward shows them again.
    const onPop = () => setOnResults(window.location.hash === '#certificate/results');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!certificatesOpen()) {
      setNotice('locked');
      return;
    }
    const id = optimusId.trim().toUpperCase();
    const nm = normalizeName(name);
    if (!isOptimusId(id)) {
      window.alert('Please enter a valid Optimus ID, e.g. OPT27-00142.');
      return;
    }
    if (!nm) {
      window.alert('Please enter your name.');
      return;
    }
    if (!isCapsName(nm)) {
      window.alert('Name must be in CAPITAL LETTERS only (for example: JOSEPH VIJAY).');
      return;
    }
    const owner = findProfile(id);
    if (owner && owner.name !== nm) {
      window.alert('This name does not match the name registered for this Optimus ID.');
      return;
    }
    const attended = attendedEvents(id)
      .map((eid) => ALL_EVENTS.find((ev) => ev.id === eid))
      .filter((ev): ev is (typeof ALL_EVENTS)[number] => !!ev);
    if (!attended.length) {
      setNotice('none');
      return;
    }
    setBusy(true);
    try {
      const certs: CertResult[] = [];
      for (const ev of attended) {
        const url = await canvasUrl(await drawCertificate(nm, id, ev.title));
        certs.push({ eventId: ev.id, title: ev.title, arena: ev.heroName, url, file: `OPTIMUS27-${id}-${ev.id}.png` });
      }
      setResults({ name: nm, id, certs });
      setOnResults(true);
      history.pushState(null, '', '#certificate/results');
      window.scrollTo({ top: 0 });
    } catch {
      window.alert('Sorry, the certificates could not be created on this browser. Please try another browser.');
    } finally {
      setBusy(false);
    }
  };

  if (results && onResults) {
    return (
      <section className="min-h-[calc(100vh-5rem)] px-4 sm:px-6 lg:px-8 pt-8 pb-28 sm:py-14 max-w-6xl mx-auto">
        <CertBackdrop />
        <button onClick={() => history.back()} className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-300 hover:text-white">
          <ArrowLeft className="w-4 h-4" /> BACK
        </button>
        <div className="text-center max-w-2xl mx-auto mt-8 mb-10 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono font-bold border bg-amber-500/80 text-white border-amber-300">
            <Award className="w-3.5 h-3.5" /> ATTENDANCE VERIFIED
          </div>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-white via-cyan-200 to-cyan-400">
            Your Certificates
          </h1>
          <p className="text-slate-300 text-sm sm:text-base">
            <span className="font-bold text-white">{results.name}</span> · <span className="font-mono">{results.id}</span> · {results.certs.length} event{results.certs.length > 1 ? 's' : ''} attended
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {results.certs.map((c) => (
            <div key={c.eventId} className="rounded-3xl bg-slate-900/90 border border-slate-800 p-4 sm:p-5 space-y-4">
              <img src={c.url} alt={`Certificate for ${c.title}`} className="w-full rounded-xl border border-slate-800" />
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-black tracking-wide text-white truncate">{c.title}</p>
                  <p className="text-[11px] font-mono tracking-widest text-slate-400">{c.arena} ARENA</p>
                </div>
                <a
                  href={c.url}
                  download={c.file}
                  className="shrink-0 inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-black text-[11px] font-black tracking-widest"
                >
                  <Download className="w-4 h-4" /> DOWNLOAD
                </a>
              </div>
            </div>
          ))}
        </div>
        {IDENTITY_DEMO && <DemoNote>Attendance shown here is sample data until the QR attendance backend is connected.</DemoNote>}
      </section>
    );
  }

  return (
    <section className="min-h-[calc(100vh-5rem)] px-4 sm:px-6 lg:px-8 pt-8 pb-28 sm:py-14 max-w-5xl mx-auto">
      <CertBackdrop />
      <button onClick={onHome} className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-300 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> BACK TO HOME
      </button>

      <CertFrame>
      <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-10 space-y-3">
        <div className="cert-in inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono font-bold border bg-amber-500/80 text-white border-amber-300" style={{ animationDelay: '.85s' }}>
          <Award className="w-3.5 h-3.5" /> PARTICIPATION CERTIFICATE
        </div>
        <h1 className="cert-in text-4xl sm:text-6xl font-black tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-white via-cyan-200 to-cyan-400" style={{ animationDelay: '.95s' }}>
          Get Your Certificate
        </h1>
        <p className="cert-in text-slate-300 text-sm sm:text-base" style={{ animationDelay: '1.05s' }}>
          Enter your Optimus ID and your name in capital letters. You get one certificate for every event your attendance was recorded at.
        </p>
      </div>

      <form onSubmit={submit} noValidate className="cert-in max-w-xl mx-auto rounded-3xl bg-slate-950/85 border border-cyan-400/30 shadow-[0_30px_80px_-30px_rgba(34,211,238,.35)] p-6 sm:p-8 space-y-5" style={{ animationDelay: '1.15s' }}>
        <div>
          <label htmlFor="cert-id" className="text-xs font-mono font-bold tracking-widest text-slate-400 block mb-1.5">OPTIMUS ID</label>
          <input
            id="cert-id"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. OPT27-00142"
            value={optimusId}
            onChange={(e) => setOptimusId(e.target.value.toUpperCase())}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm font-mono tracking-wider focus:outline-none focus:border-cyan-400"
          />
        </div>
        <div>
          <label htmlFor="cert-name" className="text-xs font-mono font-bold tracking-widest text-slate-400 block mb-1.5">NAME (CAPITAL LETTERS ONLY)</label>
          <input
            id="cert-name"
            type="text"
            autoComplete="name"
            placeholder="e.g. JOSEPH VIJAY"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm tracking-wide focus:outline-none focus:border-cyan-400"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-black text-xs font-black tracking-widest flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <Award className="w-4 h-4" /> {busy ? 'CREATING CERTIFICATES…' : 'GET CERTIFICATE'}
        </button>
        {notice === 'locked' && (
          <div role="status" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-5 py-4 text-center space-y-1.5">
            <p className="text-sm font-black tracking-widest text-amber-300">CERTIFICATES OPEN AFTER THE EVENT</p>
            <p className="text-sm text-slate-300">
              Participate in OPTIMUS '27 on Feb 4 – 5, 2027, then come back here after the fest to get your certificate.
            </p>
          </div>
        )}
        {notice === 'none' && (
          <div role="status" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-center space-y-1.5">
            <p className="text-sm font-black tracking-widest text-rose-300">NO ATTENDANCE FOUND</p>
            <p className="text-sm text-slate-300">
              Certificates are issued only for events where your QR was scanned. Contact the organisers if this looks wrong.
            </p>
          </div>
        )}
      </form>
      </CertFrame>
    </section>
  );
}

function MyPassPage({ profile, onProfile, onHome }: { profile: Profile | null; onProfile: (p: Profile | null) => void; onHome: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', college: '' });
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (!profile) { setQr(''); return; }
    QRCode.toDataURL(qrPayload(profile), { width: 480, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#020617', light: '#ffffff' } })
      .then(setQr, () => setQr(''));
  }, [profile]);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const name = normalizeName(form.name);
    if (!name || !form.email.trim() || !form.phone.trim() || !form.college.trim()) {
      window.alert('Please fill in all the details.');
      return;
    }
    if (!isCapsName(name)) {
      window.alert('Name must be in CAPITAL LETTERS only (for example: JOSEPH VIJAY).');
      return;
    }
    onProfile(createProfile({ name, email: form.email.trim(), phone: form.phone.trim(), college: form.college.trim() }));
  };

  const field = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-400';
  const label = 'text-xs font-mono font-bold tracking-widest text-slate-400 block mb-1.5';

  return (
    <section className="min-h-[calc(100vh-5rem)] px-4 sm:px-6 lg:px-8 pt-8 pb-28 sm:py-14 max-w-5xl mx-auto">
      <button onClick={onHome} className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-300 hover:text-white">
        <ArrowLeft className="w-4 h-4" /> BACK TO HOME
      </button>

      <div className="text-center max-w-2xl mx-auto mt-8 mb-10 space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono border bg-amber-500/15 text-amber-300 border-amber-500/40">
          <QrCode className="w-3.5 h-3.5" /> MY PASS
        </div>
        <h1 className="text-4xl sm:text-6xl font-black tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r from-slate-200 via-amber-400 to-yellow-500">
          {profile ? 'Your Optimus ID' : 'Get Your Optimus ID'}
        </h1>
        <p className="text-slate-300 text-sm sm:text-base">
          {profile
            ? 'Show this QR at every event so your attendance is recorded. Certificates are issued only for scanned events.'
            : 'Every participant needs an Optimus ID to register, join a team and get certificates.'}
        </p>
      </div>

      {profile ? (
        <div className="max-w-xl mx-auto rounded-3xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 space-y-6 text-center">
          <div>
            <p className="text-[11px] font-mono tracking-[0.3em] text-slate-400">OPTIMUS ID</p>
            <p className="mt-1 text-3xl sm:text-4xl font-black tracking-widest text-amber-300 font-mono">{profile.id}</p>
            <p className="mt-2 text-lg font-black tracking-wide text-white">{profile.name}</p>
            <p className="text-xs text-slate-400">{profile.college}</p>
          </div>
          <div className="mx-auto w-56 sm:w-64 aspect-square rounded-2xl bg-white p-3">
            {qr && <img src={qr} alt={`QR code for ${profile.id}`} className="w-full h-full" />}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {qr && (
              <a
                href={qr}
                download={`${profile.id}-QR.png`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 text-black text-xs font-black tracking-widest"
              >
                <Download className="w-4 h-4" /> DOWNLOAD QR
              </a>
            )}
            <button
              onClick={() => { signOutProfile(); onProfile(null); }}
              className="px-6 py-3 rounded-xl border border-slate-700 text-slate-300 hover:text-white text-xs font-mono font-bold tracking-widest"
            >
              SIGN OUT
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={create} noValidate className="max-w-xl mx-auto rounded-3xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 space-y-5">
          <button
            type="button"
            disabled
            className="w-full py-3.5 rounded-xl bg-white/90 text-slate-500 text-xs font-black tracking-widest flex items-center justify-center gap-2 cursor-not-allowed"
            title="Google sign-in arrives with the backend"
          >
            <span className="text-base leading-none">G</span> SIGN IN WITH GOOGLE · COMING SOON
          </button>
          <div className="flex items-center gap-3 text-[10px] font-mono tracking-widest text-slate-500">
            <span className="h-px flex-1 bg-slate-800" /> FOR NOW, ENTER YOUR DETAILS <span className="h-px flex-1 bg-slate-800" />
          </div>
          <div>
            <label htmlFor="mp-name" className={label}>NAME (CAPITAL LETTERS ONLY)</label>
            <input id="mp-name" type="text" autoComplete="name" placeholder="e.g. JOSEPH VIJAY" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
          </div>
          <div>
            <label htmlFor="mp-college" className={label}>COLLEGE / INSTITUTION</label>
            <input id="mp-college" type="text" autoComplete="organization" placeholder="Your college name" value={form.college}
              onChange={(e) => setForm({ ...form, college: e.target.value })} className={field} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="mp-email" className={label}>EMAIL</label>
              <input id="mp-email" type="email" autoComplete="email" placeholder="you@gmail.com" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
            </div>
            <div>
              <label htmlFor="mp-phone" className={label}>PHONE</label>
              <input id="mp-phone" type="tel" autoComplete="tel" placeholder="+91 9876543210" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} className={field} />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-4 rounded-xl bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-black text-xs font-black tracking-widest flex items-center justify-center gap-2"
          >
            <QrCode className="w-4 h-4" /> GET OPTIMUS ID
          </button>
        </form>
      )}
      {IDENTITY_DEMO && <DemoNote>IDs are saved only in this browser until Google sign-in and the backend are connected.</DemoNote>}
    </section>
  );
}

/* ===================== "NATIONAL LEVEL TECHNO FEST" SCROLL SECTION ===================== */
// Second "page" after the hero: an opaque Cybertron backdrop (drifting energon shards on dark steel,
// a faint hex grid and a big Autobot insignia) where the headline assembles as you scroll.
// Scroll progress is written to one CSS variable (--p, 0 → 1); every transform reads it in CSS,
// so React never re-renders while scrolling.

// Drifting energon shards: short diagonal streaks with a slight colour split (like a fast camera pass).
function EnergonShards({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const g = cv.getContext('2d');
    if (!g) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowTier = document.documentElement.classList.contains('tier-low');
    const COUNT = lowTier ? 26 : 60;
    const COLORS = ['250,204,21', '251,191,36', '34,211,238', '148,197,255'];
    let w = 0, h = 0, raf = 0, visible = false, last = performance.now();
    type Shard = { x: number; y: number; len: number; speed: number; alpha: number; c: string; thick: number };
    const shards: Shard[] = [];
    const spawn = (s: Partial<Shard> = {}): Shard => ({
      x: Math.random() * w, y: Math.random() * h,
      len: 14 + Math.random() * 46, speed: 40 + Math.random() * 120,
      alpha: 0.25 + Math.random() * 0.6, c: COLORS[(Math.random() * COLORS.length) | 0],
      thick: Math.random() < 0.2 ? 2.2 : 1.2, ...s
    });
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, lowTier ? 1 : 1.5);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!shards.length) for (let i = 0; i < COUNT; i++) shards.push(spawn());
    };
    // Shards fly down-right at a shallow angle.
    const DX = Math.cos(0.38), DY = Math.sin(0.38);
    const draw = (dt: number) => {
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (const s of shards) {
        s.x += DX * s.speed * dt;
        s.y += DY * s.speed * dt;
        if (s.x - s.len > w || s.y - s.len > h) Object.assign(s, spawn({ x: -Math.random() * w * 0.3, y: Math.random() * h - h * 0.3 }));
        const x2 = s.x - DX * s.len, y2 = s.y - DY * s.len;
        // faint red/blue ghosts either side, then the bright core
        g.lineWidth = s.thick;
        g.strokeStyle = `rgba(239,68,68,${s.alpha * 0.35})`;
        g.beginPath(); g.moveTo(s.x - 1.5, s.y); g.lineTo(x2 - 1.5, y2); g.stroke();
        g.strokeStyle = `rgba(56,189,248,${s.alpha * 0.35})`;
        g.beginPath(); g.moveTo(s.x + 1.5, s.y); g.lineTo(x2 + 1.5, y2); g.stroke();
        g.strokeStyle = `rgba(${s.c},${s.alpha})`;
        g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(x2, y2); g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    };
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      draw(dt);
    };
    resize();
    draw(0);
    // Only animate while on screen.
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible && !reduce) { last = performance.now(); raf = requestAnimationFrame(loop); }
    });
    io.observe(cv);
    const ro = new ResizeObserver(() => { resize(); draw(0); });
    ro.observe(cv);
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

function TechnoFestSection() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.style.setProperty('--p', '1'); return; }
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the section's top reaches the bottom of the screen, 1 once it has scrolled ~1 screen in.
      const p = Math.min(1, Math.max(0, (vh - r.top) / (vh * 1.05)));
      el.style.setProperty('--p', p.toFixed(3));
      // Page-level transition from the hero: its HUD lifts away and fades, and the 3D arena dims into
      // this section's dark steel so the two never meet at an edge. The dimmer lifts again before the
      // events section, where the robots need the arena.
      const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
      const roster = document.getElementById('roster');
      const leave = roster ? clamp01((vh - roster.getBoundingClientRect().top) / (vh * 0.6)) : 0;
      const root = document.documentElement.style;
      // The techno-fest section is opaque below its top fade (≤ 35vh) and the prize section right after
      // it is fully opaque: while together they cover the screen, nothing of the 3D scene is visible.
      const prize = document.querySelector<HTMLElement>('.prize-sec');
      const opaqueBottom = prize ? prize.getBoundingClientRect().bottom : r.bottom;
      sceneGate.scroll = r.top + vh * 0.4 <= 0 && opaqueBottom >= vh;
      root.setProperty('--hero-out', clamp01((window.scrollY - vh * 0.1) / (vh * 0.6)).toFixed(3));
      root.setProperty('--scene-dim', (clamp01((vh * 0.85 - r.top) / (vh * 0.75)) * (1 - leave)).toFixed(3));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      document.documentElement.style.setProperty('--hero-out', '0');
      document.documentElement.style.setProperty('--scene-dim', '0');
      sceneGate.scroll = false;
    };
  }, []);

  // Each word slides in from its own side; i staggers them so the headline assembles in order.
  // Clicking the headline flashes an energon pulse across the words and moves to the next scheme.
  const SCHEMES = [
    ['text-white', 'tf-metal', 'tf-gold'],      // Autobot: white, silver, gold
    ['text-white', 'tf-metal', 'tf-energon'],   // Energon: white, silver, cyan
    ['text-white', 'tf-metal', 'tf-decepticon'] // Decepticon: white, silver, violet
  ];
  const [scheme, setScheme] = useState(0);
  const [zap, setZap] = useState(0);   // bumps on every click to restart the flash animation
  const lines: { words: string[]; cls: string }[] = [
    { words: ['THE', 'BIGGEST'], cls: SCHEMES[scheme][0] },
    { words: ['NATIONAL', 'LEVEL'], cls: SCHEMES[scheme][1] },
    { words: ['TECHNO', 'FEST'], cls: SCHEMES[scheme][2] }
  ];
  const facts = [
    { label: 'DATES', value: 'FEB 4 – 5', sub: '2027' },
    { label: 'ARENAS', value: '04', sub: 'LEADERS' },
    { label: 'EVENTS', value: '10+', sub: 'TECH & FUN' },
    { label: 'HACKATHON', value: '24', sub: 'HOURS' }
  ];
  let wi = 0;
  return (
    <section ref={ref} className="tf-sec relative z-10 overflow-hidden -mt-[6vh]" style={{ ['--p' as string]: 0 }}>
      {/* Backdrop: dark Cybertron steel, energon shards, hex grid, insignia watermark */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,#0f1b33_0%,#060a14_55%,#03050b_100%)]" />
      <div className="tf-hex tf-hex-fade absolute inset-0 opacity-[0.07]" />
      <img
        src={BASE + 'assets/logo-hd.webp'} alt="" aria-hidden="true" decoding="async"
        className="tf-emblem absolute left-1/2 top-1/2 w-[min(70vw,640px)] -translate-x-1/2 -translate-y-1/2 opacity-[0.06] pointer-events-none select-none"
      />
      <EnergonShards className="absolute inset-0 w-full h-full" />
      {/* Energon horizon: an Autobot-visor chevron drawn outward from a bright core as the section rises,
          sitting where the arena dissolves into the section; it fades once the section has settled */}
      <div className="tf-horizon absolute inset-x-0 h-10 sm:h-12 pointer-events-none" aria-hidden="true">
        <svg viewBox="0 0 1000 40" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="tfHz" x1="0" y1="0" x2="1000" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
              <stop offset=".3" stopColor="#22d3ee" />
              <stop offset=".5" stopColor="#facc15" />
              <stop offset=".7" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path pathLength={1} className="tf-hz-line" d="M500 30 H545 L570 8 H1000" />
          <path pathLength={1} className="tf-hz-line" d="M500 30 H455 L430 8 H0" />
        </svg>
        <span className="tf-hz-core" />
      </div>
      {/* Horizon glow where the arena floor meets the section: a warm haze instead of an edge line */}
      <div className="absolute inset-x-0 top-0 h-[30vh] bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(250,204,21,.10),transparent_70%)]" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#03050b]" aria-hidden="true" />
      {/* Energon conduit, part 1: from under the fact panels down into the prize section */}
      <div className="pv-conduit absolute left-1/2 bottom-0 h-20 sm:h-24" aria-hidden="true"><i /><i /></div>

      {/* The section starts 6vh higher (over the hero's empty floor) so its backdrop covers more of the
          screen; the extra top padding keeps the headline where it was. */}
      <div className="relative min-h-[calc(100svh+6vh)] flex flex-col items-center justify-center px-4 pb-24 pt-[calc(6rem+6vh)] text-center">
        <p className="tf-kicker font-sans text-sm sm:text-lg font-semibold tracking-[0.06em] text-slate-200">
          KPR Institute of Engineering and Technology
          <span className="mx-2.5 text-amber-400">·</span>
          <span className="text-amber-300">Coimbatore</span>
        </p>
        <h2
          key={zap}
          onClick={() => { setScheme((n) => (n + 1) % SCHEMES.length); setZap((n) => n + 1); }}
          title="Click me"
          className={`mt-6 font-black uppercase leading-[0.88] tracking-tight cursor-pointer select-none ${zap ? 'tf-zap' : ''}`}
          style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '62%', fontSize: 'clamp(3rem, 10.5vw, 9.5rem)' }}
        >
          {lines.map((line, li) => (
            <span key={li} className="block">
              {line.words.map((word, k) => {
                const i = wi++;
                const from = k === 0 ? -1 : 1;
                return (
                  <span
                    key={word}
                    className={`tf-word inline-block ${line.cls}`}
                    style={{ ['--i' as string]: i, ['--from' as string]: from, marginRight: k === 0 ? '0.18em' : 0 }}
                  >
                    {word}
                  </span>
                );
              })}
            </span>
          ))}
        </h2>
        <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 w-full max-w-4xl">
          {facts.map((f, k) => (
            <div key={f.label} className="tf-stat" style={{ ['--k' as string]: k }}>
              <div className="tf-stat-in px-4 py-4 sm:py-5 text-left">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rotate-45 bg-cyan-400" />
                  <span className="text-xs sm:text-sm font-extrabold uppercase tracking-[0.16em] text-cyan-200" style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '112%', textShadow: '0 0 12px rgba(34,211,238,.45)' }}>{f.label}</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-black leading-none text-white text-2xl sm:text-4xl whitespace-nowrap" style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '62%', wordSpacing: '0.15em' }}>
                    {f.value}
                  </span>
                  <span className="font-plex text-[10px] sm:text-[11px] font-bold tracking-widest text-amber-300">{f.sub}</span>
                </div>
                <div className="mt-3 flex gap-1" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((b) => (
                    <span key={b} className={`h-1 flex-1 ${b <= k ? 'bg-amber-400/80' : 'bg-slate-700/70'}`} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ===================== PRIZE POOL SECTION ===================== */
// Deterministic golden motes so React re-renders don't reshuffle them.
const PRIZE_MOTES = Array.from({ length: 16 }, (_, i) => {
  const r = (n: number) => { const x = Math.sin(i * 41.17 + n * 13.3) * 9731.7; return x - Math.floor(x); };
  return { left: r(1) * 100, top: 12 + r(2) * 74, size: 2 + r(3) * 3.5, dur: 7 + r(4) * 7, delay: -r(5) * 12 };
});

function PrizePoolSection({ onExplore }: { onExplore: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  const [count, setCount] = useState(0);
  const TARGET = 100000;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0, started = false;
    const inView = () => {
      const r = node.getBoundingClientRect();
      return r.top < window.innerHeight * 0.8 && r.bottom > 0;
    };
    // Idempotent: whichever trigger (observer / scroll / initial check) fires first wins.
    const start = () => {
      if (started) return;
      started = true;
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
      setShown(true);
      if (reduce) { setCount(TARGET); return; }
      const DUR = 1800, t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - t0) / DUR, 1);
        setCount(Math.round(TARGET * (1 - Math.pow(1 - p, 3))));   // easeOutCubic
        if (p < 1) raf = requestAnimationFrame(tick); else setCount(TARGET);
      };
      raf = requestAnimationFrame(tick);
      // Safety net: if rAF is throttled (e.g. backgrounded), land on the final value.
      setTimeout(() => { if (count < TARGET) setCount(TARGET); }, DUR + 400);
    };
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) start(); }, { threshold: 0.3 });
    io.observe(node);
    const onScroll = () => { if (inView()) start(); };
    window.addEventListener('scroll', onScroll, { passive: true });
    if (inView()) start();             // already visible on mount
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = count >= TARGET;
  const amount = '₹' + count.toLocaleString('en-IN');

  return (
    <section
      ref={ref}
      aria-label="Overall prize pool: one lakh rupees and above"
      className={`prize-sec relative z-10 overflow-hidden pt-16 pb-24 sm:pt-24 sm:pb-28 px-4 ${shown ? 'prize-in' : 'prize-pre'}`}
    >
      {/* Backdrop — "the AllSpark vault": dark Cybertron steel lit gold from the centre, a giant
          vault-door mechanism turning slowly behind the trophy, energon light pillars, a faint
          glyph wall and a glowing grid floor. Transform-only motion, so it stays smooth. */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_28%,#2a1d06_0%,#0b0f1c_55%,#03050b_100%)]" />
        <div className="pv-glyphs absolute inset-0 opacity-[0.08]" />
        {/* Seam: the top fades from the techno-fest section's dark steel, and its hex grid carries on and dissolves */}
        <div className="absolute inset-x-0 top-0 h-[22rem] bg-gradient-to-b from-[#03050b] via-[#03050b]/70 to-transparent" />

        <div className="pv-beam absolute bottom-0 left-[8%] w-[18vw] max-w-[220px] h-[85%]" />
        <div className="pv-beam pv-beam-r absolute bottom-0 right-[8%] w-[18vw] max-w-[220px] h-[85%]" />
        {/* Vault-door chakra: kept behind the headline only, dimmed and faded out above the hackathon podium */}
        <div className="pv-vault-wrap absolute inset-0 opacity-70">
        <svg className="pv-vault absolute left-1/2 top-[13rem] sm:top-[15rem] w-[min(120vw,980px)] h-auto" viewBox="0 0 400 400" fill="none">
          <circle cx="200" cy="200" r="196" stroke="rgba(250,204,21,.28)" strokeWidth="1.2" />
          <circle cx="200" cy="200" r="186" stroke="rgba(250,204,21,.16)" strokeWidth="7" strokeDasharray="3 9" />
          <circle cx="200" cy="200" r="168" stroke="rgba(148,197,255,.16)" strokeWidth="1" strokeDasharray="60 18 8 18" />
          <g stroke="rgba(250,204,21,.14)" strokeWidth="1">
            {Array.from({ length: 12 }, (_, i) => {
              const a = (i / 12) * Math.PI * 2;
              return <line key={i} x1={200 + Math.cos(a) * 120} y1={200 + Math.sin(a) * 120} x2={200 + Math.cos(a) * 164} y2={200 + Math.sin(a) * 164} />;
            })}
          </g>
        </svg>
        <svg className="pv-vault pv-vault-in absolute left-1/2 top-[13rem] sm:top-[15rem] w-[min(78vw,640px)] h-auto" viewBox="0 0 400 400" fill="none">
          <circle cx="200" cy="200" r="190" stroke="rgba(250,204,21,.3)" strokeWidth="2" strokeDasharray="120 30" />
          <circle cx="200" cy="200" r="176" stroke="rgba(34,211,238,.18)" strokeWidth="1" />
        </svg>
        </div>
        <div className="pv-floor absolute inset-x-0 bottom-0 h-[38%]" />
        {/* Bottom seam: floor and light pillars dissolve into the events section's dark steel (no hard edge) */}
        <div className="absolute inset-x-0 bottom-0 h-40 sm:h-56 bg-gradient-to-b from-transparent via-[#03050b]/75 to-[#03050b]" />
        {/* Energon conduit, part 2: continues from the section above and feeds the trophy */}
        <div className="pv-conduit absolute left-1/2 top-0 h-16 sm:h-24" aria-hidden="true"><i /><i /></div>
      </div>
      <div className="prize-glow absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2 w-[min(64vw,540px)] h-[min(64vw,540px)] rounded-full pointer-events-none" aria-hidden="true" />
      {PRIZE_MOTES.map((m, i) => (
        <span key={i} className="prize-mote absolute rounded-full" aria-hidden="true"
          style={{ left: `${m.left}%`, top: `${m.top}%`, width: m.size, height: m.size,
                   animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s` }} />
      ))}

      <div className="relative max-w-4xl mx-auto flex flex-col items-center text-center">
        {/* Trophy — assembles transformer-style on reveal, then a mechanical 3D idle */}
        <div className="prize-trophy" aria-hidden="true">
          <div className="tr-3d">
            <svg viewBox="0 0 200 220" width="150" height="165" className="block w-[clamp(120px,22vw,190px)] h-auto">
              <defs>
                <linearGradient id="goldCup" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#fff3b0" /><stop offset="0.4" stopColor="#f6c945" />
                  <stop offset="0.72" stopColor="#d99a1c" /><stop offset="1" stopColor="#a86f0e" />
                </linearGradient>
                <linearGradient id="goldRim" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#b9820f" /><stop offset="0.5" stopColor="#ffe794" /><stop offset="1" stopColor="#b9820f" />
                </linearGradient>
                <radialGradient id="base" cx="0.5" cy="0.3" r="0.8">
                  <stop offset="0" stopColor="#2a2f3a" /><stop offset="1" stopColor="#0a0d14" />
                </radialGradient>
              </defs>
              {/* handles swing in from the sides */}
              <path className="tr-hL" d="M44 54 C14 54 14 104 54 108" fill="none" stroke="url(#goldRim)" strokeWidth="9" strokeLinecap="round" />
              <path className="tr-hR" d="M156 54 C186 54 186 104 146 108" fill="none" stroke="url(#goldRim)" strokeWidth="9" strokeLinecap="round" />
              {/* cup drops in */}
              <g className="tr-cup">
                <path d="M48 46 H152 V72 C152 112 128 134 100 134 C72 134 48 112 48 72 Z" fill="url(#goldCup)" stroke="#8a5c08" strokeWidth="1.5" />
                <rect x="44" y="40" width="112" height="10" rx="5" fill="url(#goldRim)" />
                <path d="M70 58 Q72 96 100 112" fill="none" stroke="#fff6cf" strokeWidth="4" strokeLinecap="round" opacity="0.65" />
              </g>
              {/* stem + base rise up */}
              <g className="tr-base">
                <rect x="92" y="134" width="16" height="22" fill="url(#goldCup)" />
                <path d="M74 156 H126 L120 170 H80 Z" fill="url(#goldCup)" stroke="#8a5c08" strokeWidth="1" />
                <ellipse cx="100" cy="188" rx="66" ry="16" fill="url(#base)" />
                <rect x="64" y="172" width="72" height="12" rx="4" fill="url(#goldRim)" />
              </g>
              {/* star pops last */}
              <path className="tr-star" d="M100 74 l5.3 10.8 11.9 1.7 -8.6 8.4 2 11.9 -10.6 -5.6 -10.6 5.6 2 -11.9 -8.6 -8.4 11.9 -1.7 Z" fill="#fff6cf" opacity="0.9" />
              <g className="prize-sweep"><rect x="0" y="0" width="60" height="220" fill="url(#goldRim)" opacity="0.5" /></g>
            </svg>
          </div>
        </div>

        <p className="prize-rise prize-eyebrow mt-6 text-xs sm:text-sm font-mono font-bold tracking-[0.5em] text-amber-300/90 uppercase" style={{ animationDelay: '.1s' }}>
          The Battle for Glory
        </p>
        <div className="prize-rise relative" style={{ animationDelay: '.22s' }}>
          <div className="prize-amount gold-text font-black leading-none tracking-tight" style={{ fontSize: 'clamp(3rem, 13vw, 8rem)' }}>
            {amount}<span className={`prize-plus ${done ? 'prize-plus-on' : ''}`}>+</span>
          </div>
          <span className="prize-heading-sweep" aria-hidden="true" />
        </div>
        <h2 className="prize-rise metal-text font-black uppercase tracking-[0.18em] mt-2" style={{ fontSize: 'clamp(1.1rem, 3.4vw, 2rem)', animationDelay: '.34s' }}>
          Overall Prize Pool
        </h2>

        {/* Hackathon podium: 2nd · WINNER · 3rd */}
        <div className="prize-rise mt-14 sm:mt-16 w-full" style={{ animationDelay: '.5s' }}>
          <div className="flex items-center justify-center gap-3">
            <span className="h-2 w-2 rotate-45 bg-amber-400" />
            <h3 className="text-lg sm:text-2xl font-black uppercase tracking-wide text-amber-300" style={{ fontStretch: '110%' }}>BUMBLEBEE HACKATHON</h3>
            <span className="h-2 w-2 rotate-45 bg-amber-400" />
          </div>
          <div className="mt-6 sm:mt-8 grid grid-cols-3 items-end gap-2 sm:gap-8">
            {[
              { rank: '2ND PLACE', amt: 20000, cls: 'pz-silver', size: 'clamp(1.6rem, 6vw, 4rem)', lift: '' },
              { rank: 'WINNER', amt: 30000, cls: 'pz-gold', size: 'clamp(2.1rem, 8.5vw, 5.75rem)', lift: 'pb-4 sm:pb-8' },
              { rank: '3RD PLACE', amt: 10000, cls: 'pz-bronze', size: 'clamp(1.6rem, 6vw, 4rem)', lift: '' }
            ].map((pz) => (
              <div key={pz.rank} className={`flex flex-col items-center ${pz.lift}`}>
                <span className={`font-plex text-[10px] sm:text-xs font-bold tracking-[0.35em] ${pz.rank === 'WINNER' ? 'text-amber-300' : 'text-slate-300'}`}>{pz.rank}</span>
                <span className="mt-1 mb-2 h-px w-10 sm:w-16 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" aria-hidden="true" />
                <span className={`${pz.cls} font-black leading-none tabular-nums`} style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '62%', fontSize: pz.size }}>
                  {inr(pz.amt)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Technical / non-technical events: chamfered Cybertron plates */}
        <div className="prize-rise mt-14 sm:mt-16 grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 w-full max-w-3xl" style={{ animationDelay: '.62s' }}>
          {[
            { title: 'TECHNICAL EVENTS', note: 'Presentations', accent: 'text-cyan-300', dot: 'bg-cyan-400', prizes: [5000, 3000, 2000] },
            { title: 'NON-TECHNICAL EVENTS', note: 'Photography · Gaming · Quiz', accent: 'text-fuchsia-300', dot: 'bg-fuchsia-400', prizes: [1500, 1000, 500] }
          ].map((ev) => (
            <div key={ev.title} className="tf-stat h-full" style={{ ['--k' as string]: 0, opacity: 1, transform: 'none' }}>
              {/* h-full: the dark panel fills the whole plate, so the gold edge layer never shows below it */}
              <div className="tf-stat-in h-full px-5 sm:px-6 py-5 text-left">
                <div className="flex items-center gap-2.5">
                  <span className={`h-2 w-2 rotate-45 ${ev.dot}`} />
                  <h3 className={`text-base sm:text-lg font-black uppercase tracking-wide whitespace-nowrap ${ev.accent}`} style={{ fontStretch: '110%' }}>{ev.title}</h3>
                </div>
                <p className="mt-1.5 text-sm text-slate-400">{ev.note}</p>
                {/* Size steps down 1st → 2nd → 3rd so the top prize reads first */}
                <div className="mt-5 space-y-3">
                  {ev.prizes.map((amt, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3 border-b border-slate-800/80 pb-3 last:border-0 last:pb-0">
                      <span className={`text-sm font-bold uppercase tracking-wider ${i === 0 ? 'text-amber-300' : 'text-slate-400'}`}>
                        {['1st Prize', '2nd Prize', '3rd Prize'][i]}
                      </span>
                      <span
                        className={`font-black leading-none tabular-nums ${['pz-gold', 'pz-silver', 'pz-bronze'][i]}`}
                        style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '62%', fontSize: ['clamp(2.4rem, 5vw, 3.1rem)', 'clamp(1.7rem, 3.4vw, 2.1rem)', 'clamp(1.35rem, 2.6vw, 1.6rem)'][i] }}
                      >
                        {inr(amt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="prize-rise mt-12" style={{ animationDelay: '.74s' }}>
          <button onClick={onExplore} className="enter-btn inline-flex items-center gap-3 px-10 py-4 rounded-xl text-sm font-black uppercase tracking-[0.22em]">
            <span className="enter-sheen" aria-hidden="true" />
            <span className="relative">Explore Events</span>
            <ChevronRight className="relative w-5 h-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

/* Small L-shaped HUD corner brackets used on the tactical panels. */
function HudCorners({ accent = 'cyan' }: { accent?: 'cyan' | 'amber' }) {
  const c = accent === 'amber' ? 'border-amber-400/60' : 'border-cyan-400/60';
  return (
    <>
      <span className={`absolute top-0 left-0 w-2.5 h-2.5 border-t border-l ${c}`} />
      <span className={`absolute top-0 right-0 w-2.5 h-2.5 border-t border-r ${c}`} />
      <span className={`absolute bottom-0 left-0 w-2.5 h-2.5 border-b border-l ${c}`} />
      <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 border-b border-r ${c}`} />
    </>
  );
}

/* ============================ APP ================================= */
export default function App() {
  const [activeHero, setActiveHero] = useState<string | null>(null);
  // Certificate and My Pass are their own pages (#certificate, #mypass), so Back/Forward and shared links work.
  // Click burst: gold/cyan sparks at the pointer on every click (skipped for reduce-motion).
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const COLORS = ['#facc15', '#fbbf24', '#fde68a', '#22d3ee', '#ffffff'];
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const burst = document.createElement('div');
      burst.className = 'click-burst';
      burst.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      burst.innerHTML = '<span class="cb-ring"></span>';
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
        const d = 22 + Math.random() * 18;
        const sp = document.createElement('span');
        sp.className = i % 3 === 0 ? 'cb-spark cb-shard' : 'cb-spark';
        sp.style.background = COLORS[i % COLORS.length];
        sp.style.setProperty('--dx', `${Math.cos(a) * d}px`);
        sp.style.setProperty('--dy', `${Math.sin(a) * d}px`);
        sp.style.setProperty('--rot', i % 3 === 0 ? '45deg' : '0deg');
        burst.appendChild(sp);
      }
      document.body.appendChild(burst);
      window.setTimeout(() => burst.remove(), 600);
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);
  const [subPage, setSubPage] = useState<SubPage>(subPageFromHash);
  const [profile, setProfile] = useState<Profile | null>(currentProfile);
  useEffect(() => {
    const sync = () => setSubPage(subPageFromHash());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  // Leaving a sub-page drops its hash so the home page shows again.
  const leaveSubPage = () => {
    if (subPageFromHash()) history.pushState(null, '', window.location.pathname + window.location.search);
    setSubPage(null);
  };
  // First visit to each hero plays the transformation sequence (3D assembly + HUD).
  const visitedRef = useRef<Set<string>>(new Set());
  const [intro, setIntro] = useState<{ key: string; id: number } | null>(null);
  useEffect(() => {
    if (!intro) return;
    const id = setTimeout(() => setIntro(null), 4600);
    return () => clearTimeout(id);
  }, [intro]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Entry screen: its click is the user gesture browsers require before any audio can play.
  const [gate, setGate] = useState<'show' | 'leaving' | 'gone'>('show');
  // Build the heavy 3D scene just after the entry screen has painted, so the logo
  // appears instantly instead of waiting behind the scene construction. A timer (not
  // requestAnimationFrame) is used so it also fires on a hidden/background tab.
  const [mount3D, setMount3D] = useState(false);
  const heroTitleRef = useRef<HTMLHeadingElement>(null);   // home hero "OPTIMUS '27"
  const burstRef = useRef<HTMLDivElement>(null);           // the title that flies in on ENTER
  useEffect(() => {
    // The entry insignia's onLoad mounts the 3D scene once the logo has painted, so the
    // heavy scene build never delays the ENTER button. This is only a fallback.
    const id = window.setTimeout(() => setMount3D(true), 1400);
    return () => clearTimeout(id);
  }, []);
  // Loading order, so nothing janks in front of the user: the static HTML splash (logo + title,
  // no JS needed) stays up while the insignia is decoded AND the heavy 3D scene is built behind it.
  // Only then does the entry screen reveal, with the logo and title rising together, and ENTER
  // finds the scene already built — no build work lands on top of an animation.
  const [logoReady, setLogoReady] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const gateReady = logoReady && sceneReady;
  useEffect(() => {
    const im = new Image();
    im.src = BASE + 'assets/logo-hd.webp';
    const ready = () => setLogoReady(true);
    im.decode().then(ready, ready);
    const id = window.setTimeout(ready, 1500);   // never hold the page on a slow network
    setMount3D(true);                            // start the 3D build now, under the splash
    const sceneFallback = window.setTimeout(() => setSceneReady(true), 8000);   // no WebGL / hidden tab / very slow GPU
    return () => { clearTimeout(id); clearTimeout(sceneFallback); };
  }, []);
  // The HTML intro (index.html) shows for at least INTRO_MIN, and keeps spinning until the logo and
  // 3D scene are ready. Then it fades out and the entry screen starts its own reveal.
  const [introDone, setIntroDone] = useState(() => !document.getElementById('splash'));
  useEffect(() => {
    if (!gateReady) return;
    const s = document.getElementById('splash');
    if (!s) { setIntroDone(true); return; }
    const INTRO_MIN = 1800;   // long enough for one clean spin of the chakra
    const started = (window as Window & { __introStart?: number }).__introStart ?? 0;
    const wait = Math.max(0, INTRO_MIN - (performance.now() - started));
    let removeId = 0;
    const outId = window.setTimeout(() => {
      s.classList.add('sp-out');
      setIntroDone(true);
      removeId = window.setTimeout(() => s.remove(), 550);
    }, wait);
    return () => { clearTimeout(outId); clearTimeout(removeId); };
  }, [gateReady]);
  // Becomes true as the entry screen starts to open: resumes the 3D scene and eases the site in.
  const [entered, setEntered] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Header is see-through at the very top and gains a dark background once the page scrolls.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);   // React skips the re-render when unchanged
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const [isRegisterOpen, setIsRegisterOpen] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  /* ---- content from the admin panel ---- */
  const [, setContentRev] = useState(0);   // bumped after admin event edits are applied, to re-render
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissedNotices, setDismissedNotices] = useState<string[]>([]);
  useEffect(() => {
    recordVisit();
    const overrides = listOverrides();
    if (Object.keys(overrides).length) { applyOverrides(overrides); setContentRev((r) => r + 1); }
    setAnnouncements(listAnnouncements().filter((a) => a.active));
  }, []);
  const notices = announcements.filter((a) => !dismissedNotices.includes(a.id)).slice(0, 3);

  const [formData, setFormData] = useState({
    pass: 'hackathon' as PassId,
    day: 0,
    teamSize: 2,
    teamName: '',
    // Members 2–4 of a hackathon team, added by Optimus ID + name. The leader is the signed-in user.
    members: [{ id: '', name: '' }, { id: '', name: '' }, { id: '', name: '' }]
  });
  const teamMembers = formData.members.slice(0, formData.teamSize - 1);
  // Live check for each teammate row (ID format, exists, name matches, no repeats).
  const memberChecks: (MemberCheck | null)[] = teamMembers.map((m, i) => {
    if (!m.id.trim() && !m.name.trim()) return null;
    const others = [profile?.id ?? '', ...teamMembers.slice(0, i).map((o) => o.id.trim())];
    return checkMember(m.id.trim(), m.name, others);
  });
  const pass = passById(formData.pass);
  const pt = THEME[pass.theme];
  const passQty = pass.team ? formData.teamSize : 1;
  const passTotal = pass.price * passQty;
  const passValid = pass.pickDay ? `${FEST_DAYS[formData.day]} ONLY` : pass.valid;

  const active = heroByKey(activeHero);
  // Theme of the register popup's frame: the leader page's colours on the "get your ID first" screen.
  const idT = !profile && !registerSuccess && active ? THEME[active.theme] : pt;
  // Content waits for the armour to lock in on a first visit; otherwise it just eases in.
  const introPlaying = !!intro && !!active && intro.key === active.key;
  const introDelay = (extra: number) => `${(introPlaying ? 3.6 : 0.05) + extra}s`;
  const t = THEME[active ? active.theme : 'amber'];

  /* ---- navigation ---- */
  const goHero = useCallback((key: string) => {
    if (!visitedRef.current.has(key)) {
      visitedRef.current.add(key);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) audioFX.playTransform();
      setIntro({ key, id: Date.now() });
    }
    setActiveHero(key);
    leaveSubPage();
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const goHome = useCallback(() => {
    setActiveHero(null);
    leaveSubPage();
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const goSubPage = useCallback((page: 'certificate' | 'mypass') => {
    setActiveHero(null);
    setMobileMenuOpen(false);
    setIsRegisterOpen(false);
    if (window.location.hash !== `#${page}`) history.pushState(null, '', `#${page}`);
    setSubPage(page);
    window.scrollTo({ top: 0 });
  }, []);
  const goCertificate = useCallback(() => goSubPage('certificate'), [goSubPage]);
  const goMyPass = useCallback(() => goSubPage('mypass'), [goSubPage]);
  // The passes section lives on the home page, so leave any hero page first.
  const goPasses = useCallback(() => {
    setActiveHero(null);
    leaveSubPage();
    setMobileMenuOpen(false);
    setTimeout(() => glideTo(document.getElementById('passes')), 80);
  }, []);

  // Leaders list sits on the home page too, so leave any hero page first (phone action bar).
  const goRoster = useCallback(() => {
    setActiveHero(null);
    leaveSubPage();
    setMobileMenuOpen(false);
    setTimeout(() => glideTo(document.getElementById('roster')), 80);
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    audioFX.setMuted(!next);
    if (next) audioFX.start();
  };

  // The ENTER click is the user gesture browsers require before audio can play.
  // Sequence (~2.3s): the insignia grows broad, dissolves into an OPTIMUS '27 title,
  // then the backdrop opens onto the arena. A ref guards against double activation.
  const enteringRef = useRef(false);
  const enterSite = useCallback(() => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setMount3D(true);   // tapped before the scene was built: start it now, under the ENTER hold
    audioFX.setMuted(false);
    setSoundEnabled(true);
    audioFX.start();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setEntered(true);
      setGate('gone');
      return;
    }
    // Sequence: the big OPTIMUS '27 appears and HOLDS on the dark backdrop for ~1s, then
    // flies down and lands exactly on the home hero title (FLIP) as the backdrop opens.
    const HOLD = 1000, APPEAR = 400, FLY = 900;
    setGate('leaving');
    const hero = heroTitleRef.current, burst = burstRef.current;
    if (!hero || !burst) { setEntered(true); setTimeout(() => setGate('gone'), 400); return; }
    // Measure the landing target now (the home hero title is already in the DOM behind the gate).
    burst.style.transition = 'none';
    burst.style.transform = 'none';
    burst.style.opacity = '0';
    void burst.offsetWidth;
    const h = hero.getBoundingClientRect(), b = burst.getBoundingClientRect();
    const scale = h.height / b.height;
    const dx = (h.left + h.width / 2) - (b.left + b.width / 2);
    const dy = (h.top + h.height / 2) - (b.top + b.height / 2);
    // appear (slight settle) and stand — timers (not rAF) so it runs even in a background tab
    burst.style.transform = 'scale(1.12)';
    void burst.offsetWidth;
    setTimeout(() => {
      burst.style.transition = `transform ${APPEAR}ms cubic-bezier(.2,.8,.2,1), opacity ${APPEAR}ms ease`;
      burst.style.transform = 'scale(1)';
      burst.style.opacity = '1';
    }, 30);
    // after the hold, reveal the home and fly the title to the hero slot
    setTimeout(() => {
      setEntered(true);
      setTimeout(() => {
        burst.style.transition = `transform ${FLY}ms cubic-bezier(.3,.72,.2,1), opacity ${FLY * 0.4}ms ease ${FLY * 0.6}ms`;
        burst.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
        burst.style.opacity = '0';
      }, 40);
    }, APPEAR + HOLD);
    setTimeout(() => setGate('gone'), APPEAR + HOLD + FLY + 60);
  }, []);
  // Enter / Space anywhere on the entry screen also enters (the button handles its own keys).
  useEffect(() => {
    if (gate !== 'show' || !introDone) return;   // not while the intro is still playing
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      enterSite();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gate, enterSite, introDone]);

  const openRegister = (passId?: PassId) => {
    if (passId) setFormData((f) => ({ ...f, pass: passId }));
    setSelectedEvent(null);
    setRegisterSuccess(false);
    setIsRegisterOpen(true);
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    if (pass.team) {
      const bad = memberChecks.findIndex((c) => c !== 'ok');
      if (bad !== -1) {
        const why: Record<MemberCheck, string> = {
          'ok': '',
          'bad-format': 'enter a valid Optimus ID (e.g. OPT27-00142)',
          'not-found': 'no participant has this Optimus ID yet — they must get their own ID first',
          'name-mismatch': 'the name does not match this Optimus ID (use capital letters, exactly as registered)',
          'duplicate': 'this Optimus ID is already in the team'
        };
        window.alert(`Member ${bad + 2}: ${memberChecks[bad] ? why[memberChecks[bad]!] : 'enter their Optimus ID and name'}.`);
        return;
      }
    }
    addRegistration({
      pass: pass.id,
      day: pass.pickDay ? formData.day : null,
      team_name: pass.team ? formData.teamName.trim() : null,
      leader_name: `${profile.name} (${profile.id})`,
      members: pass.team ? teamMembers.map((m) => `${normalizeName(m.name)} (${m.id.trim()})`) : [],
      email: profile.email,
      phone: profile.phone,
      college: profile.college,
      amount: passTotal
    });
    setRegisterSuccess(true);
  };

  /* ---- modal escape / scroll lock ---- */
  const anyModal = isRegisterOpen || !!selectedEvent;
  useEffect(() => {
    if (!anyModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsRegisterOpen(false);
        setSelectedEvent(null);
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [anyModal]);

  // Events section order and sides: cards alternate right / left; each robot enters from its card's
  // side, stands in the open half beside it, then leaves off the far edge.
  const STAGE_ORDER: { key: string; card: 'left' | 'right' }[] = [
    { key: 'bumblebee', card: 'right' },
    { key: 'megatron', card: 'left' },
    { key: 'shockwave', card: 'right' },
    { key: 'ratchet', card: 'left' }
  ];
  const stageRef = useRef<StageState>({ key: null, u: 0, introId: 0, introKey: '', fromU: 0, standU: 0, enterU: 0, leaveKey: '', leaveU: 0, settled: false });
  const stagedOnce = useRef(new Set<string>());   // leaders that already did their first-time transform
  const EMPTY_STAGE = '__empty__';   // stage key that matches no leader: every robot hidden
  const [deckPass, setDeckPass] = useState<number | null>(null);   // pass raised out of the deck (hover / focus); null = deck at rest
  const sceneReadyRef = useRef(false);
  sceneReadyRef.current = sceneReady;
  useEffect(() => {
    const st = stageRef.current;
    if (activeHero || subPage || gate !== 'gone') { st.key = null; return; }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    let raf = 0;
    let lastY = window.scrollY;
    let prev: { key: string; from: number; exit: number } | null = null;   // leader on stage last update

    // Scroll stop: when the user's own downward scrolling reaches a leader's card (its row pins), the page
    // holds there until that robot has finished arriving — the full drive-in + transform the first time,
    // otherwise just its walk to its mark. However fast you scroll, every robot stands before it leaves.
    // Scrolling up is never held, and only wheel / touch / keyboard scrolling counts, so the TOP and HOME
    // buttons, nav links and anything else that scrolls the page go straight through.
    let lock: { y: number; key: string; t0: number; max: number } | null = null;
    let lastInput = 0;
    let lastStop: { key: string; y: number } | null = null;   // a stop never catches twice until you have moved well away
    const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'End', 'Home']);
    const onInput = (e: Event) => {
      lastInput = performance.now();
      if (lock && e.cancelable) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key) || (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')) return;
      onInput(e);
    };
    const holdTo = (y: number) => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
    const watchLock = () => {
      if (!lock) return;
      const now = performance.now();
      if ((st.settled && st.key === lock.key && now - lock.t0 > 120) || now - lock.t0 > lock.max) { lock = null; return; }
      if (Math.abs(window.scrollY - lock.y) > 1) holdTo(lock.y);
      requestAnimationFrame(watchLock);
    };

    const update = () => {
      raf = 0;
      const down = window.scrollY >= lastY;
      if (lock) {
        if (Math.abs(window.scrollY - lock.y) > 1) holdTo(lock.y);
      } else if (down && !reduce && sceneReadyRef.current && window.innerWidth >= 1024 && performance.now() - lastInput < 500) {
        // The first stop this scroll step crossed (a fast flick can cross several in one frame).
        const y = window.scrollY, vh = window.innerHeight;
        let stop: { y: number; key: string } | null = null;
        document.querySelectorAll<HTMLElement>('[data-stage-row]').forEach((row) => {
          const top = row.getBoundingClientRect().top + y;   // the card pins here
          if (lastY < top - 2 && top <= y + 2 && (!stop || top < stop.y)) stop = { y: top, key: row.dataset.stageRow! };
        });
        if (stop && lastStop && Math.abs((stop as { y: number }).y - lastStop.y) < 4) stop = null;
        if (lastStop && Math.abs(y - lastStop.y) > vh) lastStop = null;
        if (stop) {
          const { y: sy, key } = stop as { y: number; key: string };
          lock = { y: sy, key, t0: performance.now(), max: stagedOnce.current.has(key) ? 2500 : 6500 };
          lastStop = { key, y: sy };
          st.settled = false;
          holdTo(sy);
          requestAnimationFrame(watchLock);
        }
      }
      lastY = window.scrollY;
      // A fast scroll can skip a leader's walk-out entirely. Whoever loses the stage is told which
      // edge to keep walking to (exit going down, back where it came from going up), so robots
      // always leave the screen instead of fading out mid-floor.
      const handOver = (next: string | null) => {
        if (prev && prev.key !== next) { st.leaveKey = prev.key; st.leaveU = down ? prev.exit : prev.from; }
        if (!next || next === EMPTY_STAGE) prev = null;
      };
      // Laptops and desktops only: on phones the cards fill the width, so there is no open stage half.
      if (window.innerWidth < 1024) { st.key = null; prev = null; return; }
      // Each row is taller than the screen and its card pins (sticky) for the extra height — the "stop".
      // The row crossing the screen's middle line owns the stage:
      //   row top   vh/2 → 0  : robot walks in from the card's side (off screen → stand)
      //   pinned               : robot stands beside the card
      //   row bottom vh → vh/2 : robot walks out the far side
      // Neighbouring rows hand over exactly at the middle line, both robots off screen.
      const vh = window.innerHeight;
      const rows = [...document.querySelectorAll<HTMLElement>('[data-stage-row]')];
      const row = rows.find((r) => { const b = r.getBoundingClientRect(); return b.top <= vh / 2 && b.bottom >= vh / 2; });
      if (!row) {
        // Outside the events: robots go home only while the main page's hero is on screen;
        // anywhere else the stage stays empty.
        st.key = window.scrollY < vh * 0.9 ? null : EMPTY_STAGE;
        handOver(st.key);
        return;
      }
      const r = row.getBoundingClientRect();
      const key = row.dataset.stageRow!;
      const card = row.dataset.card as 'left' | 'right';
      const side = card === 'right' ? 1 : -1;     // the card's side of the screen
      const from = side * 1.4, stand = -side * 0.5, exit = -side * 1.4;
      const k = (x: number) => ease(Math.min(1, Math.max(0, x)));
      const u = r.top > 0 ? from + (stand - from) * k(1 - r.top / (vh / 2))
        : r.bottom < vh ? stand + (exit - stand) * k(1 - (r.bottom - vh / 2) / (vh / 2))
        : stand;
      const entering = r.bottom >= vh;
      if (!stagedOnce.current.has(key) && !reduce && entering) {
        stagedOnce.current.add(key);
        st.introId += 1;
        st.introKey = key;
        st.fromU = from;
        st.standU = stand;
        audioFX.playTransform();
      }
      handOver(key);
      if (prev?.key !== key) st.enterU = down ? from : exit;
      prev = { key, from, exit };
      st.key = key;
      st.u = u;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('wheel', onInput, { passive: false });
    window.addEventListener('touchmove', onInput, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      lock = null;
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('wheel', onInput);
      window.removeEventListener('touchmove', onInput);
      window.removeEventListener('keydown', onKey);
      st.key = null;
    };
  }, [activeHero, subPage, gate]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-400 selection:text-black relative overflow-x-clip">

      {/* Themed targeting-reticle cursor (recolors with the active faction) */}
      <style dangerouslySetInnerHTML={{ __html: buildCursorCss(CURSOR_HEX[active ? active.theme : 'amber']) }} />

      {/* 3D leaders background */}
      <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />
      {mount3D && <ThreeHeroBackground activeHero={activeHero} onSelectHero={goHero} intro={intro} paused={!entered} onReady={() => setSceneReady(true)} stage={stageRef} />}
      {/* Dims the 3D arena while the techno-fest section takes over (home page only; see .scene-dim) */}
      {!active && !subPage && <div className="scene-dim fixed inset-0 z-0 pointer-events-none" aria-hidden="true" />}

      {/* Transformation HUD — only on the first visit to each hero */}
      {intro && active && intro.key === active.key && (
        <>
          <div
            key={'flash' + intro.id}
            className="fixed inset-0 z-30 pointer-events-none hud-flash"
            style={{ background: `radial-gradient(circle at 50% 58%, ${CURSOR_HEX[active.theme]}66, transparent 62%)` }}
          />
          <div key={'hud' + intro.id} className="fixed left-1/2 -translate-x-1/2 bottom-8 z-40 pointer-events-none w-[min(92vw,520px)]">
            <div className={`hud-in rounded-2xl border ${t.ring} bg-slate-950/90 px-5 py-4 font-mono`}>
              <div className="flex items-center justify-between text-[10px] tracking-[0.3em] text-slate-400">
                <span>TRANSFORMATION SEQUENCE</span>
                <span className={t.text}>● LIVE</span>
              </div>
              <div className={`mt-1 text-lg sm:text-xl font-black tracking-widest ${t.text}`}>
                {active.name} <span className="text-slate-200">ONLINE</span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                <div className={`h-full ${t.dot} hud-bar`} />
              </div>
              <div className="mt-2 text-[10px] text-slate-500 tracking-widest">VEHICLE INBOUND · TRANSFORMING · SYSTEMS ONLINE</div>
            </div>
          </div>
        </>
      )}


      {/* Entry screen — midnight stage with the Autobot insignia, OPTIMUS '27 and ENTER.
          The ENTER click is also the gesture that unlocks audio. */}
      {gate !== 'gone' && (
        <div
          className={`fixed inset-0 z-[70] overflow-hidden ${gate === 'leaving' ? 'gate-leave' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label="OPTIMUS '27 — enter the site"
        >
          {/* backdrop layers (fade out on ENTER to reveal the arena) */}
          <div className="gate-stage absolute inset-0 gate-bg">
            <div className="gate-beam" style={{ left: '4%', ['--r0' as string]: '-18deg', ['--r1' as string]: '-8deg' } as React.CSSProperties} />
            <div className="gate-beam" style={{ right: '4%', ['--r0' as string]: '18deg', ['--r1' as string]: '8deg' } as React.CSSProperties} />
            <div className="gate-grid" />
            {GATE_MOTES.map((m, i) => (
              <span
                key={i}
                className="gate-mote"
                style={{
                  left: `${m.left}%`, width: m.size, height: m.size,
                  background: m.color,
                  boxShadow: `0 0 ${m.size * 3}px ${m.color}`,
                  animationDuration: `${m.dur}s`, animationDelay: `${m.delay}s`
                }}
              />
            ))}
            <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.75) 100%)' }} />
          </div>

          {/* OPTIMUS '27 that zooms in and settles into the home hero's place on ENTER */}
          <div className="gate-title-burst absolute inset-0 flex items-center justify-center pointer-events-none px-4" aria-hidden="true">
            <div ref={burstRef} className="opt-word font-black uppercase leading-none tracking-tight text-center whitespace-nowrap" style={{ fontSize: 'clamp(2.2rem, min(11vw, 15vh), 10.5rem)', opacity: 0 }}>
              <span className="metal-text">OPTIMUS</span> <span className="gold-text">'27</span>
            </div>
          </div>

          <div
            className={`gate-content relative h-full flex flex-col items-center justify-center text-center px-5 ${gateReady && introDone ? '' : 'gate-hold'}`}
            style={{ gap: 'clamp(12px, 2.8vh, 28px)' }}
          >
            <div className="gate-rise gate-fade inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 text-[10px] sm:text-xs font-mono font-bold tracking-[0.3em] text-amber-200 shadow-[0_0_18px_rgba(250,204,21,0.12)]">
              <Sparkles className="w-3.5 h-3.5" /> NATIONAL LEVEL TECHNO FEST
            </div>

            <h1
              className="gate-rise gate-fade font-black uppercase leading-[0.9] tracking-tight whitespace-nowrap"
              style={{ fontSize: 'clamp(2rem, min(9vw, 12vh), 8rem)', animationDelay: '.1s' }}
            >
              <span className="metal-text">OPTIMUS</span> <span className="gold-text">'27</span>
            </h1>

            <div className="gate-rise gate-fade flex flex-col items-center gap-3" style={{ animationDelay: '.28s' }}>
              <div className="h-px w-[min(72vw,440px)] bg-gradient-to-r from-transparent via-amber-300/80 to-transparent" />
              <p className="font-bold uppercase tracking-[0.16em] text-slate-200 text-[clamp(0.78rem,1.7vw,1rem)] leading-relaxed">
                KPR Institute of Engineering and Technology <span className="text-slate-500">·</span>{' '}
                <span className="text-amber-300 whitespace-nowrap">Feb 4–5, 2027</span>
              </p>
            </div>

            {/* ENTER: the Autobot insignia. On click it flies to the screen centre, zooms
                up huge and vanishes into the site (offsets measured at click time). */}
            <div className="emblem-in mt-[clamp(8px,2vh,20px)]" style={{ animationDelay: '.1s' }}>
              <button
                type="button"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  e.currentTarget.style.setProperty('--dx', `${window.innerWidth / 2 - (r.left + r.width / 2)}px`);
                  e.currentTarget.style.setProperty('--dy', `${window.innerHeight / 2 - (r.top + r.height / 2)}px`);
                  enterSite();
                }}
                aria-label="Enter OPTIMUS '27"
                className="gate-emblem relative block aspect-square cursor-pointer"
                style={{ width: 'clamp(130px, 27vh, 240px)' }}
              >
                <span className="gate-halo absolute -inset-[30%] rounded-full" />
                <span className="gate-ring absolute -inset-[13%] rounded-full border border-dashed border-sky-300/25" />
                <span className="gate-ring-rev absolute -inset-[6%] rounded-full border border-slate-300/15" />
                <img
                  src={BASE + 'assets/logo-hd.webp'}
                  alt=""
                  width={240}
                  height={240}
                  decoding="sync"
                  fetchPriority="high"
                  draggable={false}
                  className="gate-logo relative w-full h-full object-contain"
                />
                <span className="gate-sheen absolute inset-0 pointer-events-none" />
              </button>
              <div className="gate-fade mt-4 inline-flex items-center gap-2 text-xs sm:text-sm font-mono font-bold tracking-[0.4em] text-amber-300">
                <Zap className="w-4 h-4" fill="currentColor" aria-hidden="true" /> ENTER
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cinematic vignette + film grain */}
      <div
        className="fixed inset-0 pointer-events-none z-10"
        style={{ background: 'radial-gradient(ellipse at 50% 42%, transparent 52%, rgba(2,4,10,0.72) 100%)' }}
      />
      <div
        className="fixed inset-0 pointer-events-none z-10 opacity-[0.035]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"
        }}
      />

      {/* Announcements posted from /admin, just under the header */}
      {entered && notices.length > 0 && (
        <div className="fixed top-20 left-0 right-0 z-40 px-4 pt-2 space-y-2 pointer-events-none">
          {notices.map((a) => (
            <div key={a.id} className={`pointer-events-auto max-w-3xl mx-auto flex items-start gap-3 px-4 py-2.5 rounded-xl bg-slate-950/95 border ${t.ring} text-sm`}>
              <Megaphone className={`w-4 h-4 mt-0.5 shrink-0 ${t.text}`} />
              <p className="flex-1 text-slate-200">{a.message}</p>
              <button onClick={() => setDismissedNotices((d) => [...d, a.id])} aria-label="Dismiss announcement" className="p-0.5 text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ===================== HEADER ===================== */}
      <header className={`site-header fixed top-0 left-0 right-0 z-50 ${scrolled || mobileMenuOpen ? 'hdr-solid' : ''} ${entered ? 'fade-in' : ''}`}>
        <div className="relative px-5 sm:px-10 lg:px-6 2xl:px-10 h-20 flex items-center justify-between gap-3">

          <button onClick={goHome} className="flex items-center gap-3 text-left">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <img
                src={BASE + 'assets/logo-hd.webp'}
                alt="OPTIMUS '27"
                width={28}
                height={28}
                decoding="async"
                onError={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  img.style.display = 'none';
                  const fb = img.nextElementSibling as HTMLElement | null;
                  if (fb) fb.style.display = 'block';
                }}
                onLoad={(e) => {
                  const img = e.currentTarget as HTMLImageElement;
                  if (img.naturalWidth === 0) {
                    img.style.display = 'none';
                    const fb = img.nextElementSibling as HTMLElement | null;
                    if (fb) fb.style.display = 'block';
                  }
                }}
                className="w-9 h-9 object-contain"
              />
              <Zap className={`w-6 h-6 ${t.text}`} style={{ display: 'none' }} />
            </div>
            <div className="flex items-center gap-3">
              {/* Tall condensed wordmark with a solid theme-colour tag, like a title card. */}
              <span
                className="font-black uppercase text-slate-100 leading-none text-2xl sm:text-[1.9rem]"
                style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '62%', letterSpacing: '0.14em' }}
              >
                OPTIMUS
              </span>
              <span
                className={`font-black uppercase leading-none text-2xl sm:text-[1.9rem] ${t.text}`}
                style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '62%', letterSpacing: '0.14em' }}
              >
                '27
              </span>
            </div>
          </button>

          <nav className="hidden xl:flex absolute left-1/2 -translate-x-1/2 items-center gap-[18px] 2xl:gap-9 font-plex font-bold text-[12px] 2xl:text-[13px] uppercase tracking-[0.12em] 2xl:tracking-[0.16em]">
            <button onClick={goHome} className={`transition-colors hover:text-white ${!activeHero && !subPage ? t.text : 'text-white'}`}>HOME</button>
            {HEROES.map((h) => (
              <button
                key={h.key}
                onClick={() => goHero(h.key)}
                className={`transition-colors hover:text-white ${activeHero === h.key ? THEME[h.theme].text : 'text-white'}`}
              >
                {h.name}
              </button>
            ))}
            <button onClick={goPasses} className="transition-colors hover:text-white text-white">PASSES</button>
            <button onClick={goCertificate} className={`transition-colors hover:text-white ${subPage === 'certificate' ? t.text : 'text-white'}`}>CERTIFICATE</button>
          </nav>

          <div className="hidden sm:flex items-center gap-4">
            <button
              onClick={goMyPass}
              title={profile ? `My pass · ${profile.id}` : 'Get your Optimus ID'}
              className={`hidden md:inline-flex items-center gap-2 px-3 2xl:px-4 py-2.5 rounded-xl border ${t.text} ${subPage === 'mypass' ? t.ring : 'border-slate-700 hover:border-slate-500'} transition-colors text-xs font-black tracking-widest font-mono`}
            >
              <QrCode className="w-4 h-4" /> <span className="hidden 2xl:inline">{profile ? profile.id : 'GET OPTIMUS ID'}</span>
            </button>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`xl:hidden p-2 border ${t.ring} bg-slate-950/40 text-slate-200`}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="xl:hidden border-b border-slate-800 bg-slate-950/95 p-4 space-y-1 font-mono text-xs">
            <button onClick={goHome} className="block w-full text-left py-3 text-slate-300 font-bold">HOME</button>
            {HEROES.map((h) => (
              <button key={h.key} onClick={() => goHero(h.key)} className={`block w-full text-left py-3 font-bold ${THEME[h.theme].text}`}>
                {h.name} <span className="text-slate-500">· {h.tagline}</span>
              </button>
            ))}
            <button onClick={goPasses} className="block w-full text-left py-2 text-slate-300 font-bold">PASSES <span className="text-slate-500">· Pricing &amp; access</span></button>
            <button onClick={goCertificate} className="block w-full text-left py-2 text-slate-300 font-bold">CERTIFICATE <span className="text-slate-500">· Download yours</span></button>
            <button onClick={goMyPass} className="block w-full text-left py-2 text-amber-300 font-bold">MY PASS <span className="text-slate-500">· {profile ? profile.id : 'Get your Optimus ID'}</span></button>
            <button onClick={() => openRegister()} className={`mt-3 w-full px-4 py-2.5 text-xs rounded-lg ${t.btn} font-black`}>REGISTER</button>
          </div>
        )}
      </header>

      {/* ===================== MAIN ===================== */}
      <main className="relative z-10 pt-20">

        {subPage === 'certificate' ? (
          <CertificatePage onHome={goHome} />
        ) : subPage === 'mypass' ? (
          <MyPassPage profile={profile} onProfile={setProfile} onHome={goHome} />
        ) : !active ? (
          /* ======================= HOME ======================= */
          <>
            {/* Hero band — pointer-events pass through to the 3D scene except on controls */}
            {/* Phones: one stacked column. sm+: each block is pinned to the 3D gate ring, whose
                landscape projection is fixed by the camera (48° FOV): top edge ≈ 18.9vh, centre ≈ 46.2vh,
                bottom ≈ 72.9vh. The section starts 5rem down (under the header), hence the "- 5rem". */}
            <section
              className="hero-band relative px-4 pt-8 pb-6 sm:p-0 sm:h-[calc(100svh-5rem)] pointer-events-none"
              style={{ ['--tf' as string]: 'clamp(1.7rem, min(6.25vh, 7.3vw), 5.5rem)' }}
            >
              <div className={`max-w-5xl mx-auto text-center space-y-4 sm:space-y-0 ${entered ? 'scene-in' : ''}`}>
                {/* Positions follow the agreed layout, in gate-ring radii (R ≈ 27vh) from its centre (46.2vh):
                    KPR −0.61R, dateline −0.32R, title 0, tagline +0.30R; buttons start at 65vh, on the dark floor line where the ring meets the stage. */}
                {/* KPR logo */}
                <div className="sm:absolute sm:inset-x-0 sm:top-[calc(29.7vh-5rem)] sm:-translate-y-1/2">
                  <img
                    src={BASE + 'assets/kpr-hd.png'}
                    alt="KPR Institute of Engineering and Technology"
                    decoding="async"
                    className="kpr-bold mx-auto w-auto object-contain"
                    style={{ height: 'clamp(2.75rem, 8vh, 6rem)' }}
                  />
                </div>

                {/* Dateline: fine gold rules either side of the fest dates */}
                <div className="sm:absolute sm:inset-x-0 sm:top-[calc(37.6vh-5rem)] sm:-translate-y-1/2 flex items-center justify-center gap-3 sm:gap-4">
                  <span className="h-px w-10 sm:w-20 bg-gradient-to-r from-transparent to-amber-400/80" aria-hidden="true" />
                  <span className="font-plex font-semibold text-amber-300 text-[12.5px] sm:text-[15px] tracking-[0.33em] whitespace-nowrap">
                    <span className="text-amber-400/80" aria-hidden="true">◆ </span>FEB 4 – 5 · 2027<span className="text-amber-400/80" aria-hidden="true"> ◆</span>
                  </span>
                  <span className="h-px w-10 sm:w-20 bg-gradient-to-l from-transparent to-amber-400/80" aria-hidden="true" />
                </div>

                {/* Title centred on the ring; sized against the viewport height so it stays inside it. */}
                <div className="sm:absolute sm:inset-x-0 sm:top-[calc(46.2vh-5rem-var(--tf)/2)]">
                  <h1 ref={heroTitleRef} className="opt-word font-black leading-none uppercase whitespace-nowrap" style={{ fontSize: 'var(--tf)', letterSpacing: '-0.035em' }}>
                    <span className="metal-text">OPTIMUS</span> <span className="gold-text">'27</span>
                  </h1>
                </div>

                <div className="sm:absolute sm:inset-x-0 sm:top-[calc(54.3vh-5rem)] sm:-translate-y-1/2">
                  <p className="font-extrabold tracking-widest text-slate-200 max-w-3xl mx-auto uppercase" style={{ fontSize: 'clamp(0.85rem, min(2vh, 3.8vw), 1.2rem)' }}>
                    ROLL OUT. TRANSFORM YOUR <span className={`${t.text} underline decoration-2`}>DESTINY</span>
                  </p>
                </div>

                {/* Buttons + countdown, starting just inside the bottom of the ring */}
                <div className="relative sm:static pt-10 sm:pt-0">
                  {/* Buttons on the dark floor line below the ring */}
                  <div className="flex flex-row items-stretch justify-center gap-2.5 sm:gap-5 pointer-events-auto sm:absolute sm:inset-x-0 sm:top-[calc(65vh-5rem)]">
                    <button
                      onClick={() => openRegister()}
                      className={`flex-1 min-w-0 sm:flex-none px-2 sm:px-10 py-3 sm:py-4 rounded-xl ${t.btn} text-[11px] sm:text-xs font-black tracking-wide sm:tracking-widest shadow-2xl flex items-center justify-center gap-1 sm:gap-2 group transition-all hover:scale-105 whitespace-nowrap`}
                    >
                      REGISTER NOW <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                    <a
                      href="#roster"
                      onClick={(e) => {
                        // Straight to the first leader: on laptops its row pins exactly at the top (card
                        // beside Bumblebee on the events stage); on phones, its card just under the header.
                        e.preventDefault();
                        const row = document.querySelector<HTMLElement>('[data-stage-row="bumblebee"]');
                        // (the scene keeps drawing so Bumblebee's drive-in is seen from its start)
                        if (window.innerWidth >= 1024) glideTo(row, 0, false);
                        else glideTo(row?.querySelector('button') ?? row, 88);
                      }}
                      className="flex-1 min-w-0 sm:flex-none flex items-center justify-center px-2 sm:px-10 py-3 sm:py-4 rounded-xl bg-slate-900/90 border border-slate-700/80 hover:bg-slate-800 text-slate-200 text-[11px] sm:text-xs font-mono font-bold tracking-wide sm:tracking-widest transition-all whitespace-nowrap"
                    >
                      MEET THE LEADERS
                    </a>
                  </div>
                  {/* Countdown stays where it was: below a 52px button row that started at 68.2vh */}
                  <div className="sm:absolute sm:inset-x-0 sm:top-[calc(68.2vh-5rem+52px)]">
                    <Countdown />
                  </div>
                </div>

                {/* Phone-only quick info: the floating HUD panels are hidden on small screens, so the
                    useful bits (venue, dates, sponsors) live here with one-tap actions. */}
                <div className="sm:hidden pointer-events-auto space-y-3 pt-1">
                  <div className="rounded-xl border border-slate-700/70 bg-slate-950/85 px-4 py-3 text-left">
                    <div className="text-[10px] font-mono tracking-[0.25em] text-slate-400 uppercase">Feb 4–5, 2027 · Coimbatore</div>
                    <div className="mt-0.5 text-sm font-bold text-slate-100">KPR Institute of Engineering and Technology</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <a
                        href={VENUE_MAP}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 border border-slate-700 py-3 text-[11px] font-mono font-bold tracking-widest text-cyan-300 active:scale-95"
                      >
                        <MapPin className="w-4 h-4" /> DIRECTIONS
                      </a>
                      <a
                        href={FEST_ICS}
                        download="optimus27.ics"
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 border border-slate-700 py-3 text-[11px] font-mono font-bold tracking-widest text-amber-300 active:scale-95"
                      >
                        <CalendarPlus className="w-4 h-4" /> ADD DATES
                      </a>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-4 opacity-90">
                    <span className="text-[9px] font-mono tracking-[0.35em] text-cyan-200/80 uppercase">Presented by</span>
                    <img src={BASE + 'assets/acmw.png'} alt="ACM-W" decoding="async" className="h-6 w-auto object-contain" />
                    <img src={BASE + 'assets/nexora.png'} alt="NEXORA" decoding="async" className="h-7 w-auto object-contain" />
                  </div>
                </div>

              </div>
            </section>

            {/* Second "page": the headline on its own Transformers backdrop */}
            <TechnoFestSection />

            {/* Overall prize-pool cinematic reveal */}
            <PrizePoolSection onExplore={() => document.getElementById('roster')?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
            })} />

            {/* Events / roster: one row per leader. Cards alternate right / left; on laptops and desktops
                the open half of each row is the 3D stage where that leader's robot stands (see stageRef). */}
            <section id="roster" className="roster-sec relative scroll-mt-24">
              {/* Continuity from the prize vault: dark steel fades away and the energon conduit carries on */}
              <div className="pointer-events-none absolute inset-x-0 -top-1 h-[40vh] bg-gradient-to-b from-[#03050b] via-[#03050b]/80 to-transparent" aria-hidden="true" />
              <div className="pv-conduit absolute left-1/2 top-0 h-28" aria-hidden="true"><i /><i /></div>
              {/* Stage lighting: darker edges so cards and robots read over the arena */}
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_55%,transparent_40%,rgba(3,5,11,.55)_100%)]" aria-hidden="true" />

              <div className="relative px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto pt-28 pb-10">
                <div className="text-center max-w-3xl mx-auto mb-10 lg:mb-0 space-y-3">
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono border ${t.chip}`}>
                    <Shield className="w-3.5 h-3.5" /> CHOOSE YOUR LEADER
                  </div>
                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight uppercase">THE ALLSPARK ROSTER</h2>
                  <p className="text-slate-300 text-sm sm:text-base">
                    Every event of OPTIMUS '27 is commanded by a Transformer. Scroll to meet them, or enter a leader's arena to see their events.
                  </p>
                </div>

                <div className="space-y-6 lg:space-y-0">
                  {STAGE_ORDER.map(({ key, card }, idx) => {
                    const h = heroByKey(key)!;
                    const ht = THEME[h.theme];
                    const hex = CURSOR_HEX[h.theme];
                    return (
                      <div key={key} data-stage-row={key} data-card={card} className="lg:h-[175vh] relative">
                        {/* Pinned for the row's extra height: one scroll "stop" per leader */}
                        <div className={`lg:sticky lg:top-0 lg:h-screen lg:pt-20 flex items-center ${card === 'right' ? 'lg:justify-end' : 'lg:justify-start'}`}>
                        <button
                          onClick={() => goHero(h.key)}
                          className={`group w-full lg:w-[min(52%,760px)] text-left relative overflow-hidden rounded-3xl bg-slate-950/85 border border-slate-800 ${onHover(ht.ring)} ${onHover(ht.glow)} p-6 sm:p-8 lg:p-10 transition-all hover:-translate-y-1`}
                        >
                          <div className={`absolute -top-12 ${card === 'right' ? '-right-12' : '-left-12'} w-48 h-48 rounded-full bg-gradient-to-br ${ht.grad} opacity-15 blur-3xl`} />
                          <div className="relative space-y-3">
                            <span className="inline-block px-3 py-1 rounded-full text-[10px] font-mono tracking-widest border border-slate-700 text-slate-400">
                              {h.faction} · {h.role}
                            </span>
                            {/* Event number beside the name (01 · 02 …), in the leader's colour */}
                            <div className="flex items-start gap-3 sm:gap-4">
                              <span className={`font-mono text-sm sm:text-base font-bold tracking-wider pt-1 sm:pt-1.5 ${ht.text} opacity-80`}>
                                {String(idx + 1).padStart(2, '0')}
                              </span>
                              <h3 className={`text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight uppercase ${ht.text}`}>{h.name}</h3>
                            </div>
                          </div>
                          <p className="relative mt-5 text-slate-300 text-sm sm:text-base lg:text-lg leading-relaxed">
                            <span className="font-bold text-white">{h.tagline}.</span> {h.lore}
                          </p>
                          <div className="relative mt-6 pt-5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                            {/* Prize pool as a big glowing figure; workshops (no prizes) show what you gain instead */}
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`text-3xl sm:text-4xl font-black tracking-tight leading-none ${ht.text}`}
                                style={{ fontStretch: '110%', textShadow: `0 0 22px ${hex}66` }}
                              >
                                {h.prizePool ? inr(h.prizePool) : 'HANDS-ON'}
                              </span>
                              <span className="font-mono text-[10px] sm:text-[11px] font-bold tracking-[0.25em] text-slate-400 leading-tight">
                                {h.prizePool ? <>PRIZE<br />POOL</> : <>EXPERIENCE<br />+ CERTIFICATE</>}
                              </span>
                            </div>
                            <span className={`inline-flex items-center gap-2 px-6 py-3.5 rounded-xl ${ht.btn} text-xs lg:text-sm font-black tracking-widest`}>
                              ENTER ARENA <ChevronRight className="w-4 h-4" />
                            </span>
                          </div>
                        </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Fest passes — same arena backdrop as the events section (the 3D floor shows through,
                dark-steel fade at the bottom, vignette edges) with the passes as a deck of
                Cybertronian access keys: overlapping cut-corner cards, the one you point at slides
                up out of the deck. Phones and tablets get a plain grid. */}
            <section id="passes" className="relative scroll-mt-24">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_55%,transparent_40%,rgba(3,5,11,.55)_100%)]" aria-hidden="true" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[30vh] bg-gradient-to-t from-[#03050b] to-transparent" aria-hidden="true" />
              <div className="relative px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-20 sm:py-24">
                <div className="text-center max-w-3xl mx-auto mb-12 lg:mb-14 space-y-3">
                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono border ${t.chip}`}>
                    <Ticket className="w-3.5 h-3.5" /> FEST PASSES
                  </div>
                  <h2 className="text-3xl sm:text-5xl font-black tracking-tight uppercase">CHOOSE YOUR PASS</h2>
                  <p className="text-slate-300 text-sm sm:text-base">
                    One pass, many arenas. Pick the access that fits your mission for Feb 4 – 5, 2027.
                  </p>
                  <p className="hidden lg:block text-[10px] font-mono tracking-[0.4em] text-slate-500">HOVER A PASS · CLICK TO BOOK</p>
                </div>

                <div className={`pass-deck ${deckPass === null ? 'is-rest' : ''}`} onMouseLeave={() => setDeckPass(null)}>
                  {(['hackathon', 'exclusive', 'oneday', 'twoday'] as PassId[]).map((id, i, all) => {
                    const p = passById(id);
                    const hex = CURSOR_HEX[p.theme];
                    const meta: Record<PassId, { term: string; tag: string }> = {
                      hackathon: { term: '24-HOUR · TEAMS OF 2 – 4', tag: 'FLAGSHIP' },
                      exclusive: { term: '2-DAY · ALL ACCESS', tag: 'ALL ACCESS' },
                      oneday: { term: '1-DAY · FEB 4 OR 5', tag: 'DAY PASS' },
                      twoday: { term: '2-DAY · FEB 4 & 5', tag: 'BOTH DAYS' }
                    };
                    const on = deckPass === i;
                    return (
                      <div
                        key={p.id}
                        className={`pass-card ${on ? 'pass-on' : ''}`}
                        style={{ ['--c' as string]: hex, zIndex: on ? 20 : deckPass === null ? all.length - i : all.length - Math.abs(i - deckPass) }}
                        onMouseEnter={() => setDeckPass(i)}
                        onFocus={() => setDeckPass(i)}
                        onClick={() => openRegister(p.id)}
                      >
                        <div className="pass-in">
                          {/* Header strip: index, name, energon hazard stripes, access tag */}
                          <div className="pass-head">
                            <span className="font-mono text-[11px] font-bold" style={{ color: hex }}>{String(i + 1).padStart(2, '0')}</span>
                            <h3 className="text-sm sm:text-base font-black tracking-[0.12em] uppercase text-white whitespace-nowrap">{p.name}</h3>
                            <span className="pass-hatch" aria-hidden="true" />
                            <span className="ml-auto font-mono text-[9px] tracking-[0.3em] text-slate-400 whitespace-nowrap lg:hidden xl:inline">{meta[id].tag}</span>
                          </div>
                          <div className="relative p-6 sm:p-7 flex flex-col flex-1">
                            <p className="text-[11px] font-mono tracking-widest" style={{ color: hex }}>{meta[id].term}</p>
                            <p className="mt-2 text-slate-300 text-sm leading-relaxed min-h-[2.75rem]">{p.blurb}</p>
                            <div className="mt-5 flex items-baseline gap-2">
                              <span className="font-num font-bold leading-none text-4xl sm:text-5xl text-white">{inr(p.price)}</span>
                              <span className="text-[11px] text-slate-400">{p.team ? 'Per Member' : 'Per Participant'}</span>
                            </div>
                            <ul className="mt-5 space-y-2.5 text-sm text-slate-300 flex-1">
                              {p.perks.map((perk) => (
                                <li key={perk} className="flex items-start gap-2.5">
                                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: hex }} /> {perk}
                                </li>
                              ))}
                            </ul>
                            <button
                              onClick={(e) => { e.stopPropagation(); openRegister(p.id); }}
                              className="pass-book mt-7 self-start inline-flex items-center gap-2 font-mono text-[11px] font-bold tracking-[0.3em]"
                              style={{ color: hex }}
                            >
                              BOOK PASS <ChevronRight className="w-4 h-4" />
                            </button>
                            {/* Big outlined index, bottom-right, like a stamped part number */}
                            <span className="pass-num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

          </>
        ) : (
          /* ======================= HERO PAGE ======================= */
          <section key={active.key} className="min-h-[calc(100vh-5rem)] px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-10">
            <button
              onClick={goHome}
              className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-white hover:opacity-80 mb-8"
            >
              <ArrowLeft className="w-4 h-4" /> BACK TO ROSTER
            </button>

            <div className="grid lg:grid-cols-2 gap-10 items-start">
              {/* Left: identity (the 3D figure sits behind, visible around this column) */}
              <div className="space-y-6 lg:sticky lg:top-28 hero-in" style={{ animationDelay: introDelay(0) }}>
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono font-bold border ${t.ring} bg-slate-900/70 text-white`}>
                  <span className={`h-2 w-2 rounded-full ${t.dot} animate-pulse`} /> {active.faction} · {active.role}
                </div>
                <h1 className={`text-5xl sm:text-7xl font-black tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r ${t.titleGrad}`}>
                  {active.name}
                </h1>
                <p className={`text-lg sm:text-2xl font-extrabold tracking-wide uppercase ${t.text}`}>{active.tagline}</p>
                <p className="text-slate-300 leading-relaxed text-sm sm:text-base max-w-lg">{active.lore}</p>
                {/* Prize pool as a big glowing figure (same style as the home page's event cards);
                    the workshop arena shows what you gain instead */}
                <div className="flex items-center gap-3">
                  <span
                    className={`text-4xl sm:text-5xl font-black tracking-tight leading-none ${t.text}`}
                    style={{ fontStretch: '110%', textShadow: `0 0 26px ${CURSOR_HEX[active.theme]}66` }}
                  >
                    {active.prizePool ? inr(active.prizePool) : 'HANDS-ON'}
                  </span>
                  <span className="font-mono text-[11px] sm:text-xs font-bold tracking-[0.25em] text-slate-300 leading-tight">
                    {active.prizePool ? <>PRIZE<br />POOL</> : <>EXPERIENCE<br />+ CERTIFICATE</>}
                  </span>
                </div>
                <div className="pt-1">
                  <button onClick={() => openRegister(active.kind === 'main' ? 'hackathon' : 'oneday')} className={`px-7 py-3.5 rounded-xl ${t.btn} text-xs sm:text-sm font-black tracking-widest`}>
                    REGISTER FOR {active.name}
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {HEROES.filter((h) => h.key !== active.key).map((h) => (
                    <button key={h.key} onClick={() => goHero(h.key)} className="px-4 py-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:bg-slate-800 text-slate-200 text-[11px] font-mono font-bold tracking-widest">
                      {h.name} →
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: events under this leader */}
              <div className="space-y-4">
                {/* Heading for the list: enters with the event cards, after the robot has arrived */}
                <div className="hero-in flex items-center gap-3 pb-1" style={{ animationDelay: introDelay(0.04) }}>
                  <span className={`h-2.5 w-2.5 shrink-0 rotate-45 ${t.dot}`} />
                  <h2 className="text-lg sm:text-xl font-black uppercase tracking-wide text-white whitespace-nowrap" style={{ fontStretch: '110%' }}>
                    Events under <span className={t.text}>{active.name}</span>
                  </h2>
                  <span className={`shrink-0 px-2.5 py-0.5 rounded-md border text-xs font-mono font-bold ${t.chip}`}>{active.events.length}</span>
                  <span className="flex-1 h-px bg-gradient-to-r from-slate-500/60 to-transparent" />
                </div>
                {active.events.map((ev, i) => (
                  <div
                    key={ev.id}
                    style={{ animationDelay: introDelay(0.12 + i * 0.1) }}
                    onClick={() => setSelectedEvent(ev)}
                    className={`hero-in group p-6 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-600 ${t.glow} transition-all cursor-pointer hover:-translate-y-1`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <h3 className={`text-xl font-black tracking-wide uppercase ${t.hoverText} transition-colors`}>{ev.title}</h3>
                        <p className="text-slate-300 text-sm leading-relaxed max-w-md">{ev.desc}</p>
                      </div>
                      <span className="p-2.5 rounded-xl bg-slate-800 text-slate-200 group-hover:bg-slate-700 transition-colors shrink-0">
                        <ChevronRight className="w-5 h-5" />
                      </span>
                    </div>
                    <EventFacts ev={ev} t={t} />
                    <EventPrize ev={ev} hex={CURSOR_HEX[active.theme]} t={t} />
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

      </main>

      {/* ===================== EVENT MODAL ===================== */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={() => setSelectedEvent(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedEvent.title}
            onClick={(e) => e.stopPropagation()}
            className={`max-w-xl w-full max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain rounded-3xl bg-slate-900 border ${t.ring} ${t.glow} p-6 sm:p-8 space-y-6 relative`}
          >
            <button onClick={() => setSelectedEvent(null)} className="absolute top-6 right-6 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <div className="space-y-2 pr-12">
              {/* Every event opens with its prize up top (workshops: what you take home) */}
              <div className="flex items-center gap-3">
                {selectedEvent.prize.startsWith('₹')
                  ? <Trophy className={`w-9 h-9 shrink-0 ${t.text}`} style={{ filter: `drop-shadow(0 0 12px ${hexOf(t)}88)` }} />
                  : <Award className={`w-9 h-9 shrink-0 ${t.text}`} style={{ filter: `drop-shadow(0 0 12px ${hexOf(t)}88)` }} />}
                <span className={`font-black leading-none tracking-tight ${t.text}`} style={{ fontSize: 'clamp(2rem, 7vw, 3rem)', fontStretch: '110%', textShadow: `0 0 24px ${hexOf(t)}55` }}>
                  {selectedEvent.prize.startsWith('₹') ? selectedEvent.prize : 'CERTIFIED'}
                </span>
                <span className="text-[11px] sm:text-xs font-mono font-bold tracking-[0.3em] text-slate-300 uppercase leading-tight">
                  {selectedEvent.prize.startsWith('₹') ? <>Prize<br />Pool</> : <>Hands-on<br />Workshop</>}
                </span>
              </div>
              <h3 className="text-2xl font-black uppercase pt-1">{selectedEvent.title}</h3>
              <p className="text-xs font-mono text-slate-400">Commanded by {active?.name}</p>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">{selectedEvent.desc}</p>
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <EventFacts ev={selectedEvent} t={t} bare />
              {selectedEvent.split && (
                <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-3 gap-3 font-mono">
                  {selectedEvent.split.map((amt, k) => (
                    <div key={k}>
                      <span className="text-slate-500 uppercase block text-[10px] tracking-wider">{['1st Prize', '2nd Prize', '3rd Prize'][k]}</span>
                      <span className={`text-sm font-black ${['pz-gold', 'pz-silver', 'pz-bronze'][k]}`}>{inr(amt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-mono uppercase text-slate-400 tracking-wider">Rules &amp; Protocols</h4>
              <ul className="space-y-2 text-sm text-slate-300">
                {selectedEvent.rules.map((r, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle className={`w-4 h-4 ${t.text} flex-shrink-0`} /> {r}
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-mono uppercase text-slate-400 tracking-wider">Included In</h4>
              <div className="flex flex-wrap gap-2">
                {passesFor(selectedEvent).map((p) => (
                  <span key={p.id} className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded border ${THEME[p.theme].chip}`}>
                    {p.name} · {inr(p.price)}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => openRegister(selectedEvent.id === 'hackathon' ? 'hackathon' : 'oneday')}
              className={`w-full py-4 rounded-xl ${t.btn} font-black tracking-widest uppercase shadow-lg text-xs`}
            >
              GET A PASS FOR THIS EVENT
            </button>
          </div>
        </div>
      )}

      {/* ===================== REGISTER MODAL ===================== */}
      {/* Before an Optimus ID exists, the "get your ID first" screen wears the colours of the leader
          page it was opened from (Megatron red, Shockwave violet …); the pass form keeps its pass colour. */}
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" onClick={() => { setIsRegisterOpen(false); setRegisterSuccess(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Registration"
            onClick={(e) => e.stopPropagation()}
            className={`max-w-lg w-full rounded-3xl bg-slate-900 border ${idT.ring} ${idT.glow} p-6 sm:p-8 space-y-6 relative max-h-[90vh] overflow-y-auto`}
          >
            <button onClick={() => { setIsRegisterOpen(false); setRegisterSuccess(false); }} className="absolute top-6 right-6 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            {!profile && !registerSuccess ? (
              <div className="text-center space-y-5 py-4">
                <div className={`mx-auto w-14 h-14 rounded-2xl border flex items-center justify-center ${idT.chip}`}>
                  <QrCode className="w-7 h-7" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-black uppercase">Get your Optimus ID first</h3>
                  <p className="text-sm text-slate-400">
                    Registration, team entry and certificates all use your Optimus ID. Get yours in a minute, then come back to register.
                  </p>
                </div>
                <button onClick={goMyPass} className={`w-full py-4 rounded-xl ${idT.btn} text-xs font-black tracking-widest`}>
                  GET OPTIMUS ID
                </button>
              </div>
            ) : !registerSuccess ? (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div className="space-y-1">
                  <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-mono border ${pt.chip}`}>
                    <Ticket className="w-3 h-3" /> FEST PASS REGISTRATION
                  </div>
                  <h3 className="text-2xl font-black uppercase">GET YOUR FEST PASS</h3>
                  <p className="text-xs text-slate-400">OPTIMUS '27 · KPR Institute of Engineering and Technology · Feb 4 – 5, 2027</p>
                </div>

                <div className="space-y-3 pt-2">
                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-1">SELECT PASS</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {PASSES.map((p) => {
                        const on = p.id === formData.pass;
                        const ptk = THEME[p.theme];
                        return (
                          <button
                            key={p.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setFormData({ ...formData, pass: p.id })}
                            className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${on ? `${ptk.ring} bg-slate-950` : 'border-slate-800 bg-slate-950/80 hover:border-slate-600'}`}
                          >
                            <span className={`block text-[10px] font-mono font-bold tracking-widest ${on ? ptk.text : 'text-slate-400'}`}>{p.name}</span>
                            <span className="block text-sm font-black text-slate-100">
                              {inr(p.price)}<span className="text-[10px] font-mono font-normal text-slate-500"> / {p.team ? 'member' : 'person'}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[11px] text-slate-400">{pass.blurb} {pass.perks.join(' · ')}.</p>
                  </div>

                  {pass.pickDay && (
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">CHOOSE YOUR DAY</label>
                      <div className="grid grid-cols-2 gap-2">
                        {FEST_DAYS.map((d, i) => (
                          <button
                            key={d}
                            type="button"
                            aria-pressed={formData.day === i}
                            onClick={() => setFormData({ ...formData, day: i })}
                            className={`px-4 py-3 rounded-xl border text-xs font-mono font-bold tracking-widest transition-colors ${formData.day === i ? `${pt.ring} ${pt.text} bg-slate-950` : 'border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-600'}`}
                          >
                            DAY {i + 1} · {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {pass.team && (
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">TEAM NAME</label>
                      <input
                        type="text" required placeholder="e.g., Cyber Knights"
                        value={formData.teamName}
                        onChange={(e) => setFormData({ ...formData, teamName: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
                      />
                    </div>
                  )}

                  {pass.team && (
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">TEAM SIZE</label>
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: pass.team.max - pass.team.min + 1 }, (_, i) => pass.team!.min + i).map((n) => (
                          <button
                            key={n}
                            type="button"
                            aria-pressed={formData.teamSize === n}
                            onClick={() => setFormData({ ...formData, teamSize: n })}
                            className={`px-3 py-3 rounded-xl border text-xs font-mono font-bold tracking-widest transition-colors ${formData.teamSize === n ? `${pt.ring} ${pt.text} bg-slate-950` : 'border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-600'}`}
                          >
                            {n} MEMBERS
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* The signed-in participant: team leader on a team pass, the pass holder otherwise. */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono tracking-widest text-slate-500">{pass.team ? 'TEAM LEADER' : 'PASS HOLDER'}</p>
                      <p className="text-sm font-black tracking-wide text-white truncate">{profile?.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{profile?.college}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-mono font-bold tracking-widest ${pt.text}`}>{profile?.id}</span>
                  </div>

                  {pass.team && teamMembers.map((m, i) => {
                    const check = memberChecks[i];
                    const status: Record<MemberCheck, [string, string]> = {
                      'ok': ['text-emerald-400', 'VERIFIED'],
                      'bad-format': ['text-slate-500', 'ID FORMAT: OPT27-00000'],
                      'not-found': ['text-rose-400', 'NO SUCH OPTIMUS ID'],
                      'name-mismatch': ['text-rose-400', 'NAME DOES NOT MATCH THIS ID'],
                      'duplicate': ['text-rose-400', 'ALREADY IN TEAM']
                    };
                    const setMember = (patch: Partial<{ id: string; name: string }>) => {
                      const members = [...formData.members];
                      members[i] = { ...members[i], ...patch };
                      setFormData({ ...formData, members });
                    };
                    return (
                      <div key={i} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <label className="text-xs font-mono text-slate-400">MEMBER {i + 2}</label>
                          {check && <span className={`text-[10px] font-mono font-bold tracking-widest ${status[check][0]}`}>{status[check][1]}</span>}
                        </div>
                        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                          <input
                            type="text" required placeholder="OPT27-00000" spellCheck={false}
                            aria-label={`Member ${i + 2} Optimus ID`}
                            value={m.id}
                            onChange={(e) => setMember({ id: e.target.value.toUpperCase() })}
                            className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm font-mono focus:outline-none focus:border-slate-500"
                          />
                          <input
                            type="text" required placeholder="NAME IN CAPITALS"
                            aria-label={`Member ${i + 2} name`}
                            value={m.name}
                            onChange={(e) => setMember({ name: e.target.value })}
                            className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
                          />
                        </div>
                      </div>
                    );
                  })}
                  {pass.team && (
                    <p className="text-[11px] text-slate-500">Every teammate needs their own Optimus ID. Ask them to get one from MY PASS first.</p>
                  )}

                  {/* Order summary */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-xs space-y-1.5">
                    <div className="flex justify-between gap-3 text-slate-400">
                      <span>{pass.name}</span>
                      <span>{inr(pass.price)} × {passQty} {pass.team ? 'members' : 'person'}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-slate-400">
                      <span>VALID</span>
                      <span>{passValid}</span>
                    </div>
                    <div className="flex justify-between gap-3 pt-2 mt-1 border-t border-slate-800 text-sm">
                      <span className="font-bold text-slate-200">TOTAL</span>
                      <span className={`font-black ${pt.text}`}>{inr(passTotal)}</span>
                    </div>
                  </div>
                </div>

                <button type="submit" className={`w-full py-4 rounded-xl ${pt.btn} text-xs font-black tracking-widest uppercase shadow-lg mt-2`}>
                  GENERATE PASS · {inr(passTotal)}
                </button>
              </form>
            ) : (
              <div className="text-center space-y-6 py-2">
                <div className={`p-6 rounded-3xl bg-slate-950 border ${pt.ring} ${pt.glow} text-left space-y-4`}>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Zap className={`w-5 h-5 ${pt.text}`} />
                      <span className="font-black tracking-widest text-sm uppercase">OPTIMUS '27</span>
                    </div>
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${pt.chip}`}>{pass.name}</span>
                  </div>
                  <div className="space-y-2 font-mono text-xs">
                    {pass.team && (
                      <div className="flex justify-between gap-3"><span className="text-slate-500">TEAM:</span><span className="text-white font-bold text-right">{formData.teamName}</span></div>
                    )}
                    <div className="flex justify-between gap-3"><span className="text-slate-500">{pass.team ? 'LEADER:' : 'NAME:'}</span><span className="text-slate-300 text-right">{profile?.name} · {profile?.id}</span></div>
                    {pass.team && (
                      <div className="flex justify-between gap-3"><span className="text-slate-500">MEMBERS:</span><span className="text-slate-300 text-right">{teamMembers.map((m) => `${normalizeName(m.name)} · ${m.id}`).join(', ')}</span></div>
                    )}
                    <div className="flex justify-between gap-3"><span className="text-slate-500">COLLEGE:</span><span className="text-slate-300 text-right">{profile?.college}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">VALID:</span><span className={`${pt.text} text-right`}>{passValid}</span></div>
                    <div className="flex justify-between gap-3"><span className="text-slate-500">AMOUNT:</span><span className="text-white font-bold text-right">{inr(passTotal)}</span></div>
                  </div>
                  <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                    <div className="flex items-center gap-2 text-slate-400 text-[10px] font-mono">
                      <QrCode className={`w-10 h-10 ${pt.text}`} />
                      <span>PRESENT AT THE FEST GATE</span>
                    </div>
                    <Trophy className={`w-8 h-8 ${pt.text}`} />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 font-mono">
                  Demo confirmation only — connect a payment gateway and a backend / Google Form to collect fees and store real registrations.
                </p>
                <button
                  onClick={() => { setIsRegisterOpen(false); setRegisterSuccess(false); }}
                  className={`w-full py-3 rounded-xl ${pt.btn} text-xs font-black tracking-widest uppercase`}
                >
                  DONE
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== FOOTER ===================== */}
      <footer className="border-t border-slate-800/80 bg-slate-950/95 relative z-10 pt-14 pb-28 lg:pb-12 text-slate-400">
        <div className="max-w-7xl mx-auto px-5 sm:px-8">
          {/* Brand + presented-by */}
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">
            <div className="space-y-4 max-w-xl">
              <button onClick={goHome} className="flex items-center gap-3 text-left">
                <img src={BASE + 'assets/logo-hd.webp'} alt="" width={44} height={44} decoding="async" className="w-11 h-11 object-contain" />
                <div>
                  <div className="font-black uppercase leading-none text-3xl" style={{ fontFamily: "'Archivo', sans-serif", fontStretch: '62%', letterSpacing: '0.14em' }}>
                    <span className="text-slate-100">OPTIMUS</span> <span className="text-amber-400">'27</span>
                  </div>
                  <div className="mt-1.5 font-plex text-[11px] font-semibold tracking-[0.3em] text-slate-400">KPRIET · COIMBATORE</div>
                </div>
              </button>
              <p className="text-sm leading-relaxed text-slate-300">
                National Level Techno Fest at KPR Institute of Engineering and Technology, Coimbatore. Four arenas, ten-plus events and a 24-hour flagship hackathon on Feb 4 – 5, 2027.
              </p>
            </div>
            <div className="flex items-center gap-4 self-start rounded-full border border-slate-700/80 px-5 py-2.5">
              <span className="font-plex text-[10px] font-semibold tracking-[0.3em] text-cyan-200/80">PRESENTED BY</span>
              <img src={BASE + 'assets/acmw.png'} alt="ACM-W" decoding="async" className="h-6 w-auto object-contain" />
              <img src={BASE + 'assets/nexora.png'} alt="NEXORA" decoding="async" className="h-7 w-auto object-contain" />
            </div>
          </div>

          <div className="my-10 h-px bg-slate-800/80" />

          {/* Link columns */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-10">
            {([
              {
                title: 'EXPLORE',
                links: [
                  { label: 'HOME', on: goHome },
                  ...HEROES.map((h) => ({ label: h.name, on: () => goHero(h.key) }))
                ]
              },
              {
                title: 'PARTICIPATE',
                links: [
                  { label: 'PASSES & TICKETS', on: goPasses },
                  { label: 'REGISTER', on: () => openRegister() },
                  { label: 'MY PASS', on: goMyPass },
                  { label: 'CERTIFICATE', on: goCertificate }
                ]
              },
              {
                title: 'ARENAS',
                links: HEROES.map((h) => ({ label: h.tagline.toUpperCase(), on: () => goHero(h.key) }))
              },
              {
                title: 'VENUE',
                links: [
                  { label: 'KPR INSTITUTE OF ENGINEERING AND TECHNOLOGY' },
                  { label: 'COIMBATORE · FEB 4 – 5, 2027' },
                  { label: 'GET DIRECTIONS', href: VENUE_MAP },
                  { label: 'ADD TO CALENDAR', href: FEST_ICS, download: 'optimus27.ics' }
                ]
              }
            ] as { title: string; links: { label: string; on?: () => void; href?: string; download?: string }[] }[]).map((col) => (
              <div key={col.title} className="space-y-4">
                <p className="font-plex text-[11px] font-semibold tracking-[0.35em] text-slate-500">{col.title}</p>
                <ul className="space-y-3">
                  {col.links.map((l) => {
                    const cls = 'font-plex text-[13px] font-bold tracking-wider text-slate-300 hover:text-white transition-colors';
                    return (
                      <li key={l.label}>
                        {l.on ? (
                          <button onClick={l.on} className={`${cls} text-left`}>{l.label}</button>
                        ) : l.href ? (
                          <a
                            href={l.href}
                            {...(l.download ? { download: l.download } : { target: '_blank', rel: 'noopener noreferrer' })}
                            className={`${cls} inline-flex items-center gap-1.5`}
                          >
                            {l.label} {l.download ? <CalendarPlus className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                          </a>
                        ) : (
                          <span className="font-plex text-[13px] font-semibold tracking-wider text-slate-400">{l.label}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-12 h-px bg-slate-800/80" />

          {/* Bottom row */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-5">
            <p className="font-plex text-[11px] font-semibold tracking-[0.2em] text-slate-500 text-center sm:text-left">
              © 2027 OPTIMUS '27 · KPR INSTITUTE OF ENGINEERING AND TECHNOLOGY
            </p>
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="inline-flex items-center gap-2 rounded-full border border-slate-700/80 px-5 py-2.5 font-plex text-xs font-bold tracking-widest text-slate-200 hover:border-slate-500 hover:text-white"
            >
              TOP <ChevronRight className="w-4 h-4 -rotate-90" />
            </button>
          </div>
        </div>
      </footer>

      {/* ============ AUDIO PILL — bottom-right music toggle (phones use the action bar) ============ */}
      {gate === 'gone' && (
        <button
          onClick={toggleSound}
          aria-label={soundEnabled ? 'Mute music' : 'Play music'}
          aria-pressed={soundEnabled}
          className="hidden lg:inline-flex fixed right-6 bottom-6 z-50 items-center gap-2.5 rounded-full border border-slate-700/80 bg-slate-950/85 px-4 py-2.5 font-plex text-xs font-bold tracking-widest text-slate-200 hover:border-slate-500 hover:text-white"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4 text-slate-500" />}
          <span className={`flex items-end gap-[3px] h-3.5 ${soundEnabled ? 'text-amber-400' : 'text-slate-600'}`} aria-hidden="true">
            {[0.45, 0.8, 0.6, 1].map((h, i) => (
              <span
                key={i}
                className={`w-[3px] rounded-sm bg-current ${soundEnabled ? 'eq-bar' : ''}`}
                style={{ height: `${h * 100}%`, animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </span>
          {soundEnabled ? 'AUDIO' : 'MUTED'}
        </button>
      )}

      {/* ============ PHONE ACTION BAR — thumb-reach navigation (hidden from the lg breakpoint up) ============ */}
      {gate === 'gone' && (
        <nav
          aria-label="Quick navigation"
          className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-slate-700/70 bg-slate-950/95 px-2 pt-1.5 grid grid-cols-5 gap-1 items-center"
          style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
        >
          {([
            { label: 'HOME', icon: <Home className="w-5 h-5" />, on: goHome, current: !active && !subPage },
            { label: 'LEADERS', icon: <Users className="w-5 h-5" />, on: goRoster, current: !!active },
            { label: 'PASSES', icon: <Ticket className="w-5 h-5" />, on: goPasses, current: false }
          ] as const).map((b) => (
            <button
              key={b.label}
              onClick={b.on}
              aria-current={b.current ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[9px] font-mono font-bold tracking-widest active:scale-95 ${b.current ? t.text : 'text-slate-400'}`}
            >
              {b.icon}
              {b.label}
            </button>
          ))}
          <button
            onClick={toggleSound}
            aria-label={soundEnabled ? 'Mute music' : 'Play music'}
            className="flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-[9px] font-mono font-bold tracking-widest text-slate-400 active:scale-95"
          >
            {soundEnabled ? <Volume2 className={`w-5 h-5 ${t.text}`} /> : <VolumeX className="w-5 h-5" />}
            {soundEnabled ? 'SOUND' : 'MUTED'}
          </button>
          <button
            onClick={() => openRegister()}
            className={`py-3 rounded-xl ${t.btn} text-[11px] font-black tracking-widest active:scale-95`}
          >
            REGISTER
          </button>
        </nav>
      )}

      {/* ============ CYBERTRON HUD — bottom-left tactical panels (home only, hidden on phones) ============ */}
      {gate === 'gone' && !active && !subPage && (
        <div className="hud-flat fixed left-2.5 sm:left-5 bottom-2.5 sm:bottom-5 z-40 pointer-events-none hidden xl:flex flex-col gap-2 sm:gap-2.5 w-[min(60vw,270px)]">
          {/* SECTOR COORDINATES */}
          <div className="hud-panel-in relative overflow-hidden rounded-lg border border-cyan-400/30 bg-slate-950/80 px-3.5 py-2 sm:px-4 sm:py-2.5">
            <HudCorners />
            <div className="hud-scan pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-cyan-300/20 to-transparent" />
            <div className="flex items-center gap-1.5 text-[9px] font-mono tracking-[0.28em] text-cyan-300/80 uppercase">
              <Radio className="w-3 h-3" /> Sector Coordinates
            </div>
            <div className="mt-1 font-mono text-sm sm:text-base font-bold text-cyan-100 tracking-wide">
              11.0782° N, 77.1386° E
            </div>
            <div className="mt-0.5 text-[8px] font-mono tracking-[0.22em] text-slate-500 uppercase">KPRIET · Coimbatore</div>
          </div>
          {/* TEMPORAL EVENT WINDOW (dates kept exactly as 4.2.2027 / 5.2.2027) */}
          <div className="hud-panel-in relative overflow-hidden rounded-lg border border-amber-400/30 bg-slate-950/80 px-3.5 py-2 sm:px-4 sm:py-2.5" style={{ animationDelay: '.12s' }}>
            <HudCorners accent="amber" />
            <div className="hud-scan pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-amber-300/20 to-transparent" />
            <div className="flex items-center gap-1.5 text-[9px] font-mono tracking-[0.28em] text-amber-300/80 uppercase">
              <Calendar className="w-3 h-3" /> Temporal Event Window
            </div>
            <div className="mt-1 flex items-center gap-2.5 font-mono font-bold text-amber-100">
              <span className="text-lg sm:text-xl">4.2.2027</span>
              <span className="text-slate-600">—</span>
              <span className="text-lg sm:text-xl">5.2.2027</span>
            </div>
            <div className="mt-0.5 text-[8px] font-mono tracking-[0.22em] text-slate-500 uppercase">Two-Day Deployment</div>
          </div>
        </div>
      )}

      {/* ============ Partner logos — bottom-right (home only) ============ */}
      {gate === 'gone' && !active && !subPage && (
        <div
          className="hud-flat hud-panel-in fixed right-3 sm:right-8 lg:right-44 bottom-2 sm:bottom-4 z-40 pointer-events-none hidden xl:flex flex-col items-center"
          style={{ perspective: '900px' }}
        >
          <div className="flex flex-col items-center" style={{ transform: 'rotateY(-14deg)', transformOrigin: 'right center' }}>
            {/* sign board */}
            <div className="relative rounded-md border border-slate-500/40 bg-gradient-to-b from-slate-800/95 via-slate-900/95 to-slate-950/95 px-2 sm:px-5 pt-2 pb-2.5 sm:pt-3 sm:pb-3.5 shadow-[0_18px_40px_rgba(0,0,0,0.65),0_0_28px_rgba(80,200,255,0.18)]">
              <HudCorners />
              <div className="absolute inset-x-3 top-0 h-[2px] rounded-full bg-cyan-300/80 shadow-[0_0_12px_rgba(80,200,255,0.9)]" />
              <div className="hud-scan pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-cyan-300/15 to-transparent" />
              <div className="text-center text-[7px] sm:text-[9px] font-mono tracking-[0.4em] text-cyan-200/80 uppercase">Presented By</div>
              <div className="mt-1.5 sm:mt-2 flex items-center gap-1.5 sm:gap-4">
                <img src={BASE + 'assets/acmw.png'} alt="ACM-W" decoding="async" className="h-5 sm:h-11 w-auto object-contain" />
                <div className="w-px self-stretch bg-gradient-to-b from-transparent via-slate-400/50 to-transparent" />
                <img src={BASE + 'assets/nexora.png'} alt="NEXORA" decoding="async" className="h-6 sm:h-12 w-auto object-contain" />
              </div>
            </div>
            {/* stand posts */}
            <div className="flex w-[62%] justify-between">
              <div className="w-1 sm:w-1.5 h-6 sm:h-10 bg-gradient-to-r from-slate-500 via-slate-300 to-slate-600" />
              <div className="w-1 sm:w-1.5 h-6 sm:h-10 bg-gradient-to-r from-slate-500 via-slate-300 to-slate-600" />
            </div>
            {/* base foot + floor glow */}
            <div className="relative w-[78%] h-1.5 sm:h-2 rounded-sm bg-gradient-to-b from-slate-400 to-slate-700 shadow-[0_0_14px_rgba(80,200,255,0.35)]">
              <div className="absolute -inset-x-4 top-1 h-4 rounded-[50%] bg-cyan-400/20 blur-md" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
