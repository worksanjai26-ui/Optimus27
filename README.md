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
- **Four arenas**, one per leader:

  | Leader | Arena | Events |
  |---|---|---|
  | Bumblebee | 24-hour Hackathon (flagship) | Bumblebee Hackathon |
  | Megatron | Presentation Arena | Paper, project and poster presentations |
  | Shockwave | Hands-on Workshops | Technical workshop tracks |
  | Ratchet | Non-Technical Zone | Photography/reels, gaming, quiz & fun events |

- **Fest passes** with an in-page registration form:

  | Pass | Price | Covers |
  |---|---|---|
  | Hackathon Pass | ₹500 per member | 24-hour hackathon, teams of 2–4 |
  | Exclusive Pass | ₹500 per person | Every event except the hackathon, both days |
  | One-Day Pass | ₹300 per person | 1 presentation, 1 workshop, 1 non-technical event on one day |
  | Two-Day Pass | ₹400 per person | 2 presentations, 2 workshops, 2 non-technical events |

- **Live countdown** to the fest, prize-pool reveal and highlights.
- **Phone-friendly layout** — bottom action bar, venue card with *Directions* and
  *Add dates* (calendar file), and a camera that pulls back so all four leaders fit.
- **Runs on low-end devices** — the 3D scene picks a quality level (low / mid / high)
  from the device, and switches off bloom, the mirror floor and shadows on its own if
  frames run slow. Heavy CSS effects are dropped on weaker devices too. Respects the
  *reduce motion* setting.
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

### Testing 3D quality levels

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
│   └── index.css            Tailwind entry
├── public/
│   ├── assets/              Logos (fest, KPR, sponsors)
│   ├── env/                 HDR environment lighting for the 3D scene
│   ├── music/theme.mp3      Background theme
│   └── sfx/transform.mp3    Transformation sound
├── tailwind.config.js
├── postcss.config.js
├── vite.config.ts           Sets the /Optimus27/ base path for production builds
└── .github/workflows/deploy.yml   GitHub Pages deployment
```

### Editing content

Fest data lives near the top of `src/App.tsx`:

- `EVENT_DATE` — countdown target.
- `HEROES` — the four leaders, their arenas, events, prizes and colours.
- `PASSES` — pass names, prices, perks and validity.

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
