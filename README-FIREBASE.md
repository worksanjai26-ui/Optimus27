# Firebase backend: setup guide

This turns the demo into the real thing: Google sign-in, Optimus IDs issued by a server,
team registration stored in a database, an admin panel only the organisers can open, and a
private Google Sheet kept up to date automatically.

## What runs where

| Piece | What it does | Where it lives |
|---|---|---|
| Website | The pages people see (GitHub Pages) | this repo, `src/` |
| Firebase Authentication | "Sign in with Google" for participants and admins | Firebase |
| Firestore | The database: profiles, registrations, announcements | Firebase, protected by `firestore.rules` |
| Cloud Functions | Issue Optimus IDs, check teammates, create registrations, delete, copy to the Sheet | Firebase, `functions/` |
| Google Sheet | A private copy for the organisers | your Google Drive |

The website can **read only the signed-in person's own profile and registrations**. It can
never write profiles, IDs or registrations: only the Cloud Functions can, and they re-check
everything on the server (name, team size, price, "one team per person per event").
Nothing in the site's code is a password. The Firebase web config in the bundle is an
identifier, not a secret.

## Rules the server enforces

- A participant signs in with Google; the server issues the next `OPT27-xxxxx` ID once per account.
- A team leader (signed in, with an ID) registers a team by entering each member's Optimus ID and name.
  The server confirms the ID and name match a real participant. A wrong name and an unknown ID give the
  same answer, so nobody can probe which IDs exist.
- Hackathon team size is 2 to 4 including the leader; other passes are for one person.
- A person can be in **one team per event** (for the one-day pass: one per day). Leaders just add
  members; no invitation step.
- The price is worked out on the server (the browser cannot change it).
- Only the two admin Google accounts can read everyone's data or delete a registration. Deleting frees
  the team's places again.

## One-time setup

You need a Google account that will own the Firebase project. Ask the owner to do steps 1 to 7.

1. **Create the project.** Go to <https://console.firebase.google.com>, *Add project*, name it
   (for example `optimus27`). Google Analytics can be off.
2. **Upgrade to the Blaze plan** (*Usage and billing*). Cloud Functions need it. It still includes a free
   monthly allowance, and a small fest will normally cost nothing. It asks for a billing card: set a
   **budget alert** (for example INR 100) under *Billing → Budgets & alerts* so you are warned early.
3. **Create the database.** *Build → Firestore Database → Create database*, choose **production mode**
   and the location **asia-south1 (Mumbai)**. (If you pick another location, change the region in
   `functions/index.js` and `VITE_FIREBASE_FUNCTIONS_REGION` to match.)
4. **Turn on Google sign-in.** *Build → Authentication → Get started → Sign-in method → Google → Enable*,
   and pick a support email.
5. **Allow the website's address.** *Authentication → Settings → Authorized domains → Add domain*:
   `worksanjai26-ui.github.io` (and `localhost` is there by default).
6. **Register the web app.** *Project settings (gear) → General → Your apps → Web (</>)*, give it a name,
   and copy the config values (`apiKey`, `authDomain`, `projectId`, `appId`, ...).
7. **Give the config to the site.**
   - Local: copy `.env.example` to `.env.local` and fill it in.
   - Live: on GitHub, *Settings → Secrets and variables → Actions → Variables → New repository variable*
     for each `VITE_FIREBASE_*` name in `.env.example`.

Then, on a computer with Node.js 22 installed:

```bash
npm install -g firebase-tools
firebase login
firebase use --add            # pick your project
cd functions && npm install && cd ..
firebase deploy --only firestore:rules,firestore:indexes,functions
```

## The Google Sheet

1. Create a Google Sheet (any name) while signed in as one of the admins. Copy its ID from the address:
   `https://docs.google.com/spreadsheets/d/<THIS PART>/edit`.
2. Find the functions' service account: *Google Cloud console → IAM & Admin → Service Accounts*; it is the
   one ending `-compute@developer.gserviceaccount.com`. **Share the Sheet with that email as Editor.**
   Share it with nobody else except the two organiser accounts.
3. Enable the **Google Sheets API** for the project (*APIs & Services → Library → Google Sheets API → Enable*).
4. Tell the functions the Sheet ID: create `functions/.env.optimus27` (replace `optimus27` with your project ID)
   containing one line `SHEET_ID=<the ID>`, then run `firebase deploy --only functions` again.

Tabs are created automatically: **Participants** (one row per person) and one tab per pass
(**Hackathon Teams**, **One-Day Pass**, **Two-Day Pass**, **Exclusive Pass**, one row per registration).
Firestore stays the source of truth; the Sheet is a read-only copy, so edit data in the admin panel, not in the Sheet.

## Admin panel

Open `https://worksanjai26-ui.github.io/Optimus27/#admin` and sign in with `srsanthosh7117@gmail.com` or
`work.sanjai26@gmail.com`. To change who is an admin, edit the list in **three** places and redeploy:
`firestore.rules`, `functions/index.js`, `src/backend.ts`.

The **EXCEL** button downloads one workbook with a Participants sheet and a sheet per pass.

## Switching on App Check (optional, recommended)

App Check makes the backend refuse requests that do not come from your site. In the Firebase console, open
*App Check*, register the web app with **reCAPTCHA v3**, put the site key in `VITE_RECAPTCHA_SITE_KEY`,
and once the site has been working with it, set `ENFORCE_APP_CHECK=true` in the functions' `.env` file and redeploy.

## Testing

```bash
npm run test:backend
```

Starts the Firestore emulator and runs the security-rule tests (strangers see nothing, people see only their
own data, the website cannot write, only the two admins read everything) and the function tests (IDs, team
checks, price, team-size limits, one team per person, admin delete). It needs Java and `firebase-tools`.

## Privacy

The site stores name, email, phone and college. Only the person themself and the organisers can see them.
Say so on the registration page and keep the Sheet shared only with the organisers.
