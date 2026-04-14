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
  trigger?: string;
}

interface StoredScenarioHistoryArtifactLookup {
  artifact: StoredScenarioHistoryArtifact | null;
  found: boolean;
  parsed: boolean;
  tableAvailable: boolean;
  rowCreatedAt: string | null;
  rowUpdatedAt: string | null;
  parseIssues: string[];
}

interface ScenarioHistoryLogContext {
  trigger: string;
  userId: string;
  scenarioId: string;
  sessionId: string | null;
  preferStored: boolean;
  persistMode: "admin" | "auth";
}

function logScenarioHistory(
  level: "info" | "warn" | "error",
  event: string,
  details: object,
  error?: unknown
) {
  const message = `[Scenario History] ${event} ${JSON.stringify(details)}`;
  if (level === "error") {
    console.error(message, error ?? "");
    return;
  }

  if (level === "warn") {
    console.warn(message, error ?? "");
    return;
  }

  console.info(message);
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
  return {
    artifact: parsed.success ? parsed.data : null,
    parseIssues: parsed.success
      ? []
      : parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}:${issue.message}`).slice(0, 8),
  };
}

function buildScenarioHistoryLogContext(
  options: EnsureScenarioHistoryArtifactOptions,
  scenarioId: string
): ScenarioHistoryLogContext {
  return {
    trigger: options.trigger ?? "unspecified",
    userId: options.userId,
    scenarioId,
    sessionId: options.sessionId ?? null,
    preferStored: Boolean(options.preferStored),
    persistMode: options.persistSupabase && options.persistSupabase !== options.authSupabase ? "admin" : "auth",
  };
}

function buildStoredArtifactLogDetails(lookup: StoredScenarioHistoryArtifactLookup) {
  return {
    storedFound: lookup.found,
    storedParsed: lookup.parsed,
    tableAvailable: lookup.tableAvailable,
    rowCreatedAt: lookup.rowCreatedAt,
    rowUpdatedAt: lookup.rowUpdatedAt,
    parseIssues: lookup.parseIssues,
    storedVersion: lookup.artifact?.version ?? null,
    storedGeneratedAt: lookup.artifact?.generated_at ?? null,
    storedLatestSessionId: lookup.artifact?.latest_session_id ?? null,
    storedTotalSessionCount: lookup.artifact?.total_session_count ?? null,
    storedSummaryPresent: Boolean(lookup.artifact?.summary),
    storedDebugOk: lookup.artifact?.debug.ok ?? null,
    storedPromptVersion: lookup.artifact?.debug.promptVersion ?? null,
    storedSchemaVersion: lookup.artifact?.debug.schemaVersion ?? null,
    storedEvidenceHash: lookup.artifact?.evidence_hash ?? null,
  };
}

function getStoredArtifactUsabilityReasons(lookup: StoredScenarioHistoryArtifactLookup) {
  if (!lookup.found) {
    return lookup.tableAvailable ? ["stored_row_missing"] : ["stored_table_unavailable"];
  }

  if (!lookup.parsed || !lookup.artifact) {
    return ["stored_row_invalid_schema"];
  }

  const reasons: string[] = [];

  if (lookup.artifact.version !== SCENARIO_HISTORY_ARTIFACTS_VERSION) {
    reasons.push("stored_version_mismatch");
  }
  if (!lookup.artifact.summary) {
    reasons.push("stored_summary_missing");
  }
  if (!lookup.artifact.debug.ok) {
    reasons.push("stored_debug_not_ok");
  }
  if (lookup.artifact.debug.promptVersion !== REVIEW_HISTORY_PROMPT_VERSION) {
    reasons.push("stored_prompt_version_mismatch");
  }
  if (lookup.artifact.debug.schemaVersion !== REVIEW_HISTORY_SCHEMA_VERSION) {
    reasons.push("stored_schema_version_mismatch");
  }

  return reasons;
}

function getStoredArtifactGenerationReasons(
  lookup: StoredScenarioHistoryArtifactLookup,
  evidenceHash: string
) {
  const reasons = getStoredArtifactUsabilityReasons(lookup);

  if (lookup.artifact?.evidence_hash && lookup.artifact.evidence_hash !== evidenceHash) {
    reasons.push("stored_evidence_hash_mismatch");
  }

  return reasons.length > 0 ? reasons : ["stored_reuse_check_failed"];
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
    .select("artifact, created_at, updated_at")
    .eq("trainee_id", options.userId)
    .eq("scenario_id", options.scenarioId)
    .maybeSingle();

  if (storedError) {
    if (!isMissingScenarioHistoryArtifactsTable(storedError)) {
      throw new Error(storedError.message);
    }
    return {
      artifact: null,
      found: false,
      parsed: false,
      tableAvailable: false,
      rowCreatedAt: null,
      rowUpdatedAt: null,
      parseIssues: [],
    } satisfies StoredScenarioHistoryArtifactLookup;
  }

  if (!storedRow) {
    return {
      artifact: null,
      found: false,
      parsed: false,
      tableAvailable: true,
      rowCreatedAt: null,
      rowUpdatedAt: null,
      parseIssues: [],
    } satisfies StoredScenarioHistoryArtifactLookup;
  }

  const parsed = parseStoredScenarioHistoryArtifact(storedRow.artifact);
  return {
    artifact: parsed.artifact,
    found: true,
    parsed: Boolean(parsed.artifact),
    tableAvailable: true,
    rowCreatedAt: storedRow.created_at ?? null,
    rowUpdatedAt: storedRow.updated_at ?? null,
    parseIssues: parsed.parseIssues,
  } satisfies StoredScenarioHistoryArtifactLookup;
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
    reason?: string;
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

  logScenarioHistory("info", "invalidate.user_scenario", {
    userId: options.userId,
    scenarioId: options.scenarioId,
    reason: options.reason ?? "unspecified",
    tableAvailable: !error,
  });
}

export async function invalidateScenarioHistoryArtifactsForScenario(
  supabase: SupabaseClient,
  scenarioId: string,
  reason = "unspecified"
) {
  const { error } = await supabase
    .from("scenario_history_artifacts")
    .delete()
    .eq("scenario_id", scenarioId);

  if (error && !isMissingScenarioHistoryArtifactsTable(error)) {
    throw new Error(error.message);
  }

  logScenarioHistory("info", "invalidate.scenario", {
    scenarioId,
    reason,
    tableAvailable: !error,
  });
}

export async function ensureScenarioHistoryArtifact(
  options: EnsureScenarioHistoryArtifactOptions
) {
  const startedAt = Date.now();
  const persistClient = options.persistSupabase ?? options.authSupabase;
  const scenarioId = await resolveScenarioHistoryTarget(options);
  const logContext = buildScenarioHistoryLogContext(options, scenarioId);

  logScenarioHistory("info", "ensure.start", logContext);

  const storedLookup = await fetchStoredScenarioHistoryArtifact(persistClient, {
    userId: options.userId,
    scenarioId,
  });
  const stored = storedLookup.artifact;

  logScenarioHistory("info", "stored.lookup", {
    ...logContext,
    ...buildStoredArtifactLogDetails(storedLookup),
  });

  if (options.preferStored) {
    if (isStoredScenarioHistoryArtifactUsable(stored)) {
      logScenarioHistory("info", "ensure.return_stored_preferred", {
        ...logContext,
        durationMs: Date.now() - startedAt,
        ...buildStoredArtifactLogDetails(storedLookup),
      });
      return {
        scenarioId,
        artifact: stored,
        source: "stored" as const,
      };
    }

    logScenarioHistory("info", "ensure.preferred_storage_miss", {
      ...logContext,
      reasons: getStoredArtifactUsabilityReasons(storedLookup),
      ...buildStoredArtifactLogDetails(storedLookup),
    });
  }

  const context = await loadScenarioHistoryContext({
    ...options,
    scenarioId,
  });

  logScenarioHistory("info", "context.loaded", {
    ...logContext,
    totalSessionCount: context.totalSessionCount,
    startedSessionCount: context.sessions.length,
    latestSessionId: context.latestSessionId,
  });

  if (context.sessions.length === 0) {
    await invalidateScenarioHistoryArtifact(persistClient, {
      userId: options.userId,
      scenarioId: context.scenarioId,
      reason: "no_started_sessions",
    });

    logScenarioHistory("warn", "ensure.no_started_sessions", {
      ...logContext,
      durationMs: Date.now() - startedAt,
      totalSessionCount: context.totalSessionCount,
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
    logScenarioHistory("info", "ensure.return_stored_hash_match", {
      ...logContext,
      durationMs: Date.now() - startedAt,
      evidenceHash,
      ...buildStoredArtifactLogDetails(storedLookup),
    });
    return {
      scenarioId: context.scenarioId,
      artifact: stored,
      source: "stored" as const,
    };
  }

  const generationReasons = getStoredArtifactGenerationReasons(storedLookup, evidenceHash);
  logScenarioHistory("info", "generate.start", {
    ...logContext,
    evidenceHash,
    totalSessionCount: context.totalSessionCount,
    startedSessionCount: context.sessions.length,
    latestSessionId: context.latestSessionId,
    reasons: generationReasons,
    ...buildStoredArtifactLogDetails(storedLookup),
  });

  const generationStartedAt = Date.now();
  const generated = await generateScenarioHistoryCoachSummary({
    currentSessionId: context.latestSessionId ?? context.sessions[context.sessions.length - 1]?.id ?? context.sessions[0].id,
    totalSessionCount: context.totalSessionCount,
    sessions: context.sessions,
  });

  logScenarioHistory("info", "generate.finish", {
    ...logContext,
    durationMs: Date.now() - generationStartedAt,
    summaryPresent: Boolean(generated.summary),
    failureClass: generated.meta.failure_class,
    validatorFailures: generated.meta.validator_failures,
    promptVersion: generated.meta.prompt_version,
    schemaVersion: generated.meta.schema_version,
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
    logScenarioHistory("error", "persist.failed", {
      ...logContext,
      evidenceHash,
      summaryPresent: Boolean(artifact.summary),
    }, persistError);
    throw new Error(persistError.message);
  }

  if (persistError) {
    logScenarioHistory("warn", "persist.skipped_missing_table", {
      ...logContext,
      evidenceHash,
      summaryPresent: Boolean(artifact.summary),
    });
  } else {
    logScenarioHistory("info", "persist.success", {
      ...logContext,
      durationMs: Date.now() - startedAt,
      evidenceHash,
      generatedAt: artifact.generated_at,
      latestSessionId: artifact.latest_session_id,
      totalSessionCount: artifact.total_session_count,
      summaryPresent: Boolean(artifact.summary),
      debugOk: artifact.debug.ok,
    });
  }

  return {
    scenarioId: context.scenarioId,
    artifact,
    source: "generated" as const,
  };
}
