# Supabase backend: setup guide

This turns the demo into the real thing: Google sign-in, Optimus IDs issued by the server, event booking,
QR attendance (gate and per event), certificates that follow attendance, and an admin panel with Excel export.
It runs on Supabase's **free plan**: no billing card is needed.

## What runs where

| Piece | What it does | Where it lives |
|---|---|---|
| Website | The pages people see (GitHub Pages) | this repo, `src/` |
| Supabase Auth | "Sign in with Google" for participants, coordinators and admins | Supabase |
| Postgres + row-level security | profiles, registrations, bookings, attendance | Supabase, `supabase/schema.sql` |
| Postgres functions | issue IDs, check teammates, book events, sign QR codes, record scans | the same file |

The website can **read only the signed-in person's own rows**. It can never write profiles, registrations,
bookings or attendance directly: only the functions can, and they re-check everything on the server (name, team
size, event limits, "one place per person per event", who may scan). The URL and anon key in the website are
public identifiers, not passwords.

## How attendance works

1. **Register.** A participant signs in with Google, gets an Optimus ID, and registers for a pass.
   Hackathon: team of 2-4. One-Day pass: pick one presentation, one workshop and one non-technical event on your
   day. Two-Day pass: pick two of each. Exclusive: everything except the hackathon, booked automatically.
2. **Gate.** On arrival the gate desk scans the QR on **My Pass**. That records "at the fest" for that day.
3. **Events.** Each event's coordinator scans the QR. It only counts if the person booked that event and the
   scan is on that event's day. A scan before the gate check-in is accepted with a warning (see below).
   The hackathon is scanned once, at the start, for every member.
4. **My Pass** shows the gate check-in per day and every booked event as BOOKED or ATTENDED.
5. **Certificates** are issued only for events with a recorded scan. Booked events without one say
   "You didn't attend this event". Winners' certificates are handed out as hard copies by the organisers.

The QR holds only the Optimus ID, an expiry and a signature. It renews every minute and expires after two
minutes, so a screenshot sent to a friend stops working almost at once. If a phone has no signal or a QR will
not scan, the coordinator types the Optimus ID into the manual box (those scans are flagged MANUAL).
A mistaken scan can be undone; the row is kept as a record.

## One-time setup

1. **Create the project.** <https://supabase.com> > *New project*. Pick the region nearest you (for example
   Mumbai) and save the database password somewhere safe.
2. **Create the tables and rules.** *SQL Editor* > *New query*, paste the whole of `supabase/schema.sql`, *Run*.
   It is safe to run again later.
3. **Create a Google sign-in key.** In <https://console.cloud.google.com> create a project, then
   *APIs & Services > OAuth consent screen* (External, add your e-mail), then *Credentials > Create credentials >
   OAuth client ID > Web application*. Under *Authorized redirect URIs* add the callback URL shown in Supabase at
   *Authentication > Providers > Google* (it looks like `https://<project-ref>.supabase.co/auth/v1/callback`).
   Copy the **Client ID** and **Client secret** into that Supabase page and switch Google on.
4. **Allow the website's address.** *Authentication > URL Configuration*: set *Site URL* to
   `https://worksanjai26-ui.github.io/Optimus27/` and add these under *Redirect URLs*:
   `https://worksanjai26-ui.github.io/Optimus27/**` and `http://localhost:5178/**`.
5. **Give the keys to the site.** *Project Settings > API*: copy the **Project URL** and the **anon public** key.
   (Never use the `service_role` key in the website.)
   - Local: copy `.env.example` to `.env.local` and fill it in.
   - Live: on GitHub, *Settings > Secrets and variables > Actions > Variables > New repository variable* for
     `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then run the *Deploy to GitHub Pages* workflow.

## Staff: admins, coordinators, gate desk

Access is by verified Google e-mail, kept in the `staff` table. The two admins
(`srsanthosh7117@gmail.com`, `work.sanjai26@gmail.com`) are added by `schema.sql`. Add the others in
*SQL Editor* (e-mails in lower case):

```sql
-- gate desk: may mark fest entry
insert into public.staff (email, role) values ('gate.volunteer@gmail.com', 'gate');

-- an event coordinator: may scan only the listed events (and mark entry)
insert into public.staff (email, role, event_ids) values ('quiz.lead@gmail.com', 'coordinator', '{quiz-fun}');
insert into public.staff (email, role, event_ids) values ('workshops@gmail.com', 'coordinator', '{workshop-core,workshop-track-2,workshop-track-3}');

-- remove someone
delete from public.staff where email = 'quiz.lead@gmail.com';
```

Event ids: `hackathon`, `paper`, `project`, `poster`, `presentation-4`, `workshop-core`, `workshop-track-2`,
`workshop-track-3`, `photography`, `gaming`, `quiz-fun`.

## The scanner and the admin panel

- **Scanner:** `https://worksanjai26-ui.github.io/Optimus27/#scan`. Open it on a phone, sign in with the staff Google
  account, choose *Gate entry* or *Event* (and the event), pick the day, and press *Start scanning*.
- **Admin panel:** `https://worksanjai26-ui.github.io/Optimus27/#admin`. The **EXCEL** button downloads one workbook:
  Participants, a sheet per pass, **Gate Entry** and **Event Attendance**.

## Settings you may want to change

- **Make the gate scan compulsory for events.** By default an event scan without a gate check-in is accepted with
  a warning on the coordinator's screen. To refuse it instead:
  `update public.settings set value = 'true' where key = 'require_gate';` (set it back to `'false'` to allow again).
- **The timetable.** The day of each event is a first draft (`src/schedule.ts` and the `events` insert at the top of
  `supabase/schema.sql`). When the organisers confirm it, change both, run the SQL again and rebuild.

## Before the fest

- Supabase pauses a free project after about a week without use. Open the dashboard (or the site) in the days before
  Feb 4 and, if it says *Paused*, press *Restore*.
- Try the whole flow once with test Google accounts: register, gate scan, event scan, certificate
  (locally, `?certdemo` opens the certificate page before Feb 6).
- Payment is not part of this yet; registrations only record the amount due.

## Testing

```bash
npm run test:backend
```

Runs `supabase/schema.sql` in an in-process Postgres and checks the rules: strangers see nothing, people see only
their own rows, only staff can scan and coordinators only their own events, forged and expired QR codes are refused,
pass limits, one team per person, gate warnings, undo, and that My Pass reflects attendance.

## Privacy

The site stores name, e-mail, phone and college. Only the person themself and the admins can read them. The scanner
shows a participant's name, ID and college only, never their phone or e-mail.
