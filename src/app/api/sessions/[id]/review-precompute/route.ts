import { NextResponse } from "next/server";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import { ensureSessionReviewArtifacts } from "@/lib/review/reviewArtifactsService";

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
    const { artifacts } = await ensureSessionReviewArtifacts({
      sessionId: id,
      userId: user.id,
      authSupabase,
      persistSupabase: createAdminClientIfAvailable() ?? authSupabase,
      surfaces: {
        summary: true,
        timeline: true,
      },
    });

    return NextResponse.json(
      {
        summaryReady: Boolean(artifacts.summary),
        timelineReady: Boolean(artifacts.timeline),
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
