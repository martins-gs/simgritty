create table if not exists public.session_reflections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.simulation_sessions(id) on delete cascade,
  user_id uuid not null,
  tags text[] not null default '{}',
  free_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.session_reflections
  add column if not exists updated_at timestamptz not null default now();

update public.session_reflections
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table public.session_reflections
  drop constraint if exists uq_session_reflections_session;

create unique index if not exists session_reflections_session_user_key
  on public.session_reflections (session_id, user_id);

create index if not exists session_reflections_user_idx
  on public.session_reflections (user_id);
