import { NextResponse } from "next/server";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import { ensureSessionReviewArtifacts } from "@/lib/review/reviewArtifactsService";

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
    const { artifacts } = await ensureSessionReviewArtifacts({
      sessionId: id,
      userId: user.id,
      authSupabase,
      persistSupabase: createAdminClientIfAvailable() ?? authSupabase,
      surfaces: {
        timeline: true,
      },
    });

    return NextResponse.json({
      timeline: artifacts.timeline,
      debug: {
        ok: Boolean(artifacts.timeline),
        message: artifacts.timeline
          ? null
          : "Timeline analysis unavailable. Review the debug codes below to see why generation failed.",
        promptVersion: artifacts.meta.timeline?.prompt_version ?? null,
        schemaVersion: artifacts.meta.timeline?.schema_version ?? null,
        model: artifacts.meta.timeline?.model ?? null,
        reasoningEffort: artifacts.meta.timeline?.reasoning_effort ?? null,
        fallbackUsed: artifacts.meta.timeline?.fallback_used ?? false,
        failureClass: artifacts.meta.timeline?.failure_class ?? null,
        validatorFailures: artifacts.meta.timeline?.validator_failures ?? [],
      },
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Session not found";
    const status = message === "Session not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
