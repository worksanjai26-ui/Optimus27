-- OPTIMUS '27 backend for Supabase.
-- Paste this whole file into the Supabase dashboard: SQL Editor > New query > Run. It is safe to run again.
--
-- Security model: the website (anon key) can only READ rows the signed-in person owns. Every write goes
-- through the functions below, which re-check everything on the server (name, team size, event limits,
-- "one place per person per event", who may scan). Nothing here depends on a password in the site.

create extension if not exists pgcrypto with schema extensions;

/* ------------------------------ staff ------------------------------ */
-- Who may scan QR codes or open the admin panel. Matched on the verified Google e-mail.
--   admin       everything
--   coordinator may scan the events listed in event_ids (and mark gate entry)
--   gate        may mark gate entry
create table if not exists public.staff (
  email     text primary key check (email = lower(email)),
  role      text not null check (role in ('admin', 'coordinator', 'gate')),
  event_ids text[] not null default '{}'
);
insert into public.staff (email, role) values
  ('srsanthosh7117@gmail.com', 'admin'),
  ('work.sanjai26@gmail.com', 'admin')
on conflict (email) do nothing;

/* ------------------------------ events ----------------------------- */
-- Keep in step with src/schedule.ts. day: 0 = Feb 4, 1 = Feb 5.
create table if not exists public.events (
  id    text primary key,
  title text not null,
  kind  text not null check (kind in ('hackathon', 'presentation', 'workshop', 'nontech')),
  day   int  not null check (day in (0, 1)),
  code  text unique          -- short code for the event, carried inside each participant's QR
);
alter table public.events add column if not exists code text unique;
insert into public.events (id, title, kind, day, code) values
  ('hackathon',        'Bumblebee Hackathon',   'hackathon',    0, 'HK'),
  ('paper',            'Paper Presentation',    'presentation', 0, 'PA'),
  ('project',          'Project Presentation',  'presentation', 0, 'PJ'),
  ('poster',           'Poster Presentation',   'presentation', 1, 'PO'),
  ('presentation-4',   'Pitch Presentation',    'presentation', 1, 'PI'),
  ('workshop-core',    'Technical Workshop',    'workshop',     0, 'W1'),
  ('workshop-track-3', 'Workshop - Track 3',    'workshop',     0, 'W3'),
  ('workshop-track-2', 'Workshop - Track 2',    'workshop',     1, 'W2'),
  ('photography',      'Photography / Reels',   'nontech',      0, 'PH'),
  ('quiz-fun',         'Quiz & Fun Events',     'nontech',      0, 'QZ'),
  ('gaming',           'Gaming Arena',          'nontech',      1, 'GM')
on conflict (id) do update set title = excluded.title, kind = excluded.kind, day = excluded.day, code = excluded.code;

/* ---------------------------- participants ------------------------- */
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  optimus_id text not null unique,
  name       text not null,
  email      text not null,
  phone      text not null,
  college    text not null,
  created_at timestamptz not null default now()
);
create sequence if not exists public.optimus_seq;

create table if not exists public.registrations (
  id         uuid primary key default gen_random_uuid(),
  pass       text not null check (pass in ('hackathon', 'oneday', 'twoday', 'exclusive')),
  day        int,
  team_name  text,
  leader_id  uuid not null references public.profiles (user_id),
  amount     int not null,
  created_at timestamptz not null default now()
);

-- One row per person per registration. unique (user_id, grp) is the "one team per person per event" rule:
-- a person is in at most one hackathon team and holds at most one fest pass.
create table if not exists public.registration_members (
  registration_id uuid not null references public.registrations (id) on delete cascade,
  user_id         uuid not null references public.profiles (user_id),
  grp             text not null check (grp in ('hackathon', 'fest')),
  primary key (registration_id, user_id),
  unique (user_id, grp)
);

-- The events a person is booked into (a team's members each get the hackathon).
create table if not exists public.bookings (
  registration_id uuid not null references public.registrations (id) on delete cascade,
  user_id         uuid not null references public.profiles (user_id),
  event_id        text not null references public.events (id),
  primary key (user_id, event_id)
);

/* ----------------------------- attendance -------------------------- */
create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (user_id),
  kind       text not null check (kind in ('entry', 'event')),
  event_id   text references public.events (id),
  day        int  not null check (day in (0, 1)),
  scanned_by text not null,
  manual     boolean not null default false,
  scanned_at timestamptz not null default now(),
  voided_at  timestamptz,
  voided_by  text,
  check ((kind = 'entry' and event_id is null) or (kind = 'event' and event_id is not null))
);
-- A scan counts once; an undone (voided) scan no longer blocks a new one.
create unique index if not exists attendance_once
  on public.attendance (user_id, kind, coalesce(event_id, ''), day) where voided_at is null;

/* ------------------------- content and settings -------------------- */
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  message    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.event_overrides (
  id   text primary key,
  data jsonb not null
);
-- Never readable from the website (RLS on, no policy).
create table if not exists public.settings (key text primary key, value text not null);
insert into public.settings values ('require_gate', 'false') on conflict (key) do nothing;
create table if not exists public.app_secrets (name text primary key, value text not null);
insert into public.app_secrets values ('qr_key', encode(extensions.gen_random_bytes(32), 'hex')) on conflict (name) do nothing;

/* --------------------------- helper functions ---------------------- */
create or replace function public.jwt_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where email = public.jwt_email() and role = 'admin')
$$;

create or replace function public.norm_name(p text) returns text
language sql immutable as $$ select regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g') $$;

/* ------------------------- row level security ---------------------- */
alter table public.staff                enable row level security;
alter table public.events               enable row level security;
alter table public.profiles             enable row level security;
alter table public.registrations        enable row level security;
alter table public.registration_members enable row level security;
alter table public.bookings             enable row level security;
alter table public.attendance           enable row level security;
alter table public.announcements        enable row level security;
alter table public.event_overrides      enable row level security;
alter table public.settings             enable row level security;
alter table public.app_secrets          enable row level security;

drop policy if exists staff_read          on public.staff;
drop policy if exists staff_admin         on public.staff;
drop policy if exists events_read         on public.events;
drop policy if exists profiles_read       on public.profiles;
drop policy if exists registrations_read  on public.registrations;
drop policy if exists members_read        on public.registration_members;
drop policy if exists bookings_read       on public.bookings;
drop policy if exists attendance_read     on public.attendance;
drop policy if exists announcements_read  on public.announcements;
drop policy if exists announcements_admin on public.announcements;
drop policy if exists overrides_read      on public.event_overrides;
drop policy if exists overrides_admin     on public.event_overrides;

create policy staff_read  on public.staff for select to authenticated using (email = public.jwt_email() or public.is_admin());
create policy staff_admin on public.staff for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy events_read on public.events for select to anon, authenticated using (true);

create policy profiles_read      on public.profiles             for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy members_read       on public.registration_members for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy registrations_read on public.registrations        for select to authenticated using (
  public.is_admin() or exists (select 1 from public.registration_members m where m.registration_id = registrations.id and m.user_id = auth.uid())
);
create policy bookings_read      on public.bookings             for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy attendance_read    on public.attendance           for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy announcements_read  on public.announcements   for select to anon, authenticated using (true);
create policy announcements_admin on public.announcements   for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy overrides_read      on public.event_overrides for select to anon, authenticated using (true);
create policy overrides_admin     on public.event_overrides for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- The website can never write these directly; only the functions below (which run as the owner) can.
revoke insert, update, delete, truncate on
  public.events, public.profiles, public.registrations, public.registration_members, public.bookings, public.attendance
  from anon, authenticated;
revoke all on public.settings, public.app_secrets from anon, authenticated;
revoke all on public.staff from anon;

/* ---------------------------- Optimus IDs --------------------------- */
create or replace function public.issue_optimus_id(p_name text, p_phone text, p_college text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_p public.profiles;
  v_name text := public.norm_name(p_name);
  v_phone text := btrim(coalesce(p_phone, ''));
  v_college text := public.norm_name(p_college);
begin
  if v_uid is null then raise exception 'Please sign in with Google first.'; end if;
  select * into v_p from public.profiles where user_id = v_uid;
  if not found then
    if v_name !~ '^[A-Z][A-Z .''-]*$' or length(v_name) > 80 then
      raise exception 'Name must be in CAPITAL LETTERS only (for example: JOSEPH VIJAY).';
    end if;
    if length(v_phone) < 7 or length(v_phone) > 20 then raise exception 'Please enter a valid phone number.'; end if;
    if length(v_college) < 2 or length(v_college) > 120 then raise exception 'Please enter your college name.'; end if;
    insert into public.profiles (user_id, optimus_id, name, email, phone, college)
    values (v_uid, 'OPT27-' || lpad(nextval('public.optimus_seq')::text, 5, '0'), v_name, public.jwt_email(), v_phone, v_college)
    returning * into v_p;
  end if;
  return jsonb_build_object('optimus_id', v_p.optimus_id, 'name', v_p.name, 'email', v_p.email,
                            'phone', v_p.phone, 'college', v_p.college, 'created_at', v_p.created_at);
end $$;

/* ------------------------- team and registration -------------------- */
-- Teammate check for the form. A wrong name and an unknown ID give the same answer, so nobody can probe IDs.
create or replace function public.check_members(p_pass text, p_members jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_me text;
  v_out jsonb := '[]'::jsonb;
  v_seen text[];
  m jsonb; v_id text; v_nm text; v_p public.profiles; v_res text;
begin
  if v_uid is null then raise exception 'Please sign in with Google first.'; end if;
  select optimus_id into v_me from public.profiles where user_id = v_uid;
  if v_me is null then raise exception 'Get your Optimus ID first.'; end if;
  if p_pass <> 'hackathon' then return '[]'::jsonb; end if;
  if jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) > 3 then raise exception 'A hackathon team has 2 to 4 members.'; end if;
  v_seen := array[v_me];
  for m in select * from jsonb_array_elements(p_members) loop
    v_id := upper(btrim(coalesce(m ->> 'id', '')));
    v_nm := public.norm_name(m ->> 'name');
    if v_id !~ '^OPT27-[0-9]{5}$' then
      v_res := 'bad-format';
    elsif v_id = any (v_seen) then
      v_res := 'duplicate';
    else
      v_seen := v_seen || v_id;
      select * into v_p from public.profiles where optimus_id = v_id and name = v_nm;
      if not found then v_res := 'name-mismatch';
      elsif exists (select 1 from public.registration_members where user_id = v_p.user_id and grp = 'hackathon') then v_res := 'busy';
      else v_res := 'ok';
      end if;
    end if;
    v_out := v_out || to_jsonb(v_res);
  end loop;
  return v_out;
end $$;

-- Creates a registration (and the bookings under it) for the signed-in person and any teammates.
create or replace function public.submit_registration(p_pass text, p_day int, p_team_name text, p_members jsonb, p_events text[])
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles;
  v_price int; v_grp text; v_team text; v_day int;
  v_ids uuid[]; v_seen text[]; v_events text[]; v_limit int; v_bad text; v_n int;
  v_reg uuid; v_amount int;
  m jsonb; v_id text; v_nm text; v_p public.profiles;
begin
  if v_uid is null then raise exception 'Please sign in with Google first.'; end if;
  select * into v_me from public.profiles where user_id = v_uid;
  if not found then raise exception 'Get your Optimus ID first.'; end if;

  v_price := case p_pass when 'hackathon' then 500 when 'oneday' then 300 when 'twoday' then 400 when 'exclusive' then 500 end;
  if v_price is null then raise exception 'Unknown pass.'; end if;
  v_grp := case when p_pass = 'hackathon' then 'hackathon' else 'fest' end;
  if exists (select 1 from public.registration_members where user_id = v_uid and grp = v_grp) then
    raise exception '%', case when v_grp = 'hackathon' then 'You are already in a team for the hackathon.' else 'You already hold a fest pass.' end;
  end if;

  v_ids := array[v_uid];
  v_seen := array[v_me.optimus_id];

  if p_pass = 'hackathon' then
    v_team := btrim(coalesce(p_team_name, ''));
    if length(v_team) < 2 or length(v_team) > 40 then raise exception 'Enter a team name (2 to 40 characters).'; end if;
    if p_members is null or jsonb_typeof(p_members) <> 'array' or jsonb_array_length(p_members) not between 1 and 3 then
      raise exception 'A hackathon team has 2 to 4 members.';
    end if;
    v_n := 1;
    for m in select * from jsonb_array_elements(p_members) loop
      v_n := v_n + 1;
      v_id := upper(btrim(coalesce(m ->> 'id', '')));
      v_nm := public.norm_name(m ->> 'name');
      if v_id !~ '^OPT27-[0-9]{5}$' then raise exception 'Member %: enter a valid Optimus ID.', v_n; end if;
      if v_id = any (v_seen) then raise exception 'Member %: this Optimus ID is already in the team.', v_n; end if;
      select * into v_p from public.profiles where optimus_id = v_id and name = v_nm;
      if not found then raise exception 'Member %: the ID and name do not match a registered participant.', v_n; end if;
      if exists (select 1 from public.registration_members where user_id = v_p.user_id and grp = 'hackathon') then
        raise exception 'Member %: already in a team for the hackathon.', v_n;
      end if;
      v_seen := v_seen || v_id;
      v_ids := v_ids || v_p.user_id;
    end loop;
    v_events := array['hackathon'];
    v_day := null;
  else
    if p_members is not null and jsonb_typeof(p_members) = 'array' and jsonb_array_length(p_members) > 0 then
      raise exception 'Only the hackathon is a team pass.';
    end if;
    v_team := null;
    v_day := case when p_pass = 'oneday' then p_day end;
    if p_pass = 'exclusive' then
      select array_agg(id order by id) into v_events from public.events where kind <> 'hackathon';
    else
      select coalesce(array_agg(distinct e), '{}') into v_events from unnest(coalesce(p_events, '{}')) e;
      if cardinality(v_events) = 0 then raise exception 'Pick the events you will attend.'; end if;
      if exists (select 1 from unnest(v_events) e where not exists (select 1 from public.events x where x.id = e and x.kind <> 'hackathon')) then
        raise exception 'One of the chosen events is not available on this pass.';
      end if;
      if p_pass = 'oneday' then
        if p_day is null or p_day not in (0, 1) then raise exception 'Choose your day.'; end if;
        if exists (select 1 from public.events where id = any (v_events) and day <> p_day) then
          raise exception 'Pick only events that happen on your chosen day.';
        end if;
        v_limit := 1;
      else
        v_limit := 2;
      end if;
      select kind into v_bad from public.events where id = any (v_events) group by kind having count(*) > v_limit limit 1;
      if found then
        raise exception 'This pass allows at most % % event(s).', v_limit, case v_bad when 'nontech' then 'non-technical' else v_bad end;
      end if;
    end if;
  end if;

  v_amount := v_price * cardinality(v_ids);
  begin
    insert into public.registrations (pass, day, team_name, leader_id, amount)
    values (p_pass, v_day, v_team, v_uid, v_amount) returning id into v_reg;
    insert into public.registration_members (registration_id, user_id, grp) select v_reg, u, v_grp from unnest(v_ids) u;
    insert into public.bookings (registration_id, user_id, event_id) select v_reg, u, e from unnest(v_ids) u cross join unnest(v_events) e;
  exception when unique_violation then
    raise exception 'Someone in this registration is already booked for one of these events.';
  end;
  return jsonb_build_object('id', v_reg, 'amount', v_amount);
end $$;

create or replace function public.admin_delete_registration(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not allowed.'; end if;
  delete from public.registrations where id = p_id;   -- members and bookings go with it, freeing their places
  return jsonb_build_object('ok', true);
end $$;

/* --------------------------------- QR ------------------------------- */
-- The QR holds the Optimus ID, the codes of the events the person booked, an expiry and a signature.
-- The signature covers all of it, so the events cannot be edited. It changes every minute and expires
-- after two minutes, so a screenshot is useless a few minutes later. No phone number or e-mail is inside.
create or replace function public.qr_token() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_id text; v_key text; v_codes text; v_exp bigint := extract(epoch from now())::bigint + 120;
begin
  select optimus_id into v_id from public.profiles where user_id = auth.uid();
  if v_id is null then raise exception 'Get your Optimus ID first.'; end if;
  select coalesce(string_agg(e.code, ',' order by e.day, e.id), '') into v_codes
    from public.bookings b join public.events e on e.id = b.event_id where b.user_id = auth.uid();
  select value into v_key from public.app_secrets where name = 'qr_key';
  return 'OPTIMUS27|' || v_id || '|' || v_exp || '|' || v_codes || '|' ||
         substr(encode(extensions.hmac(v_id || '|' || v_exp || '|' || v_codes, v_key, 'sha256'), 'hex'), 1, 20);
end $$;

-- Internal: turns a scanned QR (or a typed ID, the manual fallback) into a profile.
create or replace function public._resolve(p_code text, out o_profile public.profiles, out o_manual boolean)
language plpgsql security definer set search_path = public, extensions as $$
declare v_parts text[]; v_key text; v_exp bigint; v_id text;
begin
  p_code := btrim(coalesce(p_code, ''));
  if p_code like 'OPTIMUS27|%' then
    v_parts := string_to_array(p_code, '|');
    if array_length(v_parts, 1) <> 5 then raise exception 'Unreadable QR code.'; end if;
    select value into v_key from public.app_secrets where name = 'qr_key';
    if substr(encode(extensions.hmac(v_parts[2] || '|' || v_parts[3] || '|' || v_parts[4], v_key, 'sha256'), 'hex'), 1, 20) <> v_parts[5] then
      raise exception 'This QR code is not valid.';
    end if;
    begin v_exp := v_parts[3]::bigint; exception when others then raise exception 'Unreadable QR code.'; end;
    if v_exp < extract(epoch from now())::bigint then
      raise exception 'This QR has expired. Ask the participant to reopen My Pass.';
    end if;
    v_id := v_parts[2];
    o_manual := false;
  elsif upper(p_code) ~ '^OPT27-[0-9]{5}$' then
    v_id := upper(p_code);
    o_manual := true;
  else
    raise exception 'Unreadable QR code.';
  end if;
  select * into o_profile from public.profiles where optimus_id = v_id;
  if not found then raise exception 'No participant with this Optimus ID.'; end if;
end $$;

/* ------------------------------ scanning ---------------------------- */
drop function if exists public.scan(text, text, text, int);
-- p_manual: leave null to detect it (a typed Optimus ID counts as manual). The scanner passes false when the
-- ID came from a real QR scan that the coordinator then confirmed with YES.
create or replace function public.scan(p_code text, p_mode text, p_event_id text default null, p_day int default 0, p_manual boolean default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_staff public.staff;
  v_prof public.profiles; v_manual boolean; v_res record;
  v_ev public.events;
  v_base jsonb; v_id uuid; v_at timestamptz;
  v_has_entry boolean; v_require boolean;
begin
  if auth.uid() is null then raise exception 'Please sign in with Google first.'; end if;
  select * into v_staff from public.staff where email = public.jwt_email();
  if not found then raise exception 'You are not on the staff list. Ask an admin to add your Google account.'; end if;
  if p_mode not in ('entry', 'event') then raise exception 'Unknown scan type.'; end if;
  if p_day is null or p_day not in (0, 1) then raise exception 'Choose the day.'; end if;

  if p_mode = 'event' then
    select * into v_ev from public.events where id = p_event_id;
    if not found then raise exception 'Unknown event.'; end if;
    if v_staff.role <> 'admin' and not (v_staff.role = 'coordinator' and p_event_id = any (v_staff.event_ids)) then
      raise exception 'You are not assigned to this event.';
    end if;
  end if;

  select * into v_res from public._resolve(p_code);
  v_prof := v_res.o_profile;
  v_manual := coalesce(p_manual, v_res.o_manual);
  v_base := jsonb_build_object('optimus_id', v_prof.optimus_id, 'name', v_prof.name, 'college', v_prof.college,
                               'manual', v_manual, 'day', p_day);

  if p_mode = 'entry' then
    select scanned_at into v_at from public.attendance
      where user_id = v_prof.user_id and kind = 'entry' and day = p_day and voided_at is null;
    if found then return v_base || jsonb_build_object('status', 'already', 'at', v_at); end if;
    begin
      insert into public.attendance (user_id, kind, day, scanned_by, manual)
      values (v_prof.user_id, 'entry', p_day, v_staff.email, v_manual) returning id, scanned_at into v_id, v_at;
    exception when unique_violation then
      return v_base || jsonb_build_object('status', 'already');
    end;
    return v_base || jsonb_build_object('status', 'marked', 'at', v_at, 'attendance_id', v_id);
  end if;

  v_base := v_base || jsonb_build_object('event_id', v_ev.id, 'event_title', v_ev.title);
  if not exists (select 1 from public.bookings where user_id = v_prof.user_id and event_id = v_ev.id) then
    return v_base || jsonb_build_object('status', 'not-registered', 'registered',
      (select coalesce(jsonb_agg(e.title order by e.day, e.id), '[]'::jsonb)
         from public.bookings b join public.events e on e.id = b.event_id where b.user_id = v_prof.user_id));
  end if;
  if v_ev.day <> p_day then
    return v_base || jsonb_build_object('status', 'wrong-day', 'event_day', v_ev.day);
  end if;

  select exists (select 1 from public.attendance where user_id = v_prof.user_id and kind = 'entry' and day = p_day and voided_at is null)
    into v_has_entry;
  select value = 'true' into v_require from public.settings where key = 'require_gate';
  if not v_has_entry and coalesce(v_require, false) then
    return v_base || jsonb_build_object('status', 'no-gate-entry');
  end if;

  select scanned_at into v_at from public.attendance
    where user_id = v_prof.user_id and kind = 'event' and event_id = v_ev.id and day = p_day and voided_at is null;
  if found then return v_base || jsonb_build_object('status', 'already', 'at', v_at); end if;
  begin
    insert into public.attendance (user_id, kind, event_id, day, scanned_by, manual)
    values (v_prof.user_id, 'event', v_ev.id, p_day, v_staff.email, v_manual) returning id, scanned_at into v_id, v_at;
  exception when unique_violation then
    return v_base || jsonb_build_object('status', 'already');
  end;
  return v_base || jsonb_build_object('status', 'marked', 'at', v_at, 'attendance_id', v_id,
    'warnings', case when v_has_entry then '[]'::jsonb else '["no-gate-entry"]'::jsonb end);
end $$;

-- Undo a mistaken scan. The row is kept (voided), so there is a record of it.
create or replace function public.undo_scan(p_attendance_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff public.staff; v_a public.attendance;
begin
  select * into v_staff from public.staff where email = public.jwt_email();
  if not found then raise exception 'You are not on the staff list.'; end if;
  select * into v_a from public.attendance where id = p_attendance_id and voided_at is null;
  if not found then raise exception 'That scan was already undone.'; end if;
  if v_staff.role <> 'admin' and v_a.scanned_by <> v_staff.email
     and not (v_staff.role = 'coordinator' and v_a.event_id = any (v_staff.event_ids)) then
    raise exception 'You cannot undo this scan.';
  end if;
  update public.attendance set voided_at = now(), voided_by = v_staff.email where id = p_attendance_id;
  return jsonb_build_object('ok', true);
end $$;

-- Step one of a scan: who is this, and what are they booked for? Nothing is recorded; the coordinator
-- looks at the answer and then presses YES (scan, above) or NO (unmark_attendance, below).
create or replace function public.lookup_participant(p_code text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_staff public.staff; v_res record; v_prof public.profiles;
begin
  if auth.uid() is null then raise exception 'Please sign in with Google first.'; end if;
  select * into v_staff from public.staff where email = public.jwt_email();
  if not found then raise exception 'You are not on the staff list. Ask an admin to add your Google account.'; end if;
  select * into v_res from public._resolve(p_code);
  v_prof := v_res.o_profile;
  return jsonb_build_object(
    'optimus_id', v_prof.optimus_id, 'name', v_prof.name, 'college', v_prof.college, 'manual', v_res.o_manual,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'title', e.title, 'day', e.day, 'attended', exists (
          select 1 from public.attendance a
          where a.user_id = b.user_id and a.kind = 'event' and a.event_id = b.event_id and a.voided_at is null)) order by e.day, e.id)
      from public.bookings b join public.events e on e.id = b.event_id where b.user_id = v_prof.user_id), '[]'::jsonb),
    'entry_days', coalesce((
      select jsonb_agg(day order by day) from public.attendance
      where user_id = v_prof.user_id and kind = 'entry' and voided_at is null), '[]'::jsonb)
  );
end $$;

-- The NO button: takes back a recorded scan (or does nothing if there was none). The row is kept, voided.
create or replace function public.unmark_attendance(p_optimus_id text, p_mode text, p_event_id text default null, p_day int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff public.staff; v_uid uuid; v_n int;
begin
  select * into v_staff from public.staff where email = public.jwt_email();
  if not found then raise exception 'You are not on the staff list.'; end if;
  if p_mode not in ('entry', 'event') then raise exception 'Unknown scan type.'; end if;
  if p_mode = 'event' and v_staff.role <> 'admin' and not (v_staff.role = 'coordinator' and p_event_id = any (v_staff.event_ids)) then
    raise exception 'You are not assigned to this event.';
  end if;
  select user_id into v_uid from public.profiles where optimus_id = upper(btrim(coalesce(p_optimus_id, '')));
  if v_uid is null then raise exception 'No participant with this Optimus ID.'; end if;
  update public.attendance set voided_at = now(), voided_by = v_staff.email
    where user_id = v_uid and kind = p_mode and day = p_day and voided_at is null
      and ((p_mode = 'entry' and event_id is null) or (p_mode = 'event' and event_id = p_event_id));
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', case when v_n > 0 then 'unmarked' else 'none' end);
end $$;

/* ------------------------------ My Pass ----------------------------- */
create or replace function public.my_pass() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Please sign in with Google first.'; end if;
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', b.event_id, 'day', e.day, 'attended', exists (
          select 1 from public.attendance a
          where a.user_id = b.user_id and a.kind = 'event' and a.event_id = b.event_id and a.voided_at is null)) order by e.day, e.id)
      from public.bookings b join public.events e on e.id = b.event_id where b.user_id = v_uid), '[]'::jsonb),
    'entry_days', coalesce((
      select jsonb_agg(day order by day) from public.attendance where user_id = v_uid and kind = 'entry' and voided_at is null), '[]'::jsonb),
    'passes', coalesce((
      select jsonb_agg(jsonb_build_object('pass', r.pass, 'day', r.day, 'team_name', r.team_name))
      from public.registration_members m join public.registrations r on r.id = m.registration_id where m.user_id = v_uid), '[]'::jsonb)
  );
end $$;

/* ------------------------------ permissions ------------------------- */
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.issue_optimus_id(text, text, text),
  public.check_members(text, jsonb),
  public.submit_registration(text, int, text, jsonb, text[]),
  public.admin_delete_registration(uuid),
  public.qr_token(),
  public.scan(text, text, text, int, boolean),
  public.lookup_participant(text),
  public.unmark_attendance(text, text, text, int),
  public.undo_scan(uuid),
  public.my_pass(),
  public.jwt_email(),
  public.is_admin(),
  public.norm_name(text)
to authenticated;
