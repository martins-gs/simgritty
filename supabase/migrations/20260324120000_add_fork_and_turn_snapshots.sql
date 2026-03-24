alter table if exists public.simulation_sessions
  add column if not exists parent_session_id uuid references public.simulation_sessions (id) on delete set null,
  add column if not exists forked_from_session_id uuid references public.simulation_sessions (id) on delete set null,
  add column if not exists forked_from_turn_index integer,
  add column if not exists fork_label text,
  add column if not exists branch_depth integer;

create index if not exists simulation_sessions_parent_session_id_idx
  on public.simulation_sessions (parent_session_id);

create index if not exists simulation_sessions_forked_from_session_id_idx
  on public.simulation_sessions (forked_from_session_id);

alter table if exists public.transcript_turns
  add column if not exists classifier_result jsonb,
  add column if not exists trigger_type text check (trigger_type in ('escalation', 'de_escalation', 'neutral')),
  add column if not exists state_after jsonb,
  add column if not exists patient_voice_profile_after jsonb,
  add column if not exists patient_prompt_after text;
