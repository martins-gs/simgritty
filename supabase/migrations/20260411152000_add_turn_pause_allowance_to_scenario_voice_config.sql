do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'scenario_voice_config'
  ) then
    alter table public.scenario_voice_config
      add column if not exists turn_pause_allowance_ms integer not null default 0;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'scenario_voice_config_turn_pause_allowance_ms_check'
    ) then
      alter table public.scenario_voice_config
        add constraint scenario_voice_config_turn_pause_allowance_ms_check
        check (turn_pause_allowance_ms between 0 and 1500);
    end if;
  end if;
end $$;
