import { NextResponse } from "next/server";
import { computeScore } from "@/lib/engine/scoring";
import { generateScenarioHistoryCoachSummary } from "@/lib/openai/scenarioHistoryCoach";
import {
  parseStoredReviewArtifacts,
  REVIEW_ARTIFACTS_VERSION,
} from "@/lib/review/artifacts";
import { buildObjectiveCoverage } from "@/lib/review/feedback";
import {
  type ScenarioHistorySessionInput,
} from "@/lib/review/history";
import {
  getSessionAudioDeliveryFromEvents,
  mergeTraineeAudioDeliveryFromEvents,
} from "@/lib/review/traineeDelivery";
import { createClient } from "@/lib/supabase/server";
import {
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseSimulationSession,
  parseTranscriptTurns,
} from "@/lib/validation/schemas";

function truncatePromptText(value: string | null | undefined, maxLength = 180) {
  if (!value) return null;

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildTranscriptExcerpt(turns: ReturnType<typeof parseTranscriptTurns>) {
  return turns
    .filter((turn) => turn.content?.trim())
    .slice(0, 10)
    .map((turn) => `${turn.speaker === "trainee" ? "You" : turn.speaker === "ai" ? "Patient/relative" : "Clinician"}: ${truncatePromptText(turn.content, 180)}`)
    .join("\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: currentSession, error: currentSessionError } = await supabase
    .from("simulation_sessions")
    .select("id, scenario_id, trainee_id")
    .eq("id", id)
    .maybeSingle();

  if (currentSessionError) {
    return NextResponse.json({ error: currentSessionError.message }, { status: 500 });
  }

  if (!currentSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: sessionRows, error: sessionsError } = await supabase
    .from("simulation_sessions")
    .select("*, scenario_templates(title, setting, ai_role, trainee_role, difficulty)")
    .eq("scenario_id", currentSession.scenario_id)
    .eq("trainee_id", currentSession.trainee_id)
    .order("created_at", { ascending: true });

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const totalSessionCount = sessionRows?.length ?? 0;
  const sessions = (sessionRows ?? []).flatMap((row) => {
    const parsed = parseSimulationSession(row);
    return parsed && parsed.started_at ? [parsed] : [];
  });

  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length === 0) {
    return NextResponse.json({ error: "No sessions found for this scenario" }, { status: 404 });
  }

  const [{ data: transcriptRows, error: transcriptError }, { data: eventRows, error: eventError }] = await Promise.all([
    supabase
      .from("transcript_turns")
      .select("*")
      .in("session_id", sessionIds)
      .order("turn_index", { ascending: true }),
    supabase
      .from("simulation_state_events")
      .select("*")
      .in("session_id", sessionIds)
      .order("event_index", { ascending: true }),
  ]);

  if (transcriptError) {
    return NextResponse.json({ error: transcriptError.message }, { status: 500 });
  }

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  const turns = parseTranscriptTurns(transcriptRows ?? []);
  const events = parseSimulationEvents(eventRows ?? []);
  const turnsBySession = new Map<string, ReturnType<typeof parseTranscriptTurns>>();
  const eventsBySession = new Map<string, ReturnType<typeof parseSimulationEvents>>();

  for (const turn of turns) {
    const existing = turnsBySession.get(turn.session_id) ?? [];
    existing.push(turn);
    turnsBySession.set(turn.session_id, existing);
  }

  for (const event of events) {
    const existing = eventsBySession.get(event.session_id) ?? [];
    existing.push(event);
    eventsBySession.set(event.session_id, existing);
  }

  const history: ScenarioHistorySessionInput[] = sessions.map((session) => {
    const sessionTurns = mergeTraineeAudioDeliveryFromEvents(
      turnsBySession.get(session.id) ?? [],
      eventsBySession.get(session.id) ?? []
    );
    const sessionEvents = eventsBySession.get(session.id) ?? [];
    const sessionDeliveryAnalysis = getSessionAudioDeliveryFromEvents(sessionEvents);
    const snapshot = parseScenarioSnapshot(session.scenario_snapshot);
    const score = computeScore({
      session,
      turns: sessionTurns,
      events: sessionEvents,
      milestones: snapshot.scenario_milestones,
      weights: snapshot.scoring_weights,
      supportThreshold: snapshot.support_threshold,
      criticalThreshold: snapshot.critical_threshold,
    });
    const objectiveCoverage = buildObjectiveCoverage(
      score,
      snapshot.scenario_milestones,
      snapshot.learning_objectives
    );
    const stored = parseStoredReviewArtifacts(session.review_artifacts);
    const useStoredCurrentArtifacts =
      stored &&
      stored.version === REVIEW_ARTIFACTS_VERSION &&
      stored.ledger.session_id === session.id;

    return {
      id: session.id,
      createdAt: session.created_at,
      caseNeed: (useStoredCurrentArtifacts ? stored.ledger.scenario_demand_summary.primary_need : objectiveCoverage.outstandingObjectives[0] ?? objectiveCoverage.objectiveFocus) ?? null,
      deliverySummary: (useStoredCurrentArtifacts ? stored.ledger.delivery_aggregate.summary : sessionDeliveryAnalysis?.summary) ?? null,
      sessionOutcome: score.sessionValid ? score.qualitativeLabel : "Too short to score",
      achievedObjectives: useStoredCurrentArtifacts ? stored.ledger.objective_ledger.achieved_objectives : objectiveCoverage.achievedObjectives,
      outstandingObjectives: useStoredCurrentArtifacts ? stored.ledger.objective_ledger.outstanding_objectives : objectiveCoverage.outstandingObjectives,
      transcriptExcerpt: buildTranscriptExcerpt(sessionTurns) || null,
      keyMoments: (useStoredCurrentArtifacts ? stored.ledger.moments : []).slice(0, 3).map((moment) => ({
        id: moment.id,
        positive: moment.positive,
        turnIndex: moment.turn_index,
        before: moment.previous_turn?.content ?? null,
        youSaid: moment.focus_turn?.content ?? null,
        after: moment.next_turn?.content ?? null,
        evidenceLabel: moment.dimension,
      })),
    };
  });

  try {
    const generatedSummary = await generateScenarioHistoryCoachSummary({
      currentSessionId: id,
      totalSessionCount,
      sessions: history,
    });

    return NextResponse.json({
      summary: generatedSummary.summary,
      debug: {
        ok: Boolean(generatedSummary.summary),
        message: generatedSummary.summary
          ? null
          : "Progress analysis unavailable. Review the debug codes below to see why generation failed.",
        promptVersion: generatedSummary.meta.prompt_version,
        schemaVersion: generatedSummary.meta.schema_version,
        model: generatedSummary.meta.model,
        reasoningEffort: generatedSummary.meta.reasoning_effort,
        fallbackUsed: generatedSummary.meta.fallback_used,
        failureClass: generatedSummary.meta.failure_class,
        validatorFailures: generatedSummary.meta.validator_failures,
      },
    }, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Scenario History] analysis failed", error);
  }

  return NextResponse.json({
    summary: null,
    debug: {
      ok: false,
      message: "Progress analysis unavailable. Review generation threw an unexpected error.",
      promptVersion: null,
      schemaVersion: null,
      model: null,
      reasoningEffort: null,
      fallbackUsed: false,
      failureClass: "schema",
      validatorFailures: ["route_error"],
    },
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
