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
  Rocket,
  Presentation,
  Wrench,
  Gamepad2,
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
  Megaphone
} from 'lucide-react';
import { listOverrides, listAnnouncements, addRegistration, recordVisit, Announcement, Overrides } from './adminData';

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

// Audio: the orchestrated Transformers theme looping in the background, plus one transformation
// clip. Browsers allow audio only after a user gesture, so playback starts on the ENTER click.
// Realistic vehicle models (glTF binary) dropped into public/models/ replace the code-built
// vehicle shells automatically; while a file is missing the code-built one is used.
// length: bumper-to-bumper size on stage. yaw: extra turn (radians) if a model faces backwards.
const VEHICLE_MODELS: Record<string, { src: string; length: number; yaw?: number }> = {
  bumblebee: { src: '/models/bumblebee-car.glb', length: 5.9 },
  megatron: { src: '/models/megatron-car.glb', length: 6.9 },
  ratchet: { src: '/models/ratchet-car.glb', length: 6.6 }
};

const MUSIC_SRC = '/music/theme.mp3';
// The theme file is mastered very quietly (about -36 dB RMS, peaks near 8%), so it runs through a
// Web Audio gain stage; MUSIC_VOLUME / MUSIC_DUCKED are the fader on top of that boost.
const MUSIC_GAIN = 6;
const MUSIC_VOLUME = 1;
const MUSIC_DUCKED = 0.35;
// The transformation clip is cropped at play time to its busiest stretch (from..to, seconds into
// the file) and starts `delay` seconds after the intro begins, so its big hit (~2.4s into the
// file) lands on the 3D lock-in impact at INTRO_LOCK = 3.5s.
const TRANSFORM_SFX = { src: '/sfx/transform.mp3', from: 0.6, to: 3.6, delay: 1.8, volume: 0.95 };

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
}> = {
  amber: {
    text: 'text-amber-400', hoverText: 'group-hover:text-amber-400',
    ring: 'border-amber-500/50', glow: 'shadow-[0_0_45px_rgba(250,204,21,0.28)]',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    btn: 'bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 hover:from-amber-300 hover:to-yellow-400 text-black',
    grad: 'from-amber-300 via-yellow-400 to-amber-500', dot: 'bg-amber-400'
  },
  rose: {
    text: 'text-rose-400', hoverText: 'group-hover:text-rose-400',
    ring: 'border-rose-500/50', glow: 'shadow-[0_0_45px_rgba(244,63,94,0.28)]',
    chip: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    btn: 'bg-gradient-to-r from-rose-600 via-red-500 to-rose-500 hover:from-rose-500 hover:to-red-400 text-white',
    grad: 'from-slate-200 via-rose-400 to-red-500', dot: 'bg-rose-500'
  },
  purple: {
    text: 'text-fuchsia-400', hoverText: 'group-hover:text-fuchsia-400',
    ring: 'border-fuchsia-500/50', glow: 'shadow-[0_0_45px_rgba(217,70,239,0.28)]',
    chip: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40',
    btn: 'bg-gradient-to-r from-fuchsia-600 via-purple-600 to-violet-600 hover:from-fuchsia-500 hover:to-purple-500 text-white',
    grad: 'from-fuchsia-400 via-purple-500 to-violet-600', dot: 'bg-fuchsia-500'
  },
  cyan: {
    text: 'text-cyan-400', hoverText: 'group-hover:text-cyan-400',
    ring: 'border-cyan-500/50', glow: 'shadow-[0_0_45px_rgba(34,211,238,0.28)]',
    chip: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
    btn: 'bg-gradient-to-r from-cyan-400 via-sky-400 to-cyan-500 hover:from-cyan-300 hover:to-sky-300 text-black',
    grad: 'from-cyan-300 via-sky-400 to-cyan-500', dot: 'bg-cyan-400'
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
  id: string; title: string; tag: string; team: string; prize: string;
  desc: string; rules: string[]; placeholder?: boolean;
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
        tag: 'Flagship • 24 Hours',
        team: '2 – 4 Members',
        prize: '₹60,000',
        desc: 'The flagship national-level hackathon of OPTIMUS \'27. Teams build a working product in 24 non-stop hours across AI/ML, Web, IoT and open-innovation tracks — from idea to live demo.',
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
        tag: 'Technical • Research',
        team: '1 – 2 Members',
        prize: '₹10,000',
        desc: 'Present your original research or technical paper before an expert panel. Domains span AI, ECE, Mechanical, Civil, IT and interdisciplinary innovation.',
        rules: [
          'IEEE format abstract for screening',
          '8-minute presentation + Q&A',
          'Plagiarism check enforced'
        ]
      },
      {
        id: 'project',
        title: 'PROJECT PRESENTATION',
        tag: 'Technical • Prototype',
        team: '1 – 4 Members',
        prize: '₹10,000',
        desc: 'Showcase a working model or prototype. Demonstrate the problem, your solution and its real-world impact to the judges.',
        rules: [
          'Working model / prototype preferred',
          'Live demonstration + viva',
          'Poster or slide support allowed'
        ]
      },
      {
        id: 'poster',
        title: 'POSTER PRESENTATION',
        tag: 'Technical • Visual',
        team: '1 – 2 Members',
        prize: '₹10,000',
        desc: 'Tell a complete technical story on a single poster. Clarity, creativity and depth of concept win the arena.',
        rules: [
          'Single poster (A1 / as specified)',
          '5-minute walkthrough to judges',
          'Bring a printed copy on the day'
        ]
      },
      {
        id: 'presentation-4',
        title: 'PRESENTATION — EVENT 4',
        tag: 'Technical • Placeholder',
        team: 'TBA',
        prize: '₹10,000',
        desc: 'Placeholder — the fourth presentation event of the Megatron arena. Replace with the confirmed event name, format and rules.',
        rules: ['Format: TBA', 'Team size: TBA', 'Rules: TBA'],
        placeholder: true
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
    layout: { x: -17.5, z: -10, scale: 1.24, y: 2.0 },
    events: [
      {
        id: 'workshop-core',
        title: 'TECHNICAL WORKSHOP',
        tag: 'Hands-on • Certified',
        team: 'Individual',
        prize: 'Certificate of Completion',
        desc: 'Instructor-led, hands-on workshop with live exercises and take-home resources. Beginner friendly, mentor supported.',
        rules: [
          'Bring your own laptop',
          'Limited seats — pre-registration required',
          'Certificate on full attendance'
        ]
      },
      {
        id: 'workshop-track-2',
        title: 'WORKSHOP — TRACK 2',
        tag: 'Hands-on • Placeholder',
        team: 'Individual',
        prize: 'Certificate of Completion',
        desc: 'Placeholder track — replace with your confirmed workshop (e.g. AI/ML, IoT & Robotics, Cloud/DevOps, Cybersecurity).',
        rules: ['Bring your own laptop', 'Pre-registration required', 'Topic & mentor: TBA'],
        placeholder: true
      },
      {
        id: 'workshop-track-3',
        title: 'WORKSHOP — TRACK 3',
        tag: 'Hands-on • Placeholder',
        team: 'Individual',
        prize: 'Certificate of Completion',
        desc: 'Placeholder track — replace with your confirmed workshop topic and schedule.',
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
    layout: { x: 17.5, z: -10, scale: 1.24, y: 2.0 },
    prizePool: 9000,
    events: [
      {
        id: 'photography',
        title: 'PHOTOGRAPHY / REELS',
        tag: 'Non-Tech • Placeholder',
        team: 'Individual',
        prize: '₹3,000',
        desc: 'Placeholder event — capture the fest through a lens or a 30-second reel. Replace/confirm the exact theme & rules.',
        rules: ['Original content only', 'Submit on the day', 'Theme: TBA'],
        placeholder: true
      },
      {
        id: 'gaming',
        title: 'GAMING ARENA',
        tag: 'Non-Tech • Placeholder',
        team: 'Solo / Squad',
        prize: '₹3,000',
        desc: 'Placeholder event — competitive gaming tournament (e.g. BGMI / Valorant / Free Fire). Confirm titles & format.',
        rules: ['Bring your own device (if applicable)', 'Bracket-based knockout', 'Titles: TBA'],
        placeholder: true
      },
      {
        id: 'quiz-fun',
        title: 'QUIZ & FUN EVENTS',
        tag: 'Non-Tech • Placeholder',
        team: 'Solo / Duo',
        prize: '₹3,000',
        desc: 'Placeholder event — quiz, connections, treasure hunt, meme-making and more on-the-spot fun. Add your final line-up here.',
        rules: ['On-the-spot registration possible', 'Multiple mini-rounds', 'Events: TBA'],
        placeholder: true
      }
    ]
  }
];

const heroByKey = (k: string | null) => HEROES.find((h) => h.key === k) || null;

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
export type PassId = 'hackathon' | 'oneday' | 'twoday' | 'exclusive' | 'combo';
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
    id: 'combo', name: 'COMBO PASS', price: 950, theme: 'amber', badge: 'BEST VALUE',
    blurb: 'Hackathon Pass + Exclusive Pass combined, for one person.',
    perks: ['24-hour flagship hackathon', 'Every other event on both days', 'Save ₹50 over buying both passes'],
    valid: 'FEB 4 & FEB 5', hackathon: true
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
//   low  – phones/tablets, software renderers, older integrated GPUs, ≤4 cores or ≤4 GB RAM
//   mid  – newer integrated GPUs (Iris Xe, Radeon iGPU) and small screens
//   high – discrete GPUs and Apple silicon
type QualityTier = 'low' | 'mid' | 'high';
const detectQualityTier = (width: number): QualityTier => {
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
  if (/SwiftShader|llvmpipe|Software|Basic Render|Mali|Adreno|PowerVR|Intel.*(HD|UHD)/i.test(gpu)) return 'low';
  if (width < 1024 || /Intel|Radeon(\(TM\))? Graphics|Vega/i.test(gpu)) return 'mid';
  return 'high';
};

const ThreeHeroBackground = ({
  activeHero,
  onSelectHero,
  intro,
  paused = false
}: {
  activeHero: string | null;
  onSelectHero: (key: string) => void;
  intro: { key: string; id: number } | null;
  paused?: boolean;    // true while something opaque covers the scene
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
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

    /* ---------- renderer / camera ---------- */
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1628, 0.014);

    const camera = new THREE.PerspectiveCamera(48, size0.w / size0.h, 0.5, 400);
    camera.position.set(0, 2.2, 18);

    // Everything is drawn through the composer's multisampled target, so the canvas
    // itself needs no MSAA. Render scale adapts to the frame rate (see animate()).
    // In lite mode there is no composer, so the canvas does its own (cheap) MSAA.
    const renderer = new THREE.WebGLRenderer({ antialias: lite, powerPreference: 'high-performance' });
    const DPR_MAX = Math.min(window.devicePixelRatio, tier === 'high' ? 1.25 : 1);
    const DPR_MIN = lite ? 0.5 : 0.7;
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
    if (!lite) new RGBELoader().load('/env/shanghai_bund_2k.hdr', (hdr) => {
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
    if (!lowPower) {
      reflector = new Reflector(new THREE.PlaneGeometry(220, 220), {
        clipBias: 0.003,
        textureWidth: Math.floor(size0.w * 0.5),
        textureHeight: Math.floor(size0.h * 0.5),
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
      ['SHOCKWAVE', 'HANDS-ON WORKSHOPS', '#d05cff', -35, 15.2, -37.6],
      ['MEGATRON', 'PRESENTATION ARENA', '#ff3b3b', -20, 15.2, -37.6],
      ['BUMBLEBEE', '24-HOUR HACKATHON', '#ffd23a', 20, 15.2, -37.6],
      ['RATCHET', 'NON-TECH ZONE', '#3fe0ff', 35, 15.2, -37.6]
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
    const logoImgs: HTMLImageElement[] = ['/assets/acmw.png', '/assets/nexora.png'].map((src) => {
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
        materials, emissives, ring, introStart: -1, locked: false, head, phase: Math.random() * Math.PI * 2, baseY,
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
    const smoke = new THREE.Points(smGeo, new THREE.PointsMaterial({
      size: 2.2, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
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
    const samples = lowPower ? 0 : Math.min(4, renderer.capabilities.maxSamples);
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
      if (reflector) reflector.getRenderTarget().setSize(Math.floor(s.w * 0.5), Math.floor(s.h * 0.5));
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
    let perfAcc = 0, perfFrames = 0, headroomWindows = 0;
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
      if (pausedRef.current && warmFrames > 45) { clock.getDelta(); perfAcc = perfFrames = 0; return; }
      // Scrolled down into the page content the scene is mostly covered: draw at half rate.
      const throttled = window.scrollY > window.innerHeight * 0.8;
      if (throttled) {
        skipOdd = !skipOdd;
        if (skipOdd) return;
      }
      const rawDt = clock.getDelta();
      warmFrames++;
      // Adaptive resolution: step the render scale down quickly when frames run long,
      // and back up only after sustained headroom (each change reallocates targets).
      if (!throttled && !pausedRef.current && rawDt < 0.25) {
        perfAcc += rawDt;
        perfFrames++;
        if (perfAcc > 1.2) {
          const avg = perfAcc / perfFrames;
          perfAcc = perfFrames = 0;
          if (avg > 1 / 45 && dpr > DPR_MIN) {
            dpr = Math.max(DPR_MIN, +(dpr - 0.15).toFixed(2));
            headroomWindows = 0;
            applyDpr();
          } else if (avg < 1 / 57 && dpr < DPR_MAX) {
            if (++headroomWindows >= 4) {
              dpr = Math.min(DPR_MAX, +(dpr + 0.1).toFixed(2));
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
        const hidden = !!focus && !focused;

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
        if (!focused && rec.introStart >= 0) {
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
        const ease = focused ? 0.1 : 0.14;
        g.position.x += ((focused ? 0 : hero.layout.x) - g.position.x) * ease;
        g.position.z += ((focused ? 0 : hero.layout.z) - g.position.z) * ease;
        g.position.y += ((focused ? GROUND_Y : rec.baseY) - g.position.y) * ease;

        if (focused) {
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
            g.position.set(DRIVE_FROM * Math.pow(1 - u, 3), GROUND_Y, 0);
            g.rotation.y = (Math.PI / 2) * (1 - easeIO(t, DRIVE - 0.7, TF_START));
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
            g.position.set(0, GROUND_Y, 0);
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
              burst(new THREE.Vector3(0, GROUND_Y + 4.3 * sc, 0.4), hero.colors.glow);
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

      if (introRec) {
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
        // Sideways drift is kept small so the gate ring stays centred behind the hero wordmark.
        camTarget.set(mouse.x * 0.25 + Math.sin(time * 0.08) * 0.1, 2.6 + mouse.y * 0.5, 18);
        lookTarget.set(0, 1.7, -1);
      } else {
        // Fixed centre-stage framing for whichever hero is inspected.
        camTarget.set(mouse.x * 0.8, 2.4 + mouse.y * 0.4, 14);
        lookTarget.set(0, 1.9, 0);
      }
      // Frame-rate independent easing, so the camera keeps up on slow devices too.
      const camK = 1 - Math.exp(-(introRec ? 5.7 : 3.1) * Math.min(rawDt, 0.5));
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
      const showStands = !focus && !introRec && standMQ.matches;
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

      if (composer) {
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
  { text: 'text-rose-400',    border: 'border-rose-500/50',    dot: '#fb7185' },   // red
  { text: 'text-amber-400',   border: 'border-amber-500/50',   dot: '#fbbf24' },   // yellow
  { text: 'text-fuchsia-400', border: 'border-fuchsia-500/50', dot: '#e879f9' },   // purple
  { text: 'text-cyan-400',    border: 'border-cyan-500/50',    dot: '#22d3ee' }    // cyan
];

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
  background: linear-gradient(105deg, transparent 38%, rgba(255,255,255,.62) 50%, transparent 62%);
  background-size: 260% 100%; background-repeat: no-repeat;
  -webkit-mask: url(/assets/logo-hd.webp) center / contain no-repeat;
          mask: url(/assets/logo-hd.webp) center / contain no-repeat;
  animation: gateSheen 6s ease-in-out 1s infinite;
}
@keyframes gateSheen { 0% { background-position: 130% 0; } 28%, 100% { background-position: -30% 0; } }

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
.prize-sec { background: transparent; }
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
.lift-card { transition: transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s ease, border-color .25s ease; will-change: transform; }
.lift-card:hover { transform: translateY(-8px); box-shadow: 0 22px 44px rgba(0,0,0,.5), 0 0 34px rgba(250,204,21,.16); }
.lift-card::after {
  content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0;
  background: linear-gradient(115deg, transparent 40%, rgba(255,255,255,.12) 50%, transparent 60%);
  background-size: 220% 100%; background-position: 150% 0; transition: opacity .3s ease;
}
.lift-card:hover::after { opacity: 1; animation: cardSheen 1s ease-out; }
@keyframes cardSheen { from { background-position: 150% 0; } to { background-position: -40% 0; } }
.stat-tile { transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s ease, border-color .22s ease; }
.stat-tile:hover { transform: translateY(-6px); border-color: rgba(250,204,21,.5); box-shadow: 0 16px 30px rgba(0,0,0,.45), 0 0 26px rgba(250,204,21,.18); }
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

@media (prefers-reduced-motion: reduce) {
  .hero-in, .hud-in, .hud-bar, .hud-flash, .hud-panel-in, .hud-scan,
  .gate-grid, .gate-beam, .gate-ring, .gate-ring-rev, .gate-sheen,
  .gate-rise, .emblem-in, .scene-in, .fade-in,
  .prize-glow, .prize-mote, .prize-sweep, .prize-rise, .prize-plus-on, .prize-heading-sweep,
  .tr-3d, .tr-cup, .tr-base, .tr-hL, .tr-hR, .tr-star { animation: none !important; }
  .prize-trophy, .prize-rise, .prize-plus, .tr-cup, .tr-base, .tr-hL, .tr-hR, .tr-star { opacity: 1 !important; transform: none !important; }
  .lift-card:hover, .stat-tile:hover { transform: none; }
  .gate-mote, .gate-sheen { display: none; }
  .hud-flash { opacity: 0; }
  .gate-emblem, .gate-emblem:hover, .gate-emblem:active { transform: none; }
}
`;

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
      className={`prize-sec relative py-24 sm:py-28 px-4 ${shown ? 'prize-in' : 'prize-pre'}`}
    >
      {/* Transparent section: the live 3D robot scene shows through. Only a soft gold halo
          behind the trophy + a few drifting motes are added, no opaque backdrop. */}
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
        <div className="prize-rise mt-5 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 text-[11px] sm:text-sm font-mono font-bold tracking-[0.25em] text-amber-200 uppercase" style={{ animationDelay: '.46s' }}>
          <Trophy className="w-4 h-4" /> 10+ Events · One Ultimate Experience
        </div>
        <div className="prize-rise mt-8" style={{ animationDelay: '.58s' }}>
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
  useEffect(() => {
    // Drop the instant HTML splash as soon as React has rendered the real entry screen.
    const s = document.getElementById('splash');
    if (s) { s.style.opacity = '0'; setTimeout(() => s.remove(), 450); }
  }, []);
  // Becomes true as the entry screen starts to open: resumes the 3D scene and eases the site in.
  const [entered, setEntered] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventItem | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    leaderName: '',
    members: ['', '', ''],   // members 2–4 of a hackathon team
    email: '',
    phone: '',
    college: ''
  });
  const pass = passById(formData.pass);
  const pt = THEME[pass.theme];
  const passQty = pass.team ? formData.teamSize : 1;
  const passTotal = pass.price * passQty;
  const passValid = pass.pickDay ? `${FEST_DAYS[formData.day]} ONLY` : pass.valid;

  const active = heroByKey(activeHero);
  // Content waits for the armour to lock in on a first visit; otherwise it just eases in.
  const introPlaying = !!intro && !!active && intro.key === active.key;
  const introDelay = (extra: number) => `${(introPlaying ? 3.6 : 0.05) + extra}s`;
  const t = THEME[active ? active.theme : 'amber'];

  /* ---- live countdown ---- */
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
  const [timeLeft, setTimeLeft] = useState(computeLeft());
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(computeLeft()), 1000);
    return () => clearInterval(id);
  }, []);

  /* ---- navigation ---- */
  const goHero = useCallback((key: string) => {
    if (!visitedRef.current.has(key)) {
      visitedRef.current.add(key);
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) audioFX.playTransform();
      setIntro({ key, id: Date.now() });
    }
    setActiveHero(key);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const goHome = useCallback(() => {
    setActiveHero(null);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  // The passes section lives on the home page, so leave any hero page first.
  const goPasses = useCallback(() => {
    setActiveHero(null);
    setMobileMenuOpen(false);
    setTimeout(() => document.getElementById('passes')?.scrollIntoView({ behavior: 'smooth' }), 80);
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
    if (gate !== 'show') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      enterSite();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gate, enterSite]);

  const openRegister = (passId?: PassId) => {
    if (passId) setFormData((f) => ({ ...f, pass: passId }));
    setSelectedEvent(null);
    setRegisterSuccess(false);
    setIsRegisterOpen(true);
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addRegistration({
      pass: pass.id,
      day: pass.pickDay ? formData.day : null,
      team_name: pass.team || pass.id === 'combo' ? formData.teamName.trim() : null,
      leader_name: formData.leaderName.trim(),
      members: pass.team ? formData.members.slice(0, formData.teamSize - 1).map((m) => m.trim()) : [],
      email: formData.email.trim(),
      phone: formData.phone.trim(),
      college: formData.college.trim(),
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

  const HERO_ICON: Record<string, React.ReactNode> = {
    bumblebee: <Rocket className="w-full h-full" />,
    megatron: <Presentation className="w-full h-full" />,
    shockwave: <Wrench className="w-full h-full" />,
    ratchet: <Gamepad2 className="w-full h-full" />
  };

  const trio = HEROES.filter((h) => h.kind !== 'main');
  const bumblebee = HEROES.find((h) => h.kind === 'main')!;
  const bt = THEME[bumblebee.theme];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-amber-400 selection:text-black relative overflow-x-hidden">

      {/* Themed targeting-reticle cursor (recolors with the active faction) */}
      <style dangerouslySetInnerHTML={{ __html: buildCursorCss(CURSOR_HEX[active ? active.theme : 'amber']) }} />

      {/* 3D leaders background */}
      <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />
      {mount3D && <ThreeHeroBackground activeHero={activeHero} onSelectHero={goHero} intro={intro} paused={!entered} />}

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
            className="gate-content relative h-full flex flex-col items-center justify-center text-center px-5"
            style={{ gap: 'clamp(12px, 2.8vh, 28px)' }}
          >
            <div className="gate-rise gate-fade inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 text-[10px] sm:text-xs font-mono font-bold tracking-[0.3em] text-amber-200 shadow-[0_0_18px_rgba(250,204,21,0.12)]">
              <Sparkles className="w-3.5 h-3.5" /> NATIONAL LEVEL TECHNO FEST
            </div>

            <h1
              className="gate-rise gate-fade font-black uppercase leading-[0.9] tracking-tight whitespace-nowrap"
              style={{ fontSize: 'clamp(2rem, min(9vw, 12vh), 8rem)', animationDelay: '.15s' }}
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
            <div className="emblem-in mt-[clamp(8px,2vh,20px)]" style={{ animationDelay: '0s' }}>
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
                  src="/assets/logo-hd.webp"
                  alt=""
                  width={240}
                  height={240}
                  decoding="async"
                  fetchPriority="high"
                  onLoad={() => setMount3D(true)}
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
      <header className={`fixed top-0 left-0 right-0 z-50 ${entered ? 'fade-in' : ''}`}>
        <div className="relative px-6 sm:px-12 lg:px-16 h-20 flex items-center justify-between gap-3">

          <button onClick={goHome} className="flex items-center gap-3 text-left">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <img
                src="/assets/logo-hd.webp"
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

          <nav className="hidden lg:flex items-center gap-8 xl:gap-10 font-plex font-bold text-[13px] uppercase" style={{ letterSpacing: '0.2em' }}>
            <button onClick={goHome} className={`transition-colors hover:text-white ${!activeHero ? t.text : 'text-white'}`}>HOME</button>
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
          </nav>

          <div className="hidden sm:flex items-center gap-4">
            <button
              onClick={toggleSound}
              className="p-2 text-slate-400 hover:text-white transition-colors"
              title={soundEnabled ? 'Mute music' : 'Play music'}
            >
              {soundEnabled ? <Volume2 className={`w-5 h-5 ${t.text}`} /> : <VolumeX className="w-5 h-5 text-slate-500" />}
            </button>
            <button
              onClick={() => openRegister()}
              className={`px-5 py-2.5 rounded-xl ${t.btn} text-xs font-black tracking-widest shadow-lg transition-transform active:scale-95`}
            >
              REGISTER
            </button>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className={`lg:hidden p-2 border ${t.ring} bg-slate-950/40 text-slate-200`}
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="lg:hidden border-b border-slate-800 bg-slate-950/95 p-4 space-y-1 font-mono text-xs">
            <button onClick={goHome} className="block w-full text-left py-2 text-slate-300 font-bold">HOME</button>
            {HEROES.map((h) => (
              <button key={h.key} onClick={() => goHero(h.key)} className={`block w-full text-left py-2 font-bold ${THEME[h.theme].text}`}>
                {h.name} <span className="text-slate-500">· {h.tagline}</span>
              </button>
            ))}
            <button onClick={goPasses} className="block w-full text-left py-2 text-slate-300 font-bold">PASSES <span className="text-slate-500">· Pricing &amp; access</span></button>
            <button onClick={() => openRegister()} className={`mt-3 w-full px-4 py-2.5 text-xs rounded-lg ${t.btn} font-black`}>REGISTER</button>
          </div>
        )}
      </header>

      {/* ===================== MAIN ===================== */}
      <main className="relative z-10 pt-20">

        {!active ? (
          /* ======================= HOME ======================= */
          <>
            {/* Hero band — pointer-events pass through to the 3D scene except on controls */}
            <section className="min-h-[calc(100vh-5rem)] flex items-start sm:items-center justify-center relative px-4 pt-3 pb-56 sm:py-16 sm:[@media(max-height:820px)]:py-6 pointer-events-none">
              <div className={`max-w-5xl mx-auto text-center space-y-4 sm:space-y-7 ${entered ? 'scene-in' : ''}`}>
                <img
                  src="/assets/kpr-hd.png"
                  alt="KPR Institute of Engineering and Technology"
                  decoding="async"
                  className="kpr-bold mx-auto w-auto object-contain"
                  style={{ height: 'clamp(2.75rem, 8vh, 6rem)', transform: 'translateY(1.5vh)' }}
                />

                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700/60 bg-slate-900/90 pointer-events-auto">
                  <Sparkles className={`w-4 h-4 ${t.text}`} />
                  <span className="text-[10px] sm:text-xs font-mono tracking-widest text-slate-300 uppercase">
                    National Level Techno Fest
                  </span>
                </div>

                {/* Sized against the viewport height so the wordmark stays inside the 3D gate ring behind it
                    (the ring projects to ~54vh across at the fixed 48° FOV). */}
                <h1 ref={heroTitleRef} className="opt-word font-black leading-none uppercase whitespace-nowrap" style={{ fontSize: 'clamp(1.7rem, min(6.25vh, 7.3vw), 5.5rem)', letterSpacing: '-0.035em' }}>
                  <span className="metal-text">OPTIMUS</span> <span className="gold-text">'27</span>
                </h1>
                <p className="font-extrabold tracking-widest text-slate-200 max-w-3xl mx-auto uppercase" style={{ fontSize: 'clamp(0.85rem, min(2vh, 3.8vw), 1.2rem)' }}>
                  ROLL OUT. TRANSFORM YOUR <span className={`${t.text} underline decoration-2`}>DESTINY</span>
                </p>

                {/* Countdown */}
                {/* Plain, widely tracked white figures separated by colons, labels underneath. */}
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

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2 pointer-events-auto">
                  <button
                    onClick={() => openRegister()}
                    className={`w-full sm:w-auto px-8 py-4 rounded-xl ${t.btn} text-xs font-black tracking-widest shadow-2xl flex items-center justify-center gap-2 group transition-all hover:scale-105`}
                  >
                    REGISTER NOW <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <a
                    href="#roster"
                    className="w-full sm:w-auto px-8 py-4 rounded-xl bg-slate-900/90 border border-slate-700/80 hover:bg-slate-800 text-slate-200 text-xs font-mono font-bold tracking-widest transition-all"
                  >
                    MEET THE LEADERS
                  </a>
                </div>

              </div>
            </section>

            {/* Overall prize-pool cinematic reveal */}
            <PrizePoolSection onExplore={() => document.getElementById('roster')?.scrollIntoView({
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
            })} />

            {/* Roster */}
            <section id="roster" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-24">
              <div className="text-center max-w-3xl mx-auto mb-12 space-y-3">
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono border ${t.chip}`}>
                  <Shield className="w-3.5 h-3.5" /> CHOOSE YOUR LEADER
                </div>
                <h2 className="text-3xl sm:text-5xl font-black tracking-tight uppercase">THE ALLSPARK ROSTER</h2>
                <p className="text-slate-400 text-sm sm:text-base">
                  Every event of OPTIMUS '27 is commanded by a Transformer. Enter a leader's arena to see their events.
                </p>
              </div>

              {/* BUMBLEBEE — main event, full width */}
              <button
                onClick={() => goHero(bumblebee.key)}
                className={`group w-full text-left mb-6 relative overflow-hidden rounded-3xl bg-slate-900/90 border ${bt.ring} ${bt.glow} p-6 sm:p-10 transition-all hover:-translate-y-1`}
              >
                <div className={`absolute -top-10 -right-10 w-56 h-56 rounded-full bg-gradient-to-br ${bt.grad} opacity-20 blur-3xl`} />
                <div className="relative flex flex-col md:flex-row md:items-center gap-6 md:gap-10">
                  <div className={`w-20 h-20 sm:w-28 sm:h-28 shrink-0 rounded-2xl bg-slate-950 border ${bt.ring} p-5 ${bt.text} group-hover:scale-110 transition-transform`}>
                    {HERO_ICON[bumblebee.key]}
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-mono font-bold tracking-widest border ${bt.chip}`}>
                        ★ MAIN EVENT
                      </span>
                      <span className="px-3 py-1 rounded-full text-[10px] font-mono tracking-widest border border-slate-700 text-slate-400">
                        {bumblebee.faction}
                      </span>
                    </div>
                    <h3 className={`text-4xl sm:text-6xl font-black tracking-tight uppercase ${bt.text}`}>
                      {bumblebee.name}
                    </h3>
                    <p className="text-slate-300 text-sm sm:text-base max-w-2xl">
                      <span className="font-bold text-white">{bumblebee.tagline}.</span> {bumblebee.lore}
                    </p>
                  </div>
                  <div className="shrink-0 flex md:flex-col items-center md:items-end gap-3">
                    <span className={`text-xs font-mono px-3 py-1 rounded bg-slate-800 ${bt.text}`}>
                      {bumblebee.events.length} EVENT
                    </span>
                    {bumblebee.prizePool && (
                      <span className={`text-xs font-mono font-bold px-3 py-1 rounded bg-slate-800 ${bt.text}`}>
                        {inr(bumblebee.prizePool)} PRIZE POOL
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-2 px-5 py-3 rounded-xl ${bt.btn} text-xs font-black tracking-widest`}>
                      ENTER ARENA <ChevronRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </button>

              {/* The other three — block next to next */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                {trio.map((h) => {
                  const ht = THEME[h.theme];
                  return (
                    <button
                      key={h.key}
                      onClick={() => goHero(h.key)}
                      className={`group text-left relative overflow-hidden rounded-3xl bg-slate-900/90 border ${ht.ring} ${ht.glow} p-6 transition-all hover:-translate-y-2 flex flex-col justify-between min-h-[300px]`}
                    >
                      <div className={`absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gradient-to-br ${ht.grad} opacity-10 blur-2xl group-hover:opacity-25 transition-opacity`} />
                      <div className="relative space-y-4">
                        <div className={`w-16 h-16 rounded-2xl bg-slate-950 border ${ht.ring} p-4 ${ht.text} group-hover:scale-110 transition-transform`}>
                          {HERO_ICON[h.key]}
                        </div>
                        <span className="block text-[10px] font-mono tracking-widest text-slate-400">{h.faction} · {h.role}</span>
                        <h3 className={`text-xl xl:text-2xl font-black tracking-tight uppercase ${ht.hoverText} transition-colors`}>
                          {h.name}
                        </h3>
                        <p className="text-slate-400 text-sm">{h.tagline}</p>
                      </div>
                      <div className="relative pt-6 mt-6 border-t border-slate-800/80 flex items-center justify-between">
                        <span className={`text-xs font-mono ${ht.text}`}>
                          {h.events.length} EVENTS{h.prizePool ? ` · ${inr(h.prizePool)} PRIZE POOL` : ''}
                        </span>
                        <span className="p-2.5 rounded-xl bg-slate-800 text-slate-200 group-hover:bg-slate-700 transition-colors">
                          <ChevronRight className="w-5 h-5" />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Fest passes */}
            <section id="passes" className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto scroll-mt-24">
              <div className="text-center max-w-3xl mx-auto mb-12 space-y-3">
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono border ${t.chip}`}>
                  <Ticket className="w-3.5 h-3.5" /> FEST PASSES
                </div>
                <h2 className="text-3xl sm:text-5xl font-black tracking-tight uppercase">CHOOSE YOUR PASS</h2>
                <p className="text-slate-400 text-sm sm:text-base">
                  One pass, many arenas. Pick the access that fits your mission for Feb 4 – 5, 2027.
                </p>
              </div>

              {[PASSES.filter((p) => p.hackathon), PASSES.filter((p) => !p.hackathon)].map((row, ri) => (
                <div key={ri} className={`grid grid-cols-1 gap-6 ${ri === 0 ? 'md:grid-cols-2 mb-6' : 'md:grid-cols-3'}`}>
                  {row.map((p) => {
                    const ptk = THEME[p.theme];
                    return (
                      <div
                        key={p.id}
                        className={`lift-card relative overflow-hidden rounded-3xl bg-slate-900/90 border ${ptk.ring} ${ptk.glow} p-6 sm:p-8 flex flex-col`}
                      >
                        <div className={`absolute -top-12 -right-12 w-44 h-44 rounded-full bg-gradient-to-br ${ptk.grad} opacity-15 blur-3xl`} />
                        <div className="relative flex items-center justify-between gap-3">
                          <span className={`text-xs font-mono font-bold tracking-widest ${ptk.text}`}>{p.name}</span>
                          {p.badge && (
                            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-widest border ${ptk.chip}`}>
                              ★ {p.badge}
                            </span>
                          )}
                        </div>
                        <div className="relative mt-4 flex items-baseline gap-2">
                          <span className="font-num font-bold leading-none text-4xl sm:text-5xl">{inr(p.price)}</span>
                          <span className="text-xs font-mono text-slate-400">/ {p.team ? 'member' : 'person'}</span>
                        </div>
                        <p className="relative mt-2 text-sm text-slate-300">{p.blurb}</p>
                        <ul className="relative mt-5 space-y-2 text-sm text-slate-300 flex-1">
                          {p.perks.map((perk) => (
                            <li key={perk} className="flex items-start gap-2">
                              <CheckCircle className={`w-4 h-4 mt-0.5 shrink-0 ${ptk.text}`} /> {perk}
                            </li>
                          ))}
                        </ul>
                        <button
                          onClick={() => openRegister(p.id)}
                          className={`relative mt-6 w-full py-3.5 rounded-xl ${ptk.btn} text-xs font-black tracking-widest flex items-center justify-center gap-2 transition-transform active:scale-[0.98]`}
                        >
                          GET {p.name} <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>

            {/* Highlights strip */}
            <section className="py-16 px-4 max-w-7xl mx-auto">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: <Rocket className="w-6 h-6" />, val: '24 Hrs', label: 'Flagship Hackathon' },
                  { icon: <Trophy className="w-6 h-6" />, val: '10+', label: 'Events' },
                  { icon: <Users className="w-6 h-6" />, val: 'National', label: 'Level Fest' },
                  { icon: <Calendar className="w-6 h-6" />, val: '2 Days', label: 'Feb 4–5, 2027' }
                ].map((s, i) => (
                  <div key={i} className={`stat-tile p-5 rounded-2xl bg-slate-900/90 border ${QUAD[i].border} text-center space-y-2`}>
                    <div className={`stat-ico inline-flex p-3 rounded-xl bg-slate-950 border border-slate-800 ${QUAD[i].text}`}>{s.icon}</div>
                    <h4 className={`font-sans font-semibold tracking-tight leading-none text-2xl sm:text-3xl ${QUAD[i].text}`}>{s.val}</h4>
                    <p className="text-[11px] font-mono tracking-wider text-slate-400 uppercase">{s.label}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : (
          /* ======================= HERO PAGE ======================= */
          <section key={active.key} className="min-h-[calc(100vh-5rem)] px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto py-10">
            <button
              onClick={goHome}
              className="inline-flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-slate-400 hover:text-white mb-8"
            >
              <ArrowLeft className="w-4 h-4" /> BACK TO ROSTER
            </button>

            <div className="grid lg:grid-cols-2 gap-10 items-start">
              {/* Left: identity (the 3D figure sits behind, visible around this column) */}
              <div className="space-y-6 lg:sticky lg:top-28 hero-in" style={{ animationDelay: introDelay(0) }}>
                <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono border ${t.chip}`}>
                  <span className={`h-2 w-2 rounded-full ${t.dot} animate-pulse`} /> {active.faction} · {active.role}
                </div>
                <h1 className={`text-5xl sm:text-7xl font-black tracking-tight uppercase bg-clip-text text-transparent bg-gradient-to-r ${t.grad}`}>
                  {active.name}
                </h1>
                <p className={`text-lg sm:text-2xl font-extrabold tracking-wide uppercase ${t.text}`}>{active.tagline}</p>
                <p className="text-slate-300 leading-relaxed text-sm sm:text-base max-w-lg">{active.lore}</p>
                {(active.kind === 'main' || active.prizePool) && (
                  <div className="flex flex-wrap gap-3">
                    {active.kind === 'main' && (
                      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${t.ring} ${t.glow} bg-slate-900/70 text-xs font-mono font-bold tracking-widest ${t.text}`}>
                        ★ FLAGSHIP MAIN EVENT
                      </div>
                    )}
                    {active.prizePool && (
                      <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border ${t.ring} bg-slate-900/70 text-xs font-mono font-bold tracking-widest ${t.text}`}>
                        <Trophy className="w-4 h-4" /> {inr(active.prizePool)} PRIZE POOL
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap gap-3 pt-2">
                  <button onClick={() => openRegister(active.kind === 'main' ? 'hackathon' : 'oneday')} className={`px-6 py-3 rounded-xl ${t.btn} text-xs font-black tracking-widest`}>
                    REGISTER FOR {active.name}
                  </button>
                  {HEROES.filter((h) => h.key !== active.key).map((h) => (
                    <button key={h.key} onClick={() => goHero(h.key)} className="px-4 py-3 rounded-xl bg-slate-900/90 border border-slate-800 hover:bg-slate-800 text-slate-300 text-[11px] font-mono font-bold tracking-widest">
                      {h.name} →
                    </button>
                  ))}
                </div>
              </div>

              {/* Right: events under this leader */}
              <div className="space-y-4">
                <h2 className="text-xs font-mono tracking-widest text-slate-400 uppercase mb-2">
                  EVENTS UNDER {active.name} · {active.events.length}
                </h2>
                {active.events.map((ev, i) => (
                  <div
                    key={ev.id}
                    style={{ animationDelay: introDelay(0.12 + i * 0.1) }}
                    onClick={() => setSelectedEvent(ev)}
                    className={`hero-in group p-6 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-600 ${t.glow} transition-all cursor-pointer hover:-translate-y-1`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-mono px-2.5 py-1 rounded border ${t.chip}`}>{ev.tag}</span>
                          {ev.placeholder && (
                            <span className="text-[10px] font-mono px-2.5 py-1 rounded border border-slate-700 text-slate-500">PLACEHOLDER</span>
                          )}
                        </div>
                        {/* Flagship prize pool, shown big above the hackathon title */}
                        {ev.id === 'hackathon' && (
                          <div className="flex items-center gap-3 pt-1">
                            <Trophy className="w-9 h-9 text-amber-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.5)] shrink-0" />
                            <span className="gold-text font-mono font-black leading-none tracking-tight" style={{ fontSize: 'clamp(2.4rem, 5vw, 3.6rem)' }}>{ev.prize}</span>
                            <span className="text-[11px] sm:text-xs font-mono font-bold tracking-[0.3em] text-amber-200 uppercase leading-tight">Prize<br />Pool</span>
                          </div>
                        )}
                        <h3 className={`text-xl font-black tracking-wide uppercase ${t.hoverText} transition-colors`}>{ev.title}</h3>
                        <p className="text-slate-400 text-sm max-w-md">{ev.desc}</p>
                      </div>
                      <span className="p-2.5 rounded-xl bg-slate-800 text-slate-200 group-hover:bg-slate-700 transition-colors shrink-0">
                        <ChevronRight className="w-5 h-5" />
                      </span>
                    </div>
                    <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-2 gap-4 text-xs font-mono">
                      <div>
                        <span className="text-slate-500 uppercase block text-[10px]">Team</span>
                        <span className="text-slate-200">{ev.team}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 uppercase block text-[10px]">{ev.prize.startsWith('₹') ? 'Prize Pool' : 'Prize'}</span>
                        <span className={t.text}>{ev.prize}</span>
                      </div>
                    </div>
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
            className={`max-w-xl w-full rounded-3xl bg-slate-900 border ${t.ring} ${t.glow} p-6 sm:p-8 space-y-6 relative`}
          >
            <button onClick={() => setSelectedEvent(null)} className="absolute top-6 right-6 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <div className="space-y-2">
              <span className={`text-[10px] font-mono px-2.5 py-1 rounded border ${t.chip}`}>{selectedEvent.tag}</span>
              {selectedEvent.id === 'hackathon' && (
                          <div className="flex items-center gap-3 pt-1">
                            <Trophy className="w-9 h-9 text-amber-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.5)] shrink-0" />
                            <span className="gold-text font-mono font-black leading-none tracking-tight" style={{ fontSize: 'clamp(2.2rem, 7vw, 3rem)' }}>{selectedEvent.prize}</span>
                            <span className="text-[11px] sm:text-xs font-mono font-bold tracking-[0.3em] text-amber-200 uppercase leading-tight">Prize<br />Pool</span>
                          </div>
                        )}
              <h3 className="text-2xl font-black uppercase">{selectedEvent.title}</h3>
              <p className="text-xs font-mono text-slate-500">Commanded by {active?.name}</p>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">{selectedEvent.desc}</p>
            <div className="grid grid-cols-2 gap-4 p-4 rounded-2xl bg-slate-950 border border-slate-800">
              <div>
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Team Size</span>
                <span className="text-sm font-bold text-slate-200">{selectedEvent.team}</span>
              </div>
              <div>
                <span className="text-[10px] font-mono text-slate-500 uppercase block">{selectedEvent.prize.startsWith('₹') ? 'Prize Pool' : 'Prize'}</span>
                <span className={`text-sm font-black ${t.text} font-mono`}>{selectedEvent.prize}</span>
              </div>
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
      {isRegisterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85" onClick={() => { setIsRegisterOpen(false); setRegisterSuccess(false); }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Registration"
            onClick={(e) => e.stopPropagation()}
            className={`max-w-lg w-full rounded-3xl bg-slate-900 border ${pt.ring} ${pt.glow} p-6 sm:p-8 space-y-6 relative max-h-[90vh] overflow-y-auto`}
          >
            <button onClick={() => { setIsRegisterOpen(false); setRegisterSuccess(false); }} className="absolute top-6 right-6 p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>

            {!registerSuccess ? (
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

                  {(pass.team || pass.id === 'combo') && (
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">{pass.team ? 'TEAM NAME' : 'HACKATHON TEAM NAME'}</label>
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

                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-1">{pass.team ? 'TEAM LEADER NAME' : 'FULL NAME'}</label>
                    <input
                      type="text" required placeholder="e.g., Alex Prime"
                      value={formData.leaderName}
                      onChange={(e) => setFormData({ ...formData, leaderName: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
                    />
                  </div>

                  {pass.team && formData.members.slice(0, formData.teamSize - 1).map((m, i) => (
                    <div key={i}>
                      <label className="text-xs font-mono text-slate-400 block mb-1">MEMBER {i + 2} NAME</label>
                      <input
                        type="text" required placeholder={`Member ${i + 2}`}
                        value={m}
                        onChange={(e) => {
                          const members = [...formData.members];
                          members[i] = e.target.value;
                          setFormData({ ...formData, members });
                        }}
                        className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
                      />
                    </div>
                  ))}

                  <div>
                    <label className="text-xs font-mono text-slate-400 block mb-1">COLLEGE / INSTITUTION</label>
                    <input
                      type="text" required placeholder="Your college name"
                      value={formData.college}
                      onChange={(e) => setFormData({ ...formData, college: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">EMAIL</label>
                      <input
                        type="email" required placeholder="cadet@college.edu"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-mono text-slate-400 block mb-1">PHONE</label>
                      <input
                        type="tel" required placeholder="+91 9876543210"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-sm focus:outline-none focus:border-slate-500"
                      />
                    </div>
                  </div>

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
                    {(pass.team || pass.id === 'combo') && (
                      <div className="flex justify-between gap-3"><span className="text-slate-500">TEAM:</span><span className="text-white font-bold text-right">{formData.teamName}</span></div>
                    )}
                    <div className="flex justify-between gap-3"><span className="text-slate-500">{pass.team ? 'LEADER:' : 'NAME:'}</span><span className="text-slate-300 text-right">{formData.leaderName}</span></div>
                    {pass.team && (
                      <div className="flex justify-between gap-3"><span className="text-slate-500">MEMBERS:</span><span className="text-slate-300 text-right">{formData.members.slice(0, formData.teamSize - 1).join(', ')}</span></div>
                    )}
                    <div className="flex justify-between gap-3"><span className="text-slate-500">COLLEGE:</span><span className="text-slate-300 text-right">{formData.college}</span></div>
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
      <footer className="border-t border-slate-800/80 bg-slate-950/90 py-10 relative z-10 text-xs text-slate-400 font-mono">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
          <div className="flex items-center gap-2">
            <Zap className={`w-4 h-4 ${t.text}`} />
            <span>OPTIMUS '27 · National Level Techno Fest</span>
          </div>
          <div className="text-slate-500">
            KPR Institute of Engineering and Technology, Coimbatore · Feb 4–5, 2027
          </div>
          <div className="text-slate-500">© 2027 OPTIMUS '27</div>
        </div>
      </footer>

      {/* ============ CYBERTRON HUD — bottom-left tactical panels (home only) ============ */}
      {gate === 'gone' && !active && (
        <div className="hud-flat fixed left-2.5 sm:left-5 bottom-2.5 sm:bottom-5 z-40 pointer-events-none flex flex-col gap-2 sm:gap-2.5 w-[min(60vw,270px)]">
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
      {gate === 'gone' && !active && (
        <div
          className="hud-flat hud-panel-in fixed right-3 sm:right-8 bottom-2 sm:bottom-4 z-40 pointer-events-none flex flex-col items-center"
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
                <img src="/assets/acmw.png" alt="ACM-W" decoding="async" className="h-5 sm:h-11 w-auto object-contain" />
                <div className="w-px self-stretch bg-gradient-to-b from-transparent via-slate-400/50 to-transparent" />
                <img src="/assets/nexora.png" alt="NEXORA" decoding="async" className="h-6 sm:h-12 w-auto object-contain" />
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
