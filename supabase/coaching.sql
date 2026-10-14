-- Run feedback, weekly check-ins and coach comments. Safe to run more than once.

alter table public.session_logs add column if not exists niggle_area text check (char_length(niggle_area) <= 60);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  sleep smallint not null check (sleep between 1 and 5),
  energy smallint not null check (energy between 1 and 5),
  mood smallint not null check (mood between 1 and 5),
  soreness smallint not null check (soreness between 0 and 10),
  soreness_area text check (char_length(soreness_area) <= 120),
  notes text check (char_length(notes) <= 1500),
  created_at timestamptz not null default now(),
  unique (athlete_id, week_start)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(id) on delete cascade,
  log_id uuid references public.session_logs(id) on delete cascade,
  checkin_id uuid references public.checkins(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  check ((log_id is null) <> (checkin_id is null))
);
create index if not exists comments_athlete on public.comments (athlete_id, created_at);

-- athlete_id and author_id are set by the database so they can't be faked
create or replace function public.set_comment_owner() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  new.author_id := auth.uid();
  if new.log_id is not null then
    select athlete_id into new.athlete_id from public.session_logs where id = new.log_id;
  else
    select athlete_id into new.athlete_id from public.checkins where id = new.checkin_id;
  end if;
  return new;
end $fn$;
drop trigger if exists set_comment_owner_trg on public.comments;
create trigger set_comment_owner_trg before insert on public.comments
  for each row execute function public.set_comment_owner();

alter table public.checkins enable row level security;
alter table public.comments enable row level security;

drop policy if exists checkins_select on public.checkins;
create policy checkins_select on public.checkins for select using (athlete_id = auth.uid() or public.coaches_athlete(athlete_id));
drop policy if exists checkins_insert on public.checkins;
create policy checkins_insert on public.checkins for insert with check (athlete_id = auth.uid());
drop policy if exists checkins_update on public.checkins;
create policy checkins_update on public.checkins for update using (athlete_id = auth.uid()) with check (athlete_id = auth.uid());
drop policy if exists checkins_delete on public.checkins;
create policy checkins_delete on public.checkins for delete using (athlete_id = auth.uid());

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select using (athlete_id = auth.uid() or public.coaches_athlete(athlete_id));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert with check (
  author_id = auth.uid() and (athlete_id = auth.uid() or public.coaches_athlete(athlete_id)));
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete using (author_id = auth.uid());
