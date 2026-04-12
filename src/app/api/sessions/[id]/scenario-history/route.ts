import { NextResponse } from "next/server";
import { computeScore, pickKeyMoments } from "@/lib/engine/scoring";
import { generateScenarioHistoryCoachSummary } from "@/lib/openai/scenarioHistoryCoach";
import {
  buildFallbackReviewSummary,
  getStoredReviewSummarySource,
  getStoredReviewSummaryVersion,
  REVIEW_SUMMARY_VERSION,
  reviewSummaryResponseSchema,
} from "@/lib/review/feedback";
import { buildScenarioHistoryCoachSummary } from "@/lib/review/history";
import { mergeTraineeAudioDeliveryFromEvents } from "@/lib/review/traineeDelivery";
import { createClient } from "@/lib/supabase/server";
import {
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseSimulationSession,
  parseTranscriptTurns,
} from "@/lib/validation/schemas";

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
    .eq("trainee_id", user.id)
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
    .eq("trainee_id", user.id)
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

  const currentSnapshot = parseScenarioSnapshot(
    sessions.find((session) => session.id === id)?.scenario_snapshot
      ?? sessions.at(-1)?.scenario_snapshot
      ?? null
  );

  const history = sessions.map((session) => {
    const sessionTurns = mergeTraineeAudioDeliveryFromEvents(
      turnsBySession.get(session.id) ?? [],
      eventsBySession.get(session.id) ?? []
    );
    const sessionEvents = eventsBySession.get(session.id) ?? [];
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
    const fallbackSummary = buildFallbackReviewSummary(
      session,
      score,
      sessionTurns,
      pickKeyMoments(score.evidence),
      {
        milestones: snapshot.scenario_milestones,
        learningObjectives: snapshot.learning_objectives,
        aiRole: snapshot.ai_role,
        backstory: snapshot.backstory,
        emotionalDriver: snapshot.emotional_driver,
        traits: snapshot.scenario_traits[0] ?? null,
      }
    );
    const storedSummary = reviewSummaryResponseSchema.safeParse(session.review_summary);
    const storedVersion = getStoredReviewSummaryVersion(session.review_summary);
    const storedSource = getStoredReviewSummarySource(session.review_summary);
    const reviewSummary = storedSummary.success
      && storedVersion >= REVIEW_SUMMARY_VERSION
      && storedSource === "generated"
      ? {
          ...storedSummary.data,
          overallDelivery: storedSummary.data.overallDelivery ?? fallbackSummary.overallDelivery,
        }
      : fallbackSummary;

    return {
      id: session.id,
      createdAt: session.created_at,
      score,
      reviewSummary,
    };
  });

  const fallbackSummary = buildScenarioHistoryCoachSummary(history, id, totalSessionCount);

  try {
    const generatedSummary = await generateScenarioHistoryCoachSummary({
      scenarioTitle: currentSnapshot.title,
      scenarioSetting: currentSnapshot.setting,
      traineeRole: currentSnapshot.trainee_role,
      aiRole: currentSnapshot.ai_role,
      learningObjectives: currentSnapshot.learning_objectives,
      backstory: currentSnapshot.backstory,
      emotionalDriver: currentSnapshot.emotional_driver,
      traits: currentSnapshot.scenario_traits[0] ?? null,
      currentSessionId: id,
      totalSessionCount,
      sessions: history,
    });

    return NextResponse.json(generatedSummary ?? fallbackSummary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[Scenario History] Falling back to local coach summary", error);
  }

  return NextResponse.json(fallbackSummary, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
