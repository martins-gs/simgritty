import { NextResponse } from "next/server";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import { ensureSessionReviewArtifacts } from "@/lib/review/reviewArtifactsService";

export async function POST(
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
        summary: true,
      },
    });

    return NextResponse.json({
      summary: artifacts.summary,
      debug: {
        ok: Boolean(artifacts.summary),
        message: artifacts.summary
          ? null
          : "Session summary unavailable. Review the debug codes below to see why generation failed.",
        promptVersion: artifacts.meta.summary?.prompt_version ?? null,
        schemaVersion: artifacts.meta.summary?.schema_version ?? null,
        model: artifacts.meta.summary?.model ?? null,
        reasoningEffort: artifacts.meta.summary?.reasoning_effort ?? null,
        fallbackUsed: artifacts.meta.summary?.fallback_used ?? false,
        failureClass: artifacts.meta.summary?.failure_class ?? null,
        validatorFailures: artifacts.meta.summary?.validator_failures ?? [],
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
