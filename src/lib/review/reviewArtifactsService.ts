import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScore, type ScoreBreakdown } from "@/lib/engine/scoring";
import { generateReviewSummary } from "@/lib/openai/reviewSummary";
import { generateTimelineNarratives } from "@/lib/openai/reviewTimeline";
import {
  buildReviewArtifactsEvidenceHash,
  buildReviewArtifactsDraft,
  parseStoredReviewArtifacts,
  REVIEW_ARTIFACTS_VERSION,
  REVIEW_TIMELINE_PROMPT_VERSION,
  REVIEW_TIMELINE_SCHEMA_VERSION,
  storedReviewArtifactsSchema,
} from "@/lib/review/artifacts";
import {
  REVIEW_SUMMARY_VERSION,
} from "@/lib/review/feedback";
import {
  getSessionAudioDeliveryFromEvents,
  mergeTraineeAudioDeliveryFromEvents,
} from "@/lib/review/traineeDelivery";
import type {
  SessionDeliveryAnalysis,
  SimulationSession,
  SimulationStateEvent,
  TranscriptTurn,
} from "@/types/simulation";
import {
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseSimulationSession,
  parseTranscriptTurns,
} from "@/lib/validation/schemas";

interface LoadedReviewSessionContext {
  session: SimulationSession;
  turns: TranscriptTurn[];
  events: SimulationStateEvent[];
  sessionDeliveryAnalysis: SessionDeliveryAnalysis | null;
  score: ScoreBreakdown;
  snapshot: ReturnType<typeof parseScenarioSnapshot>;
}

interface EnsureReviewArtifactsOptions {
  sessionId: string;
  userId: string;
  authSupabase: SupabaseClient;
  persistSupabase?: SupabaseClient | null;
  surfaces: {
    summary?: boolean;
    timeline?: boolean;
  };
}

const ensureArtifactsRequestCache = new Map<string, Promise<{
  context: LoadedReviewSessionContext;
  artifacts: ReturnType<typeof storedReviewArtifactsSchema.parse>;
}>>();
const completedArtifactsCache = new Map<string, ReturnType<typeof storedReviewArtifactsSchema.parse>>();
let reviewArtifactsPersistenceMode: "unknown" | "available" | "legacy_only" = "unknown";
let loggedLegacyOnlyPersistence = false;

function rememberCompletedArtifacts(
  cacheKey: string,
  artifacts: ReturnType<typeof storedReviewArtifactsSchema.parse>
) {
  if (completedArtifactsCache.has(cacheKey)) {
    completedArtifactsCache.delete(cacheKey);
  }

  completedArtifactsCache.set(cacheKey, artifacts);

  if (completedArtifactsCache.size > 40) {
    const oldestKey = completedArtifactsCache.keys().next().value;
    if (oldestKey) {
      completedArtifactsCache.delete(oldestKey);
    }
  }
}

function isMissingReviewArtifactsColumn(error: { code?: string | null; message?: string | null }) {
  return error.code === "PGRST204" && (error.message ?? "").includes("review_artifacts");
}

async function loadReviewSessionContext(
  authSupabase: SupabaseClient,
  sessionId: string,
  userId: string
): Promise<LoadedReviewSessionContext | null> {
  const { data: sessionRow, error: sessionError } = await authSupabase
    .from("simulation_sessions")
    .select("*, scenario_templates(title, setting, ai_role, trainee_role)")
    .eq("id", sessionId)
    .eq("trainee_id", userId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  const session = parseSimulationSession(sessionRow);
  if (!session) {
    return null;
  }

  const [{ data: transcriptRows, error: transcriptError }, { data: eventRows, error: eventError }] = await Promise.all([
    authSupabase
      .from("transcript_turns")
      .select("*")
      .eq("session_id", sessionId)
      .order("turn_index", { ascending: true }),
    authSupabase
      .from("simulation_state_events")
      .select("*")
      .eq("session_id", sessionId)
      .order("event_index", { ascending: true }),
  ]);

  if (transcriptError) {
    throw new Error(transcriptError.message);
  }

  if (eventError) {
    throw new Error(eventError.message);
  }

  const rawTurns = parseTranscriptTurns(transcriptRows ?? []);
  const events = parseSimulationEvents(eventRows ?? []);
  const turns = mergeTraineeAudioDeliveryFromEvents(rawTurns, events);
  const sessionDeliveryAnalysis = getSessionAudioDeliveryFromEvents(events);
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

  return {
    session: {
      ...session,
      scenario_templates: {
        title: session.scenario_templates?.title ?? snapshot.title,
        setting: session.scenario_templates?.setting ?? snapshot.setting,
        ai_role: session.scenario_templates?.ai_role ?? snapshot.ai_role,
        trainee_role: session.scenario_templates?.trainee_role ?? snapshot.trainee_role,
        difficulty: session.scenario_templates?.difficulty,
      },
    },
    turns,
    events,
    sessionDeliveryAnalysis,
    score,
    snapshot,
  };
}

export async function ensureSessionReviewArtifacts(
  options: EnsureReviewArtifactsOptions
) {
  const requestKey = [
    options.userId,
    options.sessionId,
    options.surfaces.summary ? "summary" : "no-summary",
    options.surfaces.timeline ? "timeline" : "no-timeline",
  ].join(":");
  const cached = ensureArtifactsRequestCache.get(requestKey);
  if (cached) {
    return cached;
  }

  const requestPromise = (async () => {
    const context = await loadReviewSessionContext(
      options.authSupabase,
      options.sessionId,
      options.userId
    );

    if (!context) {
      throw new Error("Session not found");
    }

    const draftContext = {
      session: context.session,
      score: context.score,
      turns: context.turns,
      sessionDeliveryAnalysis: context.sessionDeliveryAnalysis,
      milestones: context.snapshot.scenario_milestones,
      learningObjectives: context.snapshot.learning_objectives,
      aiRole: context.snapshot.ai_role,
      backstory: context.snapshot.backstory,
      emotionalDriver: context.snapshot.emotional_driver,
      traits: context.snapshot.scenario_traits[0] ?? null,
    };
    const evidenceHash = buildReviewArtifactsEvidenceHash(draftContext);
    const artifactCacheKey = `${options.userId}:${options.sessionId}:${evidenceHash}`;

    const stored = parseStoredReviewArtifacts(context.session.review_artifacts);
    const storedMatches =
      stored &&
      stored.version === REVIEW_ARTIFACTS_VERSION &&
      stored.evidence_hash === evidenceHash;
    const completed = storedMatches
      ? null
      : completedArtifactsCache.get(artifactCacheKey) ?? null;
    const reusableArtifacts = storedMatches
      ? stored
      : completed?.version === REVIEW_ARTIFACTS_VERSION && completed.evidence_hash === evidenceHash
        ? completed
        : null;
    let summary = reusableArtifacts?.summary ?? null;
    let timeline = reusableArtifacts?.timeline ?? null;
    let summaryMeta = reusableArtifacts?.meta.summary ?? null;
    let timelineMeta = reusableArtifacts?.meta.timeline ?? null;
    let momentSelectionMeta = reusableArtifacts?.meta.moment_selection ?? null;
    const summaryAlreadyAttempted = Boolean(summary) || Boolean(summaryMeta && !summaryMeta.failure_class);
    const timelineAlreadyAttempted = Boolean(timeline) || Boolean(timelineMeta && !timelineMeta.failure_class);
    const needsDraft = !reusableArtifacts;
    const draft = needsDraft
      ? await buildReviewArtifactsDraft(draftContext)
      : null;
    const resolvedLedger = reusableArtifacts?.ledger ?? draft?.ledger;
    const resolvedSummaryPlan = reusableArtifacts?.summary_plan ?? draft?.summaryPlan;
    const resolvedTimelinePlans = reusableArtifacts?.timeline_plans ?? draft?.timelinePlans;
    momentSelectionMeta = momentSelectionMeta ?? draft?.momentSelectionMeta ?? null;

    if (!resolvedLedger || !resolvedSummaryPlan || !resolvedTimelinePlans) {
      throw new Error("Review artifacts could not be assembled");
    }

    const summaryPromise = options.surfaces.summary && !summaryAlreadyAttempted
      ? generateReviewSummary({
          ledger: resolvedLedger,
          turns: context.turns,
        })
      : Promise.resolve(null);

    const timelinePromise = options.surfaces.timeline && !timelineAlreadyAttempted
      ? resolvedLedger.moments.length === 0 && momentSelectionMeta?.failure_class
        ? Promise.resolve({
            timeline: null,
            meta: {
              prompt_version: REVIEW_TIMELINE_PROMPT_VERSION,
              schema_version: REVIEW_TIMELINE_SCHEMA_VERSION,
              model: momentSelectionMeta.model,
              reasoning_effort: momentSelectionMeta.reasoning_effort,
              retry_count: momentSelectionMeta.retry_count,
              fallback_used: false,
              failure_class: momentSelectionMeta.failure_class,
              validator_failures: [
                "moment_selection_failed",
                ...momentSelectionMeta.validator_failures,
              ],
              field_provenance: {},
            },
          })
        : generateTimelineNarratives({
            ledger: resolvedLedger,
            turns: context.turns,
            sessionStartedAt: context.session.started_at,
          })
      : Promise.resolve(null);

    const [generatedSummary, generatedTimeline] = await Promise.all([
      summaryPromise,
      timelinePromise,
    ]);

    if (generatedSummary) {
      summary = generatedSummary.summary;
      summaryMeta = generatedSummary.meta;
    }

    if (generatedTimeline) {
      timeline = generatedTimeline.timeline;
      timelineMeta = generatedTimeline.meta;
    }

    const artifacts = storedReviewArtifactsSchema.parse({
      version: REVIEW_ARTIFACTS_VERSION,
      evidence_hash: evidenceHash,
      meta: {
        built_at: new Date().toISOString(),
        moment_selection: momentSelectionMeta,
        summary: summaryMeta,
        timeline: timelineMeta,
      },
      ledger: resolvedLedger,
      summary_plan: resolvedSummaryPlan,
      timeline_plans: resolvedTimelinePlans,
      summary,
      timeline,
    });

    const shouldPersist =
      !storedMatches ||
      JSON.stringify(momentSelectionMeta) !== JSON.stringify(reusableArtifacts?.meta.moment_selection ?? null) ||
      summary !== reusableArtifacts?.summary ||
      timeline !== reusableArtifacts?.timeline;

    if (shouldPersist) {
      const persistClient = options.persistSupabase ?? options.authSupabase;
      const updateData: Record<string, unknown> = {
      };

      if (reviewArtifactsPersistenceMode !== "legacy_only") {
        updateData.review_artifacts = artifacts;
      }

      if (summary?.version === REVIEW_SUMMARY_VERSION) {
        updateData.review_summary = summary;
      }

      if (Object.keys(updateData).length > 0) {
        const { error: persistError } = await persistClient
          .from("simulation_sessions")
          .update(updateData)
          .eq("id", context.session.id)
          .eq("trainee_id", options.userId);

        if (persistError) {
          if (isMissingReviewArtifactsColumn(persistError)) {
            reviewArtifactsPersistenceMode = "legacy_only";
            if (!loggedLegacyOnlyPersistence) {
              console.warn("[Review Artifacts] review_artifacts column missing; falling back to legacy summary persistence only.");
              loggedLegacyOnlyPersistence = true;
            }

            if (summary) {
              const { error: legacyPersistError } = await persistClient
                .from("simulation_sessions")
                .update({ review_summary: summary })
                .eq("id", context.session.id)
                .eq("trainee_id", options.userId);

              if (legacyPersistError) {
                console.error("[Review Artifacts] Failed to persist legacy review summary", legacyPersistError);
              }
            }
          } else {
            console.error("[Review Artifacts] Failed to persist artifacts", persistError);
          }
        } else if ("review_artifacts" in updateData) {
          reviewArtifactsPersistenceMode = "available";
        }
      }
    }

    rememberCompletedArtifacts(artifactCacheKey, artifacts);

    return {
      context,
      artifacts,
    };
  })().finally(() => {
    ensureArtifactsRequestCache.delete(requestKey);
  });

  ensureArtifactsRequestCache.set(requestKey, requestPromise);
  return requestPromise;
}
