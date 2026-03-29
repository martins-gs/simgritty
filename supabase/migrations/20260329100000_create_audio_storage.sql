-- Create private storage bucket for simulation audio recordings
insert into storage.buckets (id, name, public)
values ('simulation-audio', 'simulation-audio', false)
on conflict (id) do nothing;

-- Authenticated users can upload audio files
create policy "Authenticated users can upload simulation audio"
on storage.objects for insert
to authenticated
with check (bucket_id = 'simulation-audio');

-- Authenticated users can read audio files
create policy "Authenticated users can read simulation audio"
on storage.objects for select
to authenticated
using (bucket_id = 'simulation-audio');

-- Add recording path column to simulation_sessions
alter table if exists public.simulation_sessions
  add column if not exists recording_path text;
