import { NextRequest, NextResponse } from "next/server";
import { buildEducatorAnalyticsResponse } from "@/lib/analytics/educatorAnalytics";
import type { EducatorAttemptView } from "@/lib/analytics/types";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";

function parseAttemptView(value: string | null): EducatorAttemptView {
  if (value === "first" || value === "repeat") {
    return value;
  }
  return "all";
}

function buildTraineeLabel(
  displayName: string | null | undefined,
  email: string | null | undefined,
  id: string
) {
  const trimmedName = displayName?.trim() || null;
  const trimmedEmail = email?.trim() || null;

  if (trimmedName && trimmedEmail) return `${trimmedName} (${trimmedEmail})`;
  if (trimmedEmail) return trimmedEmail;
  if (trimmedName) return trimmedName;
  return `User ${id.slice(0, 8)}`;
}

function coerceNumber(value: unknown) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export async function GET(request: NextRequest) {
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await authSupabase
    .from("user_profiles")
    .select("org_id, role, organizations(name)")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  if (!["admin", "educator"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createAdminClientIfAvailable() ?? authSupabase;
  const url = new URL(request.url);
  const filters = {
    trainee_id: url.searchParams.get("user") || null,
    scenario_id: url.searchParams.get("scenario") || null,
    date_from: url.searchParams.get("dateFrom") || null,
    date_to: url.searchParams.get("dateTo") || null,
    attempt_view: parseAttemptView(url.searchParams.get("attemptView")),
  };

  const { data: sessions, error: sessionsError } = await supabase
    .from("simulation_sessions")
    .select("id, scenario_id, trainee_id, org_id, status, created_at, started_at, ended_at, exit_type, final_escalation_level, peak_escalation_level, scenario_snapshot, review_artifacts")
    .eq("org_id", profile.org_id)
    .order("created_at", { ascending: false });

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const traineeIds = [...new Set(
    (sessions ?? [])
      .map((session) => session.trainee_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  )];
  const traineeLabelById = new Map<string, string>();

  for (const batch of chunk(traineeIds, 200)) {
    if (batch.length === 0) continue;

    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, display_name, email")
      .in("id", batch);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const profileRow of data ?? []) {
      traineeLabelById.set(
        profileRow.id,
        buildTraineeLabel(profileRow.display_name, profileRow.email, profileRow.id)
      );
    }
  }

  const sessionIds = (sessions ?? []).map((session) => session.id).filter(Boolean);
  const evidenceRows: Array<{
    id: string;
    session_id: string;
    dimension: string;
    turn_index: number;
    evidence_type: string;
    evidence_data: Record<string, unknown>;
    score_impact: number;
    created_at: string;
  }> = [];

  for (const batch of chunk(sessionIds, 200)) {
    if (batch.length === 0) continue;

    const { data, error } = await supabase
      .from("session_score_evidence")
      .select("id, session_id, dimension, turn_index, evidence_type, evidence_data, score_impact, created_at")
      .in("session_id", batch);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    for (const row of data ?? []) {
      evidenceRows.push({
        id: row.id,
        session_id: row.session_id,
        dimension: row.dimension,
        turn_index: typeof row.turn_index === "number" ? row.turn_index : Number(row.turn_index),
        evidence_type: row.evidence_type,
        evidence_data: (row.evidence_data ?? {}) as Record<string, unknown>,
        score_impact: coerceNumber(row.score_impact),
        created_at: row.created_at,
      });
    }
  }

  const organisationRecord = Array.isArray(profile.organizations)
    ? profile.organizations[0]
    : profile.organizations;
  const organisationName =
    typeof organisationRecord?.name === "string" ? organisationRecord.name : null;

  const response = buildEducatorAnalyticsResponse({
    sessions: (sessions ?? []).map((session) => ({
      id: session.id,
      scenario_id: session.scenario_id,
      trainee_id: session.trainee_id,
      trainee_label: traineeLabelById.get(session.trainee_id) ?? buildTraineeLabel(null, null, session.trainee_id),
      org_id: session.org_id,
      status: session.status,
      created_at: session.created_at,
      started_at: session.started_at,
      ended_at: session.ended_at,
      exit_type: session.exit_type,
      final_escalation_level: session.final_escalation_level,
      peak_escalation_level: session.peak_escalation_level,
      scenario_snapshot: session.scenario_snapshot,
      review_artifacts: session.review_artifacts,
    })),
    evidenceRows,
    filters,
    siteProgrammeLabel: organisationName,
  });

  return NextResponse.json(response, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
