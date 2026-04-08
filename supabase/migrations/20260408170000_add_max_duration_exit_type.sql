-- Expand the exit_type check constraint to include 'max_duration'
-- (auto-end triggered by org max_session_duration_minutes setting)

ALTER TABLE simulation_sessions
  DROP CONSTRAINT simulation_sessions_exit_type_check;

ALTER TABLE simulation_sessions
  ADD CONSTRAINT simulation_sessions_exit_type_check
  CHECK (exit_type = ANY (ARRAY[
    'normal'::text,
    'instant_exit'::text,
    'educator_ended'::text,
    'timeout'::text,
    'auto_ceiling'::text,
    'max_duration'::text
  ]));
