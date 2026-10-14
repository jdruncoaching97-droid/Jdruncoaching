-- JD Run Coaching: run once in Supabase (SQL editor). Safe to re-run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'athlete' check (role in ('athlete','coach')),
  coach_id uuid references public.profiles(id),
  vdot numeric(4,1),
  created_at timestamptz not null default now()
);

create table if not exists public.plan_sessions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  session_date date not null,
  title text not null,
  session_type text not null default 'easy',
  target_km numeric(5,1),
  description text,
  created_at timestamptz not null default now()
);
create index if not exists plan_sessions_athlete_date on public.plan_sessions (athlete_id, session_date);

create table if not exists public.session_logs (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  plan_session_id uuid references public.plan_sessions(id) on delete set null,
  log_date date not null,
  distance_km numeric(5,2) not null check (distance_km >= 0 and distance_km < 300),
  duration_sec integer not null check (duration_sec > 0 and duration_sec < 172800),
  rpe smallint check (rpe between 1 and 10),
  niggle smallint check (niggle between 0 and 10),
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists session_logs_athlete_date on public.session_logs (athlete_id, log_date desc);

-- Helper functions (security definer so policies don't recurse into profiles)
create or replace function public.is_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'coach');
$$;

create or replace function public.coaches_athlete(a uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_coach() and exists (
    select 1 from public.profiles p where p.id = a and p.role = 'athlete' and p.coach_id = auth.uid());
$$;

-- New sign-ups become athletes
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the coach may change role, coach, VDOT or email. Athletes can edit their name.
-- (auth.uid() is null when you run SQL as admin in the dashboard, which is allowed.)
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_coach() then
    if new.role is distinct from old.role or new.coach_id is distinct from old.coach_id
       or new.vdot is distinct from old.vdot or new.email is distinct from old.email then
      raise exception 'Only the coach can change that field';
    end if;
  end if;
  if auth.uid() is not null and public.is_coach() and new.role is distinct from old.role then
    raise exception 'Role changes must be made in the Supabase dashboard';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile_trg on public.profiles;
create trigger protect_profile_trg before update on public.profiles
  for each row execute function public.protect_profile();

alter table public.profiles enable row level security;
alter table public.plan_sessions enable row level security;
alter table public.session_logs enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or (public.is_coach() and role = 'athlete' and (coach_id = auth.uid() or coach_id is null)));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (
  id = auth.uid() or (public.is_coach() and role = 'athlete' and (coach_id = auth.uid() or coach_id is null)))
  with check (
  id = auth.uid() or (public.is_coach() and role = 'athlete' and coach_id = auth.uid()));

-- plan_sessions: athlete reads own; coach manages their athletes'
drop policy if exists plan_select on public.plan_sessions;
create policy plan_select on public.plan_sessions for select using (athlete_id = auth.uid() or public.coaches_athlete(athlete_id));
drop policy if exists plan_write on public.plan_sessions;
create policy plan_write on public.plan_sessions for all using (public.coaches_athlete(athlete_id)) with check (public.coaches_athlete(athlete_id));

-- session_logs: athlete manages own; coach reads their athletes'
drop policy if exists logs_select on public.session_logs;
create policy logs_select on public.session_logs for select using (athlete_id = auth.uid() or public.coaches_athlete(athlete_id));
drop policy if exists logs_insert on public.session_logs;
create policy logs_insert on public.session_logs for insert with check (athlete_id = auth.uid());
drop policy if exists logs_update on public.session_logs;
create policy logs_update on public.session_logs for update using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());
drop policy if exists logs_delete on public.session_logs;
create policy logs_delete on public.session_logs for delete using (athlete_id = auth.uid());
