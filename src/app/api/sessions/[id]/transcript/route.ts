import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import {
  transcriptTurnCreateRequestBodySchema,
  transcriptTurnPatchRequestBodySchema,
} from "@/lib/validation/schemas";
import type { ClassifierResult, TraineeDeliveryAnalysis } from "@/types/simulation";

function isSnapshotColumnError(message: string) {
  return [
    "trigger_type",
    "state_after",
    "patient_voice_profile_after",
    "patient_prompt_after",
  ].some((column) => message.includes(column));
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: turns, error } = await supabase
    .from("transcript_turns")
    .select("*")
    .eq("session_id", id)
    .order("turn_index", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const analysedTurnIndexes = (turns ?? []).flatMap((turn) => {
    const classifier = turn.classifier_result;
    if (
      turn.speaker === "trainee" &&
      classifier &&
      typeof classifier === "object" &&
      "trainee_delivery_analysis" in classifier &&
      (classifier as Record<string, unknown>).trainee_delivery_analysis
    ) {
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, transcriptTurnCreateRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;

  const baseInsert = {
    session_id: id,
    turn_index: body.turn_index,
    speaker: body.speaker,
    content: body.content,
    audio_url: body.audio_url || null,
    classifier_result: body.classifier_result || null,
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

  let { error } = await supabase.from("transcript_turns").insert(snapshotInsert);

  if (error && isSnapshotColumnError(error.message)) {
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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = await parseRequestJson(request, transcriptTurnPatchRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;

  if (body.classifier_result?.trainee_delivery_analysis) {
    console.info(
      `[Transcript API] patch turn=${body.turn_index} trainee_audio_delivery markers=${body.classifier_result.trainee_delivery_analysis.markers.join(",") || "none"}`
    );
  }

  const { data: existingTurn, error: existingTurnError } = await supabase
    .from("transcript_turns")
    .select("id, classifier_result")
    .eq("session_id", id)
    .eq("turn_index", body.turn_index)
    .maybeSingle();

  if (existingTurnError) {
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

  const mergedDeliveryAnalysis = getPersistedDeliveryAnalysis(mergedClassifierResult);
  if (mergedDeliveryAnalysis) {
    console.info(
      `[Transcript API] merged turn=${body.turn_index} trainee_audio_delivery markers=${mergedDeliveryAnalysis.markers.join(",") || "none"}`
    );
  }

  const snapshotUpdate = {
    classifier_result: mergedClassifierResult,
    trigger_type: body.trigger_type || null,
    state_after: body.state_after || null,
    patient_voice_profile_after: body.patient_voice_profile_after || null,
    patient_prompt_after: body.patient_prompt_after || null,
  };

  const { data: updatedTurn, error } = await supabase
    .from("transcript_turns")
    .update(snapshotUpdate)
    .eq("id", existingTurn.id)
    .select("turn_index, classifier_result")
    .maybeSingle();

  if (error) {
    if (isSnapshotColumnError(error.message)) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!updatedTurn) {
    return NextResponse.json(
      { error: `Transcript turn ${body.turn_index} update returned no row` },
      { status: 500 }
    );
  }

  const storedDeliveryAnalysis = getPersistedDeliveryAnalysis(updatedTurn.classifier_result);
  console.info(
    `[Transcript API] stored turn=${updatedTurn.turn_index} trainee_audio_delivery=${storedDeliveryAnalysis ? "present" : "absent"}`
  );

  return NextResponse.json({
    success: true,
    turnIndex: updatedTurn.turn_index,
    hasTraineeDeliveryAnalysis: !!storedDeliveryAnalysis,
    markers: storedDeliveryAnalysis?.markers ?? [],
  });
}
