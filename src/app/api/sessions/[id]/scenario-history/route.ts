import { NextResponse } from "next/server";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import { ensureScenarioHistoryArtifact } from "@/lib/review/scenarioHistoryArtifactsService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { artifact, source } = await ensureScenarioHistoryArtifact({
      authSupabase,
      userId: user.id,
      persistSupabase: createAdminClientIfAvailable() ?? authSupabase,
      sessionId: id,
      preferStored: true,
      trigger: "review_page",
    });

    if (!artifact) {
      return NextResponse.json({ error: "No sessions found for this scenario" }, { status: 404 });
    }

    return NextResponse.json({
      summary: artifact.summary,
      debug: artifact.debug,
    }, {
      headers: {
        "Cache-Control": "no-store",
        "X-Scenario-History-Source": source,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Session not found";
    const status = message === "Session not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
