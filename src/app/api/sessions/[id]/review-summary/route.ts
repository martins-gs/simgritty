import { NextResponse } from "next/server";
import { generateReviewSummary } from "@/lib/openai/reviewSummary";
import { parseRequestJson } from "@/lib/validation/http";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import {
  getStoredReviewSummarySource,
  getStoredReviewSummaryVersion,
  REVIEW_SUMMARY_VERSION,
  reviewSummaryRequestSchema,
  reviewSummaryResponseSchema,
} from "@/lib/review/feedback";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: session, error: sessionError } = await authSupabase
    .from("simulation_sessions")
    .select("id, trainee_id, review_summary")
    .eq("id", id)
    .eq("trainee_id", user.id)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const storedSummary = reviewSummaryResponseSchema.safeParse(session.review_summary);
  const storedVersion = getStoredReviewSummaryVersion(session.review_summary);
  const storedSource = getStoredReviewSummarySource(session.review_summary);
  if (
    storedSummary.success &&
    storedVersion >= REVIEW_SUMMARY_VERSION &&
    storedSource === "generated"
  ) {
    return NextResponse.json(storedSummary.data, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  const parsed = await parseRequestJson(request, reviewSummaryRequestSchema);
  if (!parsed.success) return parsed.response;

  let summaryToPersist = parsed.data.fallback;
  let shouldPersistGeneratedSummary = false;

  try {
    const generated = await generateReviewSummary(parsed.data);
    if (generated) {
      summaryToPersist = generated;
      shouldPersistGeneratedSummary = true;
    } else {
      console.warn("[Review Summary] No structured summary returned; using local fallback for this response");
    }
  } catch (error) {
    console.error("[Review Summary] Falling back to local summary", error);
  }

  if (shouldPersistGeneratedSummary) {
    const persistSupabase = createAdminClientIfAvailable() ?? authSupabase;
    const { error: updateError } = await persistSupabase
      .from("simulation_sessions")
      .update({ review_summary: summaryToPersist })
      .eq("id", id)
      .eq("trainee_id", user.id);

    if (updateError) {
      console.error("[Review Summary] Failed to persist summary", updateError);
    }
  }

  return NextResponse.json(summaryToPersist, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
