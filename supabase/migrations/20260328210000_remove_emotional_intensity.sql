-- Remove unused emotional_intensity column from scenario_traits.
-- This trait was never read by the escalation engine, prompt builder, or voice system.
-- Its purpose is covered by the combination of hostility, frustration, and volatility.
ALTER TABLE scenario_traits DROP COLUMN IF EXISTS emotional_intensity;
