import { NextResponse } from "next/server";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import { ensureSessionReviewArtifacts } from "@/lib/review/reviewArtifactsService";
import { ensureScenarioHistoryArtifact } from "@/lib/review/scenarioHistoryArtifactsService";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const persistSupabase = createAdminClientIfAvailable() ?? authSupabase;
    const { artifacts } = await ensureSessionReviewArtifacts({
      sessionId: id,
      userId: user.id,
      authSupabase,
      persistSupabase,
      surfaces: {
        summary: true,
        timeline: true,
      },
    });

    let scenarioHistoryReady = false;
    try {
      const { artifact } = await ensureScenarioHistoryArtifact({
        authSupabase,
        userId: user.id,
        persistSupabase,
        sessionId: id,
      });
      scenarioHistoryReady = Boolean(artifact?.summary);
    } catch (error) {
      console.error("[Scenario History] precompute failed", error);
    }

    return NextResponse.json(
      {
        summaryReady: Boolean(artifacts.summary),
        timelineReady: Boolean(artifacts.timeline),
        scenarioHistoryReady,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Review precompute failed";
    const status = message === "Session not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
