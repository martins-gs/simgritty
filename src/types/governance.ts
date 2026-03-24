export interface OrgSettings {
  id: string;
  org_id: string;
  allow_discriminatory_content: boolean;
  max_escalation_ceiling: number;
  max_session_duration_minutes: number;
  require_consent_gate: boolean;
  updated_by: string | null;
  updated_at: string;
}

export interface AuditEntry {
  id: string;
  org_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export type UserRole = "admin" | "educator" | "trainee";

export interface UserProfile {
  id: string;
  org_id: string;
  display_name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
  organizations?: Organization;
}
