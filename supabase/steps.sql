-- Adds structured workout steps (used for Garmin downloads)
alter table public.plan_sessions add column if not exists steps jsonb;
