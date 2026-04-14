create table if not exists public.scenario_history_artifacts (
  id uuid primary key default gen_random_uuid(),
  trainee_id uuid not null,
  scenario_id uuid not null references public.scenario_templates(id) on delete cascade,
  artifact jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists scenario_history_artifacts_trainee_scenario_key
  on public.scenario_history_artifacts (trainee_id, scenario_id);

create index if not exists scenario_history_artifacts_scenario_idx
  on public.scenario_history_artifacts (scenario_id);

create index if not exists scenario_history_artifacts_trainee_idx
  on public.scenario_history_artifacts (trainee_id);
