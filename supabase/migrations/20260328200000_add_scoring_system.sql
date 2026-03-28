-- Add scoring configuration columns to scenario_templates
ALTER TABLE scenario_templates
  ADD COLUMN scoring_weights jsonb,
  ADD COLUMN support_threshold integer,
  ADD COLUMN critical_threshold integer,
  ADD COLUMN clinical_task_enabled boolean NOT NULL DEFAULT false;

-- Constraint: critical_threshold >= support_threshold when both set
ALTER TABLE scenario_templates
  ADD CONSTRAINT chk_critical_gte_support
  CHECK (critical_threshold IS NULL OR support_threshold IS NULL OR critical_threshold >= support_threshold);

-- Clinical milestones per scenario (optional, 3-5 recommended)
CREATE TABLE scenario_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_template_id uuid NOT NULL REFERENCES scenario_templates(id) ON DELETE CASCADE,
  "order" integer NOT NULL,
  description text NOT NULL,
  classifier_hint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_milestones_template ON scenario_milestones(scenario_template_id);

-- Persisted scores per completed session
CREATE TABLE session_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  composure_score numeric NOT NULL,
  de_escalation_score numeric NOT NULL,
  clinical_task_score numeric,
  support_seeking_score numeric NOT NULL,
  overall_score numeric NOT NULL,
  qualitative_label text NOT NULL,
  weights_used jsonb NOT NULL,
  session_valid boolean NOT NULL,
  turn_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_session_scores_session UNIQUE (session_id)
);

-- Per-event evidence linking scores to transcript turns
CREATE TABLE session_score_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  dimension text NOT NULL,
  turn_index integer NOT NULL,
  evidence_type text NOT NULL,
  evidence_data jsonb NOT NULL DEFAULT '{}',
  score_impact numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_score_evidence_session ON session_score_evidence(session_id);

-- Trainee self-reflection (separate from performance record)
CREATE TABLE session_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES simulation_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  free_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_session_reflections_session UNIQUE (session_id)
);
