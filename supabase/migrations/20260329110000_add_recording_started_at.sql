alter table if exists public.simulation_sessions
  add column if not exists recording_started_at timestamptz;
