import { NextResponse } from "next/server";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import {
  parseTraineeDeliveryAnalysis,
  transcriptTurnCreateRequestBodySchema,
  transcriptTurnPatchRequestBodySchema,
} from "@/lib/validation/schemas";
import type { ClassifierResult, TraineeDeliveryAnalysis } from "@/types/simulation";

function isLegacySnapshotColumnError(message: string) {
  return [
    "trigger_type",
    "state_after",
    "patient_voice_profile_after",
    "patient_prompt_after",
  ].some((column) => message.includes(column));
}

function isTraineeDeliveryColumnError(message: string) {
  return message.includes("trainee_delivery_analysis");
}

function getPersistedDeliveryAnalysis(
  classifierResult: unknown
): TraineeDeliveryAnalysis | null {
  if (!classifierResult || typeof classifierResult !== "object") {
    return null;
  }

  const candidate = (classifierResult as Record<string, unknown>).trainee_delivery_analysis;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return candidate as TraineeDeliveryAnalysis;
}

function parseDirectDeliveryAnalysis(value: unknown): TraineeDeliveryAnalysis | null {
  return parseTraineeDeliveryAnalysis(value);
}

function mergeClassifierResult(
  existing: unknown,
  incoming: ClassifierResult | null | undefined
): ClassifierResult | null {
  if (incoming === undefined) {
    if (!existing || typeof existing !== "object") {
      return null;
    }
    return existing as ClassifierResult;
  }

  if (incoming === null) {
    return null;
  }

  const existingDeliveryAnalysis = getPersistedDeliveryAnalysis(existing);
  if (incoming.trainee_delivery_analysis || !existingDeliveryAnalysis) {
    return incoming;
  }

  return {
    ...incoming,
    trainee_delivery_analysis: existingDeliveryAnalysis,
  };
}

function resolveTurnDeliveryAnalysis(
  topLevelValue: unknown,
  classifierResult: ClassifierResult | null | undefined
): TraineeDeliveryAnalysis | null {
  return (
    parseDirectDeliveryAnalysis(topLevelValue) ??
    classifierResult?.trainee_delivery_analysis ??
    null
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAdminClientIfAvailable() ?? authSupabase;

  const { data: turns, error } = await supabase
    .from("transcript_turns")
    .select("*")
    .eq("session_id", id)
    .order("turn_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const analysedTurnIndexes = (turns ?? []).flatMap((turn) => {
    const storedDeliveryAnalysis =
      parseDirectDeliveryAnalysis(turn.trainee_delivery_analysis) ??
      getPersistedDeliveryAnalysis(turn.classifier_result);
    if (turn.speaker === "trainee" && storedDeliveryAnalysis) {
      return [turn.turn_index];
    }
    return [];
  });

  console.info(
    `[Transcript API] session=${id} total_turns=${turns?.length ?? 0} trainee_audio_delivery_turns=${analysedTurnIndexes.join(",") || "none"}`
  );

  return NextResponse.json(turns, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAdminClientIfAvailable() ?? authSupabase;

  const parsed = await parseRequestJson(request, transcriptTurnCreateRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;
  const traineeDeliveryAnalysis = resolveTurnDeliveryAnalysis(
    body.trainee_delivery_analysis,
    body.classifier_result ?? null
  );

  const baseInsert = {
    session_id: id,
    turn_index: body.turn_index,
    speaker: body.speaker,
    content: body.content,
    audio_url: body.audio_url || null,
    classifier_result: body.classifier_result || null,
    trainee_delivery_analysis: traineeDeliveryAnalysis,
    started_at: body.started_at || undefined,
    duration_ms: body.duration_ms || null,
  };

  const snapshotInsert = {
    ...baseInsert,
    trigger_type: body.trigger_type || null,
    state_after: body.state_after || null,
    patient_voice_profile_after: body.patient_voice_profile_after || null,
    patient_prompt_after: body.patient_prompt_after || null,
  };
  const snapshotInsertWithoutDelivery = {
    session_id: snapshotInsert.session_id,
    turn_index: snapshotInsert.turn_index,
    speaker: snapshotInsert.speaker,
    content: snapshotInsert.content,
    audio_url: snapshotInsert.audio_url,
    classifier_result: snapshotInsert.classifier_result,
    trigger_type: snapshotInsert.trigger_type,
    state_after: snapshotInsert.state_after,
    patient_voice_profile_after: snapshotInsert.patient_voice_profile_after,
    patient_prompt_after: snapshotInsert.patient_prompt_after,
    started_at: snapshotInsert.started_at,
    duration_ms: snapshotInsert.duration_ms,
  };

  let { error } = await supabase.from("transcript_turns").insert(snapshotInsert);

  if (error && isTraineeDeliveryColumnError(error.message)) {
    const retryWithoutDelivery = await supabase.from("transcript_turns").insert(snapshotInsertWithoutDelivery);
    error = retryWithoutDelivery.error;
  }

  if (error && isLegacySnapshotColumnError(error.message)) {
    const retry = await supabase.from("transcript_turns").insert(baseInsert);
    error = retry.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const supabase = createAdminClientIfAvailable() ?? authSupabase;

  const parsed = await parseRequestJson(request, transcriptTurnPatchRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;

  const requestedTraineeDeliveryAnalysis = resolveTurnDeliveryAnalysis(
    body.trainee_delivery_analysis,
    body.classifier_result ?? null
  );

  if (requestedTraineeDeliveryAnalysis) {
    console.info(
      `[Transcript API] patch turn=${body.turn_index} trainee_audio_delivery markers=${requestedTraineeDeliveryAnalysis.markers.join(",") || "none"}`
    );
  }

  const { data: existingTurn, error: existingTurnError } = await supabase
    .from("transcript_turns")
    .select("id, classifier_result, trainee_delivery_analysis")
    .eq("session_id", id)
    .eq("turn_index", body.turn_index)
    .maybeSingle();

  if (existingTurnError) {
    if (isTraineeDeliveryColumnError(existingTurnError.message)) {
      return NextResponse.json(
        { error: "Database missing transcript_turns.trainee_delivery_analysis column" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: existingTurnError.message }, { status: 500 });
  }

  if (!existingTurn) {
    return NextResponse.json(
      { error: `Transcript turn ${body.turn_index} not found for session ${id}` },
      { status: 404 }
    );
  }

  const mergedClassifierResult = mergeClassifierResult(
    existingTurn.classifier_result,
    body.classifier_result
  );

  const mergedDeliveryAnalysis =
    requestedTraineeDeliveryAnalysis ??
    parseDirectDeliveryAnalysis(existingTurn.trainee_delivery_analysis) ??
    getPersistedDeliveryAnalysis(mergedClassifierResult);
  if (mergedDeliveryAnalysis) {
    console.info(
      `[Transcript API] merged turn=${body.turn_index} trainee_audio_delivery markers=${mergedDeliveryAnalysis.markers.join(",") || "none"}`
    );
  }

  const snapshotUpdate = {
    classifier_result: mergedClassifierResult,
    trainee_delivery_analysis: mergedDeliveryAnalysis,
    trigger_type: body.trigger_type || null,
    state_after: body.state_after || null,
    patient_voice_profile_after: body.patient_voice_profile_after || null,
    patient_prompt_after: body.patient_prompt_after || null,
  };

  const { data: updatedTurn, error } = await supabase
    .from("transcript_turns")
    .update(snapshotUpdate)
    .eq("id", existingTurn.id)
    .select("turn_index, classifier_result, trainee_delivery_analysis")
    .maybeSingle();

  if (error) {
    if (isLegacySnapshotColumnError(error.message)) {
      return NextResponse.json({ success: true });
    }
    if (isTraineeDeliveryColumnError(error.message)) {
      return NextResponse.json(
        { error: "Database missing transcript_turns.trainee_delivery_analysis column" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let resolvedUpdatedTurn = updatedTurn;
  if (!resolvedUpdatedTurn) {
    const followUp = await supabase
      .from("transcript_turns")
      .select("turn_index, classifier_result, trainee_delivery_analysis")
      .eq("id", existingTurn.id)
      .maybeSingle();

    if (followUp.error) {
      if (isTraineeDeliveryColumnError(followUp.error.message)) {
        return NextResponse.json(
          { error: "Database missing transcript_turns.trainee_delivery_analysis column" },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: followUp.error.message }, { status: 500 });
    }

    resolvedUpdatedTurn = followUp.data;
  }

  if (!resolvedUpdatedTurn) {
    return NextResponse.json(
      { error: `Transcript turn ${body.turn_index} update returned no row` },
      { status: 500 }
    );
  }

  const storedDeliveryAnalysis =
    parseDirectDeliveryAnalysis(resolvedUpdatedTurn.trainee_delivery_analysis) ??
    getPersistedDeliveryAnalysis(resolvedUpdatedTurn.classifier_result);
  console.info(
    `[Transcript API] stored turn=${resolvedUpdatedTurn.turn_index} trainee_audio_delivery=${storedDeliveryAnalysis ? "present" : "absent"}`
  );

  return NextResponse.json({
    success: true,
    turnIndex: resolvedUpdatedTurn.turn_index,
    hasTraineeDeliveryAnalysis: !!storedDeliveryAnalysis,
    markers: storedDeliveryAnalysis?.markers ?? [],
  });
}
