import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePositiveInt(value: string | null, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedLimit = parsePositiveInt(url.searchParams.get("limit"), DEFAULT_LIMIT);
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);
  const offset = parsePositiveInt(url.searchParams.get("offset"), 0);

  const { data: sessions, error } = await supabase
    .from("simulation_sessions")
    .select("id, scenario_id, trainee_id, status, exit_type, final_escalation_level, peak_escalation_level, started_at, ended_at, created_at, scenario_templates(title)")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const visibleSessions = (sessions ?? []).slice(0, limit);
  const hasMore = (sessions?.length ?? 0) > limit;

  // Attach trainee display names and emails
  const traineeIds = [...new Set(visibleSessions.map((s) => s.trainee_id).filter(Boolean))];
  const nameMap: Record<string, { display_name: string | null; email: string | null }> = {};
  if (traineeIds.length > 0) {
    const { data: profiles } = await supabase
      .from("user_profiles")
      .select("id, display_name, email")
      .in("id", traineeIds);
    for (const p of profiles ?? []) {
      nameMap[p.id] = { display_name: p.display_name, email: p.email };
    }
  }

  const enriched = visibleSessions.map((s) => {
    const profile = nameMap[s.trainee_id];
    const displayName = profile?.display_name ?? null;
    const email = profile?.email ?? null;
    // Show "Display Name (email)" when both exist, otherwise whichever is available
    let trainee_name: string | null = null;
    if (displayName && email) {
      trainee_name = `${displayName} (${email})`;
    } else {
      trainee_name = email ?? displayName;
    }
    return { ...s, trainee_name };
  });

  return NextResponse.json({
    sessions: enriched,
    hasMore,
    nextOffset: hasMore ? offset + enriched.length : null,
  });
}
