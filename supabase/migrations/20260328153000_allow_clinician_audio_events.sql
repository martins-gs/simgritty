do $$
declare
  event_type_type text;
  event_type_schema text;
  constraint_row record;
begin
  select ns.nspname, typ.typname
    into event_type_schema, event_type_type
  from pg_attribute attr
  join pg_class cls on cls.oid = attr.attrelid
  join pg_type typ on typ.oid = attr.atttypid
  join pg_namespace ns on ns.oid = typ.typnamespace
  where cls.oid = 'public.simulation_state_events'::regclass
    and attr.attname = 'event_type'
    and not attr.attisdropped;

  if event_type_type is null then
    raise exception 'public.simulation_state_events.event_type was not found';
  end if;

  if exists (
    select 1
    from pg_type typ
    join pg_namespace ns on ns.oid = typ.typnamespace
    where typ.typtype = 'e'
      and typ.typname = event_type_type
      and ns.nspname = event_type_schema
  ) then
    execute format(
      'alter type %I.%I add value if not exists %L',
      event_type_schema,
      event_type_type,
      'clinician_audio'
    );
  else
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.simulation_state_events'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%event_type%'
    loop
      execute format(
        'alter table public.simulation_state_events drop constraint if exists %I',
        constraint_row.conname
      );
    end loop;

    alter table public.simulation_state_events
      add constraint simulation_state_events_event_type_check
      check (
        event_type in (
          'session_started',
          'session_ended',
          'escalation_change',
          'de_escalation_change',
          'ceiling_reached',
          'trainee_exit',
          'classification_result',
          'clinician_audio',
          'prompt_update',
          'error'
        )
      );
  end if;
end
$$;
