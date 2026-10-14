-- Enquiries from the public site form. Anyone may add one; only the coach can read or manage them.
create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 200),
  goal text check (char_length(goal) <= 300),
  background text check (char_length(background) <= 2000),
  handled boolean not null default false
);
alter table public.enquiries enable row level security;
drop policy if exists enquiries_insert on public.enquiries;
create policy enquiries_insert on public.enquiries for insert to anon, authenticated with check (handled = false);
drop policy if exists enquiries_coach on public.enquiries;
create policy enquiries_coach on public.enquiries for all using (public.is_coach()) with check (public.is_coach());

alter table public.enquiries add column if not exists plan text check (char_length(plan) <= 40);
