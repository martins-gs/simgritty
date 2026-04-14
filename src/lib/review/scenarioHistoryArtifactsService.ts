import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeScore } from "@/lib/engine/scoring";
import { generateScenarioHistoryCoachSummary } from "@/lib/openai/scenarioHistoryCoach";
import {
  parseStoredReviewArtifacts,
  REVIEW_ARTIFACTS_VERSION,
  REVIEW_HISTORY_PROMPT_VERSION,
  REVIEW_HISTORY_SCHEMA_VERSION,
} from "@/lib/review/artifacts";
import type { ReviewDebug } from "@/lib/review/feedback";
import { buildObjectiveCoverage } from "@/lib/review/feedback";
import type {
  ScenarioHistorySessionInput,
  StoredScenarioHistoryArtifact,
} from "@/lib/review/history";
import {
  SCENARIO_HISTORY_ARTIFACTS_VERSION,
  storedScenarioHistoryArtifactSchema,
} from "@/lib/review/history";
import {
  getSessionAudioDeliveryFromEvents,
  mergeTraineeAudioDeliveryFromEvents,
} from "@/lib/review/traineeDelivery";
import { loadOwnedSession } from "@/lib/supabase/ownedSession";
import {
  parseScenarioSnapshot,
  parseSimulationEvents,
  parseSimulationSession,
  parseTranscriptTurns,
} from "@/lib/validation/schemas";

interface ResolveScenarioHistoryTargetOptions {
  authSupabase: SupabaseClient;
  userId: string;
  sessionId?: string;
  scenarioId?: string;
}

interface ScenarioHistoryContext {
  scenarioId: string;
  latestSessionId: string | null;
  totalSessionCount: number;
  sessions: ScenarioHistorySessionInput[];
}

interface EnsureScenarioHistoryArtifactOptions {
  authSupabase: SupabaseClient;
  userId: string;
  persistSupabase?: SupabaseClient | null;
  sessionId?: string;
  scenarioId?: string;
  preferStored?: boolean;
}

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

function buildScenarioHistoryDebug(
  summary: StoredScenarioHistoryArtifact["summary"],
  meta: {
    prompt_version: string;
    schema_version: string;
    model: string;
    reasoning_effort: string;
    fallback_used: boolean;
    failure_class: ReviewDebug["failureClass"];
    validator_failures: string[];
  }
): ReviewDebug {
  return {
    ok: Boolean(summary),
    message: summary
      ? null
      : "Progress analysis unavailable. Review the debug codes below to see why generation failed.",
    promptVersion: meta.prompt_version,
    schemaVersion: meta.schema_version,
    model: meta.model,
    reasoningEffort: meta.reasoning_effort,
    fallbackUsed: meta.fallback_used,
    failureClass: meta.failure_class,
    validatorFailures: meta.validator_failures,
  };
}

function normaliseHistorySession(session: ScenarioHistorySessionInput) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    caseNeed: session.caseNeed,
    deliverySummary: session.deliverySummary,
    sessionOutcome: session.sessionOutcome,
    achievedObjectives: [...session.achievedObjectives],
    outstandingObjectives: [...session.outstandingObjectives],
    transcriptExcerpt: session.transcriptExcerpt,
    keyMoments: session.keyMoments.map((moment) => ({
      id: moment.id,
      positive: moment.positive,
      turnIndex: moment.turnIndex,
      before: moment.before,
      youSaid: moment.youSaid,
      after: moment.after,
      evidenceLabel: moment.evidenceLabel,
    })),
  };
}

function buildScenarioHistoryEvidenceHash(context: ScenarioHistoryContext) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: SCENARIO_HISTORY_ARTIFACTS_VERSION,
        latestSessionId: context.latestSessionId,
        totalSessionCount: context.totalSessionCount,
        sessions: context.sessions.map(normaliseHistorySession),
      })
    )
    .digest("hex");
}

function parseStoredScenarioHistoryArtifact(value: unknown) {
  const parsed = storedScenarioHistoryArtifactSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function fetchStoredScenarioHistoryArtifact(
  supabase: SupabaseClient,
  options: {
    userId: string;
    scenarioId: string;
  }
) {
  const { data: storedRow, error: storedError } = await supabase
    .from("scenario_history_artifacts")
    .select("artifact")
    .eq("trainee_id", options.userId)
    .eq("scenario_id", options.scenarioId)
    .maybeSingle();

  if (storedError) {
    if (!isMissingScenarioHistoryArtifactsTable(storedError)) {
      throw new Error(storedError.message);
    }
    return null;
  }

  return parseStoredScenarioHistoryArtifact(storedRow?.artifact);
}

function isStoredScenarioHistoryArtifactUsable(
  artifact: StoredScenarioHistoryArtifact | null
) {
  return Boolean(
    artifact &&
    artifact.version === SCENARIO_HISTORY_ARTIFACTS_VERSION &&
    artifact.summary &&
    artifact.debug.ok &&
    artifact.debug.promptVersion === REVIEW_HISTORY_PROMPT_VERSION &&
    artifact.debug.schemaVersion === REVIEW_HISTORY_SCHEMA_VERSION
  );
}

function isMissingScenarioHistoryArtifactsTable(error: { code?: string | null; message?: string | null }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (error.message ?? "").includes("scenario_history_artifacts")
  );
}

async function resolveScenarioHistoryTarget(
  options: ResolveScenarioHistoryTargetOptions
) {
  if (options.scenarioId) {
    return options.scenarioId;
  }

  if (!options.sessionId) {
    throw new Error("Scenario history target missing");
  }

  const ownership = await loadOwnedSession<{ id: string; scenario_id: string }>(
    options.authSupabase,
    options.sessionId,
    options.userId,
    "id, scenario_id"
  );
  if (ownership.error || !ownership.session) {
    throw new Error(ownership.error ?? "Session not found");
  }

  return ownership.session.scenario_id;
}

async function loadScenarioHistoryContext(
  options: ResolveScenarioHistoryTargetOptions
): Promise<ScenarioHistoryContext> {
  const scenarioId = await resolveScenarioHistoryTarget(options);

  const { data: sessionRows, error: sessionsError } = await options.authSupabase
    .from("simulation_sessions")
    .select("*, scenario_templates(title, setting, ai_role, trainee_role, difficulty)")
    .eq("scenario_id", scenarioId)
    .eq("trainee_id", options.userId)
    .order("created_at", { ascending: true });

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const totalSessionCount = sessionRows?.length ?? 0;
  const sessions = (sessionRows ?? []).flatMap((row) => {
    const parsed = parseSimulationSession(row);
    return parsed && parsed.started_at ? [parsed] : [];
  });
  const latestSessionId = sessions[sessions.length - 1]?.id ?? null;

  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length === 0) {
    return {
      scenarioId,
      latestSessionId,
      totalSessionCount,
      sessions: [],
    };
  }

  const [{ data: transcriptRows, error: transcriptError }, { data: eventRows, error: eventError }] = await Promise.all([
    options.authSupabase
      .from("transcript_turns")
      .select("*")
      .in("session_id", sessionIds)
      .order("turn_index", { ascending: true }),
    options.authSupabase
      .from("simulation_state_events")
      .select("*")
      .in("session_id", sessionIds)
      .order("event_index", { ascending: true }),
  ]);

  if (transcriptError) {
    throw new Error(transcriptError.message);
  }

  if (eventError) {
    throw new Error(eventError.message);
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

  const history = sessions.map((session) => {
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

  return {
    scenarioId,
    latestSessionId,
    totalSessionCount,
    sessions: history,
  };
}

export async function invalidateScenarioHistoryArtifact(
  supabase: SupabaseClient,
  options: {
    userId: string;
    scenarioId: string;
  }
) {
  const { error } = await supabase
    .from("scenario_history_artifacts")
    .delete()
    .eq("trainee_id", options.userId)
    .eq("scenario_id", options.scenarioId);

  if (error && !isMissingScenarioHistoryArtifactsTable(error)) {
    throw new Error(error.message);
  }
}

export async function invalidateScenarioHistoryArtifactsForScenario(
  supabase: SupabaseClient,
  scenarioId: string
) {
  const { error } = await supabase
    .from("scenario_history_artifacts")
    .delete()
    .eq("scenario_id", scenarioId);

  if (error && !isMissingScenarioHistoryArtifactsTable(error)) {
    throw new Error(error.message);
  }
}

export async function ensureScenarioHistoryArtifact(
  options: EnsureScenarioHistoryArtifactOptions
) {
  const persistClient = options.persistSupabase ?? options.authSupabase;
  const scenarioId = await resolveScenarioHistoryTarget(options);
  const stored = await fetchStoredScenarioHistoryArtifact(persistClient, {
    userId: options.userId,
    scenarioId,
  });

  if (options.preferStored) {
    if (isStoredScenarioHistoryArtifactUsable(stored)) {
      return {
        scenarioId,
        artifact: stored,
        source: "stored" as const,
      };
    }
  }

  const context = await loadScenarioHistoryContext({
    ...options,
    scenarioId,
  });

  if (context.sessions.length === 0) {
    await invalidateScenarioHistoryArtifact(persistClient, {
      userId: options.userId,
      scenarioId: context.scenarioId,
    });

    return {
      scenarioId: context.scenarioId,
      artifact: null,
      source: "none" as const,
    };
  }

  const evidenceHash = buildScenarioHistoryEvidenceHash(context);

  const storedReusable = Boolean(
    stored &&
    stored.version === SCENARIO_HISTORY_ARTIFACTS_VERSION &&
    stored.evidence_hash === evidenceHash &&
    stored.summary &&
    stored.debug.ok &&
    stored.debug.promptVersion === REVIEW_HISTORY_PROMPT_VERSION &&
    stored.debug.schemaVersion === REVIEW_HISTORY_SCHEMA_VERSION
  );

  if (storedReusable && stored) {
    return {
      scenarioId: context.scenarioId,
      artifact: stored,
      source: "stored" as const,
    };
  }

  const generated = await generateScenarioHistoryCoachSummary({
    currentSessionId: context.latestSessionId ?? context.sessions[context.sessions.length - 1]?.id ?? context.sessions[0].id,
    totalSessionCount: context.totalSessionCount,
    sessions: context.sessions,
  });

  const artifact = storedScenarioHistoryArtifactSchema.parse({
    version: SCENARIO_HISTORY_ARTIFACTS_VERSION,
    evidence_hash: evidenceHash,
    generated_at: new Date().toISOString(),
    latest_session_id: context.latestSessionId,
    total_session_count: context.totalSessionCount,
    summary: generated.summary,
    debug: buildScenarioHistoryDebug(generated.summary, {
      prompt_version: generated.meta.prompt_version,
      schema_version: generated.meta.schema_version,
      model: generated.meta.model,
      reasoning_effort: generated.meta.reasoning_effort,
      fallback_used: generated.meta.fallback_used,
      failure_class: generated.meta.failure_class,
      validator_failures: generated.meta.validator_failures,
    }),
  });

  const { error: persistError } = await persistClient
    .from("scenario_history_artifacts")
    .upsert(
      {
        trainee_id: options.userId,
        scenario_id: context.scenarioId,
        artifact,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "trainee_id,scenario_id" }
    );

  if (persistError && !isMissingScenarioHistoryArtifactsTable(persistError)) {
    throw new Error(persistError.message);
  }

  return {
    scenarioId: context.scenarioId,
    artifact,
    source: "generated" as const,
  };
}
