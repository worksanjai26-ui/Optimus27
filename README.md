# OPTIMUS '27 — National Level Techno Fest

Official website for **OPTIMUS '27**, the national-level techno fest of
**KPR Institute of Engineering and Technology**, Coimbatore — **Feb 4–5, 2027**.

The site is themed around the Transformers: a live 3D stage of four leaders, each
commanding one arena of events. Visitors enter through an animated gate, explore
the arenas, pick a fest pass and register.

**Live site:** https://worksanjai26-ui.github.io/Optimus27/

## Features

- **Cinematic 3D background** (Three.js) — four transforming robots on a
  night-city stage, vehicle-to-robot intros, searchlights, an energy gate and
  billboards for each leader.
- **Home page, top to bottom:**
  - **Loading splash** (logo, spinning chakra, progress bar) and an animated entry gate.
  - **Hero** pinned to the 3D gate ring: date line, *Register* / *Meet the leaders*
    and a live countdown. Scrolling down, the hero lifts away, the arena dims and an
    energon "visor" line draws in where the next section begins.
  - **"The biggest national level techno fest"** — scroll-driven headline and fact panels.
  - **Prize vault** — ₹1,00,000+ overall pool, the hackathon podium
    (₹30k / ₹20k / ₹10k) and the technical / non-technical prize panels.
  - **Events stage** — one card per leader. On laptops and desktops each card pins
    while its robot drives in, transforms (first visit only), stands beside it and
    walks off the far edge; scrolling down holds briefly at each card until its robot
    has arrived. Scrolling up, nav links and the TOP button are never held.
  - **Fest passes** as a deck of cut-corner "access key" cards — the hovered pass rises
    out of the deck.
- **Four arenas**, one per leader, each with its own page (prize pool, events with
  domain, team size, prize split, rules and the passes that cover them):

  | Leader | Arena | Events | Prize pool |
  |---|---|---|---|
  | Bumblebee | 24-hour Hackathon (flagship) | Bumblebee Hackathon | ₹60,000 |
  | Megatron | Presentation Arena | Paper, project, poster and pitch presentations | ₹40,000 |
  | Shockwave | Hands-on Workshops | Three mentor-led workshop tracks | Certificate |
  | Ratchet | Non-Technical Zone | Photography/reels, gaming, quiz & fun events | ₹9,000 |

- **Fest passes** with an in-page registration form (hackathon teams register together):

  | Pass | Price | Covers |
  |---|---|---|
  | Hackathon Pass | ₹500 per member | 24-hour hackathon, teams of 2–4 |
  | Exclusive Pass | ₹500 per person | Every event except the hackathon, both days |
  | One-Day Pass | ₹300 per person | 1 presentation, 1 workshop, 1 non-technical event on one day |
  | Two-Day Pass | ₹400 per person | 2 presentations, 2 workshops, 2 non-technical events |

- **Optimus ID & My Pass** (`/#mypass`) — a personal fest ID (e.g. `OPT27-00142`) with a
  QR code for event check-in. *Demo:* see [Optimus ID demo](#optimus-id-demo).
- **Certificates** (`/#certificate`) — after the fest, enter your Optimus ID and name to
  download one participation certificate per event you attended.
- **Phone-friendly layout** — bottom action bar, venue card with *Directions* and
  *Add dates* (calendar file), and a camera that pulls back so all four leaders fit.
- **Runs on low-end phones and laptops** — see [Performance](#performance).
- **Admin panel** at `/#admin` — registrations, event edits, announcements and a
  visitor counter (see [Admin panel](#admin-panel)).
- Background theme music and a transformation sound effect (muted until the
  visitor enters the site).

## Tech stack

- [React 18](https://react.dev) + TypeScript, built with [Vite 5](https://vitejs.dev)
- [Three.js](https://threejs.org) for the 3D stage
- [Tailwind CSS 3](https://tailwindcss.com) (compiled at build time)
- [lucide-react](https://lucide.dev) icons
- Fonts: Archivo (display), Inter (body), IBM Plex Mono (navigation)

## Getting started

Requires [Node.js](https://nodejs.org) 18 or newer (the deploy uses Node 22).

```bash
npm install      # first time only
npm run dev      # start the dev server
```

Open the URL it prints, e.g. http://localhost:5178/.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload, served from `/` |
| `npm run build` | Production build into `dist/`, served from `/Optimus27/` |
| `npm run preview` | Serve the production build locally (best for judging real speed) |

## Performance

The site is built to stay smooth on low-end phones and Intel-graphics (i3-class) laptops:

- **Quality levels** — the 3D scene picks *low / mid / high* from the device (phones,
  ≤ 4 CPU cores, ≤ 4 GB memory and Intel / mobile GPUs get *low*: no bloom, shadows,
  mirror floor or HDR lighting, lower render resolution). If frames still run slow it
  sheds effects and lowers its resolution on its own.
- **The scene idles when hidden** — while the techno-fest and prize sections fill the
  screen, or on the certificate page, the 3D scene stops drawing entirely. Scrolled down
  elsewhere it draws at half rate unless a robot is on the events stage.
- **Lighter CSS on weak devices** — blur filters, glass effects, particle layers and
  decorative animations are dropped or simplified on the *low* tier.
- **Split bundles** — three.js and React load as separate, long-cached files alongside
  the site code.
- Respects the *reduce motion* setting.

### Testing quality levels

The quality level is detected automatically. To force one, add `?quality=` to the URL:

```
http://localhost:5178/?quality=low    # no bloom, shadows or HDR lighting
http://localhost:5178/?quality=mid
http://localhost:5178/?quality=high   # full effects, mirror floor
```

## Project structure

```
├── index.html               Page shell, fonts, instant loading splash
├── src/
│   ├── main.tsx             Entry point; routes /#admin to the admin panel
│   ├── App.tsx              Site: 3D stage, leaders, events, passes, registration
│   ├── AdminPage.tsx        Admin panel UI
│   ├── adminData.ts         Admin data (localStorage), visitor counter, login
│   ├── identity.ts          Optimus IDs, team checks, attendance (demo data layer)
│   └── index.css            Tailwind entry
├── public/
│   ├── assets/              Logos (fest, KPR, sponsors)
│   ├── env/                 HDR environment lighting for the 3D scene
│   ├── music/theme.mp3      Background theme
│   └── sfx/transform.mp3    Transformation sound
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts           /Optimus27/ base path; three.js and React split into own chunks
└── .github/workflows/deploy.yml   GitHub Pages deployment
```

### Editing content

Fest data lives near the top of `src/App.tsx`:

- `EVENT_DATE` — countdown target.
- `HEROES` — the four leaders, their arenas, events and colours. Each event has a
  `tag` (shown as its *Domain*), `team`, `prize`, `desc`, `rules`, an optional
  `split` (1st / 2nd / 3rd prize) and optional `extra` facts (duration, format …).
- `PASSES` — pass names, prices, perks and validity.
- `CERTIFICATES_OPEN` — when the certificate download opens.

Public files must be referenced through the `BASE` prefix (e.g.
`BASE + 'assets/logo.png'`) so they also load under `/Optimus27/` on GitHub Pages.

### Optional 3D vehicle models

Drop glTF models into `public/models/` as `bumblebee-car.glb`, `megatron-car.glb` or
`ratchet-car.glb` and they replace the code-built vehicles automatically.

## Admin panel

Open `/#admin` (or `/admin` on the dev server). Sign-in is enabled by setting the
SHA-256 hash of the admin password:

```bash
# .env.local (dev)  — or a repository variable for the deploy
VITE_ADMIN_PASSWORD_SHA256=<sha256 of your password>
```

> **Limitations:** this is a frontend-only admin. Registrations, edits and
> announcements are stored in the **browser's localStorage**, so the panel only
> shows data from the same browser, and the password hash ships in the public
> bundle. Replace the functions in `src/adminData.ts` with real API calls before
> relying on it for live registrations. The visitor counter uses the public
> [Abacus](https://abacus.jasoncameron.dev) counter API; dev-server visits are
> counted separately.

## Optimus ID demo

There is no backend yet, so `src/identity.ts` runs on the browser's **localStorage**:
IDs are issued locally, teammates can only be checked against IDs created in the same
browser, and attendance is sample data (pages show a *demo* note while
`IDENTITY_DEMO` is `true`). The pages only call the functions in that file, so swapping
their bodies for real API calls (sign-in, ID issuing, attendance lookups) is all the
backend switch needs. Payments are not wired up yet.

## Deployment

Every push to `main` runs `.github/workflows/deploy.yml`, which builds the site and
publishes `dist/` to **GitHub Pages**. To enable the admin login on the live site, add
`VITE_ADMIN_PASSWORD_SHA256` under *Settings → Secrets and variables → Actions →
Variables*.

## Credits

- Night-city HDR lighting: "Shanghai Bund" from [Poly Haven](https://polyhaven.com) (CC0).
- Presented by **ACM-W** and **Nexora**.
- Transformers names and imagery belong to their respective owners; used here as a
  fest theme.
