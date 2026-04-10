alter table if exists public.transcript_turns
  add column if not exists trainee_delivery_analysis jsonb;
