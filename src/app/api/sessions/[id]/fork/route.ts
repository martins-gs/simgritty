import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import {
  forkSessionRequestBodySchema,
  parseSimulationSession,
  transcriptTurnSchema,
} from "@/lib/validation/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsedBody = await parseRequestJson(request, forkSessionRequestBodySchema);
  if (!parsedBody.success) return parsedBody.response;

  const body = parsedBody.data;
  const turnIndex = body.turn_index;

  const { data: sourceSession, error: sessionError } = await supabase
    .from("simulation_sessions")
    .select("*")
    .eq("id", id)
    .single();

  if (sessionError || !sourceSession) {
    return NextResponse.json({ error: "Source session not found" }, { status: 404 });
  }

  const typedSourceSession = parseSimulationSession(sourceSession);
  if (!typedSourceSession) {
    return NextResponse.json({ error: "Source session data invalid" }, { status: 500 });
  }

  const { data: sourceTurn, error: turnError } = await supabase
    .from("transcript_turns")
    .select("*")
    .eq("session_id", id)
    .eq("turn_index", turnIndex)
    .single();

  if (turnError || !sourceTurn) {
    return NextResponse.json({ error: "Source turn not found" }, { status: 404 });
  }

  const parsedTurn = transcriptTurnSchema.safeParse(sourceTurn);
  if (!parsedTurn.success) {
    return NextResponse.json({ error: "Source turn data invalid" }, { status: 500 });
  }

  const typedSourceTurn = parsedTurn.data;

  if (!typedSourceTurn.state_after || !typedSourceTurn.patient_prompt_after) {
    return NextResponse.json(
      { error: "Selected turn does not have a restart snapshot yet" },
      { status: 409 }
    );
  }

  const rootForkSessionId = typedSourceSession.forked_from_session_id ?? typedSourceSession.id;
  const nextBranchDepth = (typedSourceSession.branch_depth ?? 0) + 1;
  const forkLabel =
    body?.fork_label?.trim() ||
    `Retry from turn ${turnIndex}`;

  const { data: forkedSession, error: insertError } = await supabase
    .from("simulation_sessions")
    .insert({
      scenario_id: typedSourceSession.scenario_id,
      trainee_id: user.id,
      org_id: typedSourceSession.org_id,
      parent_session_id: typedSourceSession.id,
      forked_from_session_id: rootForkSessionId,
      forked_from_turn_index: turnIndex,
      fork_label: forkLabel,
      branch_depth: nextBranchDepth,
      status: "created",
      scenario_snapshot: typedSourceSession.scenario_snapshot,
    })
    .select("id, parent_session_id, forked_from_session_id, forked_from_turn_index, fork_label, branch_depth")
    .single();

  if (insertError || !forkedSession) {
    return NextResponse.json({ error: insertError?.message || "Failed to create forked session" }, { status: 500 });
  }

  return NextResponse.json(forkedSession, { status: 201 });
}
