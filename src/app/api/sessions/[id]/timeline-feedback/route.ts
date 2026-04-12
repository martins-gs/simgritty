import { NextResponse } from "next/server";
import { computeScore, pickKeyMoments } from "@/lib/engine/scoring";
import { generateTimelineNarratives } from "@/lib/openai/reviewTimeline";
import {
  REVIEW_SUMMARY_VERSION,
  buildReviewMomentNarrative,
  buildReviewSummaryMomentInput,
  reviewTimelineResponseSchema,
} from "@/lib/review/feedback";
import { mergeTraineeAudioDeliveryFromEvents } from "@/lib/review/traineeDelivery";
import { createClient } from "@/lib/supabase/server";
import {
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseSimulationSession,
  parseTranscriptTurns,
} from "@/lib/validation/schemas";

const timelineFeedbackRequestCache = new Map<string, Promise<ReturnType<typeof reviewTimelineResponseSchema.parse>>>();

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

  const { data: sessionRow, error: sessionError } = await supabase
    .from("simulation_sessions")
    .select("*, scenario_templates(title, setting, ai_role, trainee_role)")
    .eq("id", id)
    .eq("trainee_id", user.id)
    .maybeSingle();

  if (sessionError) {
    return NextResponse.json({ error: sessionError.message }, { status: 500 });
  }

  const session = parseSimulationSession(sessionRow);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const [{ data: transcriptRows, error: transcriptError }, { data: eventRows, error: eventError }] = await Promise.all([
    supabase
      .from("transcript_turns")
      .select("*")
      .eq("session_id", id)
      .order("turn_index", { ascending: true }),
    supabase
      .from("simulation_state_events")
      .select("*")
      .eq("session_id", id)
      .order("event_index", { ascending: true }),
  ]);

  if (transcriptError) {
    return NextResponse.json({ error: transcriptError.message }, { status: 500 });
  }

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  const rawTurns = parseTranscriptTurns(transcriptRows ?? []);
  const events = parseSimulationEvents(eventRows ?? []);
  const turns = mergeTraineeAudioDeliveryFromEvents(rawTurns, events);
  const snapshot = parseScenarioSnapshot(session.scenario_snapshot);
  const score = computeScore({
    session,
    turns,
    events,
    milestones: snapshot.scenario_milestones,
    weights: snapshot.scoring_weights,
    supportThreshold: snapshot.support_threshold,
    criticalThreshold: snapshot.critical_threshold,
  });

  const keyMoments = pickKeyMoments(score.evidence, 8);
  if (!score.sessionValid || keyMoments.length === 0) {
    return NextResponse.json(
      reviewTimelineResponseSchema.parse({
        version: REVIEW_SUMMARY_VERSION,
        narratives: [],
      }),
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const fallbackNarratives = keyMoments.map((moment) => {
    const narrative = buildReviewMomentNarrative(moment, turns, session.started_at);
    return {
      turnIndex: narrative.turnIndex,
      timecode: narrative.timecode,
      headline: narrative.headline,
      likelyImpact: narrative.likelyImpact,
      whatHappenedNext: narrative.whatHappenedNext,
      whyItMattered: narrative.whyItMattered,
      tryInstead: narrative.tryInstead,
      positive: narrative.positive,
    };
  });

  const requestKey = `${user.id}:${id}:${REVIEW_SUMMARY_VERSION}:${keyMoments.map((moment) => moment.turnIndex).join(",")}`;
  let requestPromise = timelineFeedbackRequestCache.get(requestKey);

  if (!requestPromise) {
    requestPromise = (async () => {
      try {
        const generated = await generateTimelineNarratives({
          scenarioTitle: session.scenario_templates?.title ?? snapshot.title ?? "Simulation",
          scenarioSetting: session.scenario_templates?.setting ?? snapshot.setting ?? null,
          traineeRole: session.scenario_templates?.trainee_role ?? snapshot.trainee_role ?? null,
          aiRole: session.scenario_templates?.ai_role ?? snapshot.ai_role ?? null,
          learningObjectives: snapshot.learning_objectives,
          backstory: snapshot.backstory,
          emotionalDriver: snapshot.emotional_driver,
          traits: snapshot.scenario_traits[0] ?? null,
          milestones: snapshot.scenario_milestones,
          finalEscalationLevel: session.final_escalation_level ?? null,
          exitType: session.exit_type ?? null,
          moments: keyMoments.map((moment) => buildReviewSummaryMomentInput(moment, turns, session.started_at)),
        });

        return generated ?? reviewTimelineResponseSchema.parse({
          version: REVIEW_SUMMARY_VERSION,
          narratives: fallbackNarratives,
        });
      } catch (error) {
        console.error("[Timeline Feedback] Falling back to local narratives", error);

        return reviewTimelineResponseSchema.parse({
          version: REVIEW_SUMMARY_VERSION,
          narratives: fallbackNarratives,
        });
      }
    })().finally(() => {
      timelineFeedbackRequestCache.delete(requestKey);
    });

    timelineFeedbackRequestCache.set(requestKey, requestPromise);
  }

  const responsePayload = await requestPromise;

  return NextResponse.json(responsePayload, { headers: { "Cache-Control": "no-store" } });
}
