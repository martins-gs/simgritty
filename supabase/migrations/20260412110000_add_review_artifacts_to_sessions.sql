alter table if exists public.simulation_sessions
  add column if not exists review_artifacts jsonb;
