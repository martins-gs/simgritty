import { parseStoredReviewArtifacts, type ReviewEvidenceLedgerMoment, type StoredReviewArtifacts } from "@/lib/review/artifacts";
import { parseScenarioSnapshot } from "@/lib/validation/schemas";
import type { ScenarioTraits } from "@/types/scenario";
import {
  EDUCATOR_STAGE_LABELS,
  EDUCATOR_STAGE_ORDER,
  EDUCATOR_TEACHING_THEMES,
  EDUCATOR_THEME_LABELS,
  type EducatorAnalyticsDashboard,
  type EducatorAnalyticsFiltersApplied,
  type EducatorAnalyticsFiltersInput,
  type EducatorAnalyticsReport,
  type EducatorAnalyticsResponse,
  type EducatorAttemptView,
  type EducatorConversationStage,
  type EducatorEvidenceDrawer,
  type EducatorHeadlineCard,
  type EducatorPriorityLevel,
  type EducatorTeachingTheme,
  type EducatorTrend,
} from "@/lib/analytics/types";

interface AnalyticsSessionRow {
  id: string;
  scenario_id: string;
  trainee_id: string;
  trainee_label: string;
  org_id: string;
  status: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  exit_type: string | null;
  final_escalation_level: number | null;
  peak_escalation_level: number | null;
  scenario_snapshot: unknown;
  review_artifacts: unknown;
}

interface AnalyticsEvidenceRow {
  id: string;
  session_id: string;
  dimension: string;
  turn_index: number;
  evidence_type: string;
  evidence_data: Record<string, unknown>;
  score_impact: number;
  created_at: string;
}

interface NormalizedSession {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  traineeId: string;
  traineeLabel: string;
  createdAt: string;
  createdAtMs: number;
  exitType: string | null;
  finalEscalationLevel: number | null;
  peakEscalationLevel: number | null;
  attemptIndex: number;
  isRepeatAttempt: boolean;
  traits: ScenarioTraits | null;
  reviewArtifacts: StoredReviewArtifacts | null;
}

interface ThemeOccurrence {
  theme: EducatorTeachingTheme;
  sessionId: string;
  traineeId: string;
  scenarioTitle: string;
  attemptIndex: number;
  isRepeatAttempt: boolean;
  stage: EducatorConversationStage;
  impact: number;
  positive: boolean;
  moment: ReviewEvidenceLedgerMoment | null;
  betterAlternative: string | null;
  whyItMatters: string | null;
  traits: ScenarioTraits | null;
}

interface ThemeSummary {
  theme: EducatorTeachingTheme;
  label: string;
  affectedLearners: Set<string>;
  affectedSessions: Set<string>;
  impacts: number[];
  stages: Map<EducatorConversationStage, number>;
  scenarioLearnerCounts: Map<string, number>;
  scenarioCounts: Map<string, number>;
  behaviourCounts: Map<string, number>;
  examples: ThemeOccurrence[];
  firstAttemptSessions: Set<string>;
  repeatAttemptSessions: Set<string>;
  improvementDeltaPct: number | null;
  persistencePct: number | null;
  baselineDeltaPct: number | null;
  avgImpact: number;
  learnerPrevalencePct: number;
  sessionPrevalencePct: number;
  priorityScore: number;
  priorityLevel: EducatorPriorityLevel;
  trend: EducatorTrend;
}

const THEME_GUIDANCE: Record<
  EducatorTeachingTheme,
  {
    why: string;
    emphasise: string;
    drill: string;
    scenario_gap: string;
  }
> = {
  addressing_distress_early: {
    why: "If the learner steps past the emotion at the start, the other person often stays too activated to hear the practical answer.",
    emphasise: "Teach learners to acknowledge the emotion in the first line before moving into explanation or problem-solving.",
    drill: "Run a first-10-seconds drill where learners must name the worry or frustration before adding any facts.",
    scenario_gap: "If this cluster is concentrated in one scenario, add another case where the emotional temperature is high but the practical task differs.",
  },
  listening_and_attention: {
    why: "When learners do not show they have actually heard the question or concern, the conversation tends to circle rather than move forward.",
    emphasise: "Stress concise signposting that shows the learner has heard the exact question before answering it.",
    drill: "Use repeat-back micro-drills: hear a challenge once, name the concern in one line, then answer it.",
    scenario_gap: "If only one scenario exposes this, build a second case with repeated questioning or interruptions to test active listening under pressure.",
  },
  answering_the_core_concern: {
    why: "Vague or sideways replies leave the main pressure point untouched, so frustration often returns on the very next turn.",
    emphasise: "Teach an answer-or-check structure: answer directly if you can; if not, say exactly what you will check and by when.",
    drill: "Practise one-line direct answers to angry or worried questions before expanding with detail.",
    scenario_gap: "If this appears across many scenarios, reinforce it with short repeat attempts rather than writing niche new cases first.",
  },
  handling_uncertainty_clearly: {
    why: "Learners can sound evasive when they are unsure unless they state uncertainty, next steps, and timing plainly.",
    emphasise: "Model clear uncertainty language that still gives containment, ownership, and a time-bound next step.",
    drill: "Use uncertainty drills: 'I do not want to guess, so I am going to check X and come back by Y.'",
    scenario_gap: "Add scenarios where the safest move is a clear check-back plan rather than an immediate answer.",
  },
  maintaining_composure_under_pressure: {
    why: "Once pace, tone, or steadiness slips under pressure, even a reasonable message becomes harder to trust.",
    emphasise: "Keep the first line shorter, slower, and steadier when the other person escalates.",
    drill: "Run pressure-replay drills where the same line is practised twice: once rushed, once contained, then compare the effect.",
    scenario_gap: "If this is mostly triggered by high-hostility cases, add medium-pressure scenarios that let learners rehearse composure before the ceiling is reached.",
  },
  avoiding_defensive_or_self_focused_language: {
    why: "Defensive or self-focused phrasing is often heard as resistance, which can escalate the interaction even when the facts are correct.",
    emphasise: "Coach learners to avoid justifying themselves or their workload when the other person still needs one clear answer.",
    drill: "Swap defensive phrases for containing alternatives in rapid-fire response drills.",
    scenario_gap: "Use scenarios with explicit accusation or complaint language so learners can practise non-defensive alternatives on cue.",
  },
  giving_credible_reassurance: {
    why: "Reassurance only lands when it follows a believable explanation; otherwise it can sound dismissive or generic.",
    emphasise: "Teach learners to give the reason first, then the reassurance, then the next step.",
    drill: "Practise 'reason, reassurance, next step' in one breath for delay, discharge, and safety cases.",
    scenario_gap: "Where this is scenario-specific, add another case that needs credible reassurance without relying on discharge language.",
  },
  repairing_after_a_missed_moment: {
    why: "A missed turn is not fatal on its own, but failure to repair after it appears means the pressure tends to persist.",
    emphasise: "Help learners recognise when the first answer has not landed and how to make a cleaner second attempt.",
    drill: "Use repair drills where the learner must respond to 'That did not answer my question' with a shorter, clearer second turn.",
    scenario_gap: "Create scenarios that explicitly give learners a second chance after an initial miss so repair skills are visible in the data.",
  },
  boundary_setting_under_hostility_or_microaggression: {
    why: "High-hostility or discriminatory remarks require calm limits; without them, the learner either absorbs harm or mirrors it back.",
    emphasise: "Teach short boundary lines that stay calm, protect staff dignity, and redirect to the task.",
    drill: "Practise boundary scripts after hostile or discriminatory remarks, followed by a clear return to the immediate issue.",
    scenario_gap: "If discriminatory pressure is rare in the current bank, add purpose-built scenarios rather than expecting generic cases to teach this skill well.",
  },
  seeking_support_appropriately: {
    why: "Delayed support-seeking leaves learners trying to contain situations that have already crossed the safety threshold.",
    emphasise: "Clarify the point where the task changes from solo repair to containment and escalation for support.",
    drill: "Use threshold drills where learners must decide whether to continue alone, set a limit, or bring in help.",
    scenario_gap: "If support judgement only appears in extreme cases, add middle-range scenarios where the threshold decision is less obvious.",
  },
};

const HOSTILITY_PATTERN =
  /\b(bloody|disgrace|ridiculous|useless|liar|shut up|clueless|fed up|complain|complaint|don't talk down|dont talk down|what the hell)\b/i;
const DISTRESS_PATTERN =
  /\b(worried|worry|upset|frightened|scared|anxious|distressed|overwhelmed|angry|frustrated|frustration|tearful|crying)\b/i;
const DISCRIMINATION_PATTERN =
  /\b(where are you really from|people like you|your type|go back|foreign|accent|racist|because you are|because you're|because youre)\b/i;
const REPEATED_CHALLENGE_PATTERN =
  /\b(repeated question|same question|still waiting|again|you still haven't|you still havent|you have not answered|you haven't answered)\b/i;

const FALLBACK_IMPACT_BY_EVIDENCE: Record<string, number> = {
  critical_no_support: 30,
  support_not_requested: 24,
  de_escalation_harm: 18,
  low_substance_response: 12,
  composure_marker: 10,
  support_invoked: 10,
  delivery_marker: 8,
  de_escalation_attempt: 7,
  milestone_completed: 6,
};

function normaliseText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function roundPct(value: number) {
  return Math.max(0, Math.round(value));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function truncateSentence(value: string | null | undefined, fallback = "No transcript snippet available.") {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  if (!trimmed) return fallback;
  return trimmed.length > 200 ? `${trimmed.slice(0, 199).trimEnd()}…` : trimmed;
}

function getMomentKey(turnIndex: number, evidenceType: string) {
  return `${turnIndex}:${normaliseText(evidenceType).replace(/\s+/g, "_")}`;
}

function getScenarioTitle(session: AnalyticsSessionRow) {
  const snapshot = parseScenarioSnapshot(session.scenario_snapshot);
  return snapshot.title?.trim() || "Untitled scenario";
}

function getScenarioTraits(session: AnalyticsSessionRow) {
  const snapshot = parseScenarioSnapshot(session.scenario_snapshot);
  return snapshot.scenario_traits[0] ?? null;
}

function normaliseSessions(rows: AnalyticsSessionRow[]) {
  const byLearnerScenario = new Map<string, NormalizedSession[]>();
  const normalized = rows.map<NormalizedSession>((row) => {
    const reviewArtifacts = parseStoredReviewArtifacts(row.review_artifacts);
    const createdAtMs = Date.parse(row.created_at);
    return {
      id: row.id,
      scenarioId: row.scenario_id,
      scenarioTitle: getScenarioTitle(row),
      traineeId: row.trainee_id,
      traineeLabel: row.trainee_label,
      createdAt: row.created_at,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
      exitType: row.exit_type,
      finalEscalationLevel: row.final_escalation_level,
      peakEscalationLevel: row.peak_escalation_level,
      attemptIndex: 1,
      isRepeatAttempt: false,
      traits: getScenarioTraits(row),
      reviewArtifacts,
    };
  });

  for (const session of normalized) {
    const key = `${session.traineeId}:${session.scenarioId}`;
    const group = byLearnerScenario.get(key) ?? [];
    group.push(session);
    byLearnerScenario.set(key, group);
  }

  for (const sessions of byLearnerScenario.values()) {
    sessions.sort((a, b) => a.createdAtMs - b.createdAtMs);
    sessions.forEach((session, index) => {
      session.attemptIndex = index + 1;
      session.isRepeatAttempt = index > 0;
    });
  }

  return normalized.sort((a, b) => a.createdAtMs - b.createdAtMs);
}

function matchesFilters(session: NormalizedSession, filters: EducatorAnalyticsFiltersInput) {
  if (filters.trainee_id && session.traineeId !== filters.trainee_id) return false;
  if (filters.scenario_id && session.scenarioId !== filters.scenario_id) return false;
  if (filters.attempt_view === "first" && session.isRepeatAttempt) return false;
  if (filters.attempt_view === "repeat" && !session.isRepeatAttempt) return false;
  if (filters.date_from && session.createdAt.slice(0, 10) < filters.date_from) return false;
  if (filters.date_to && session.createdAt.slice(0, 10) > filters.date_to) return false;
  return true;
}

function matchesFiltersWithoutAttempt(session: NormalizedSession, filters: EducatorAnalyticsFiltersInput) {
  return matchesFilters(session, { ...filters, attempt_view: "all" });
}

function detectBoundaryRisk(traits: ScenarioTraits | null) {
  if (!traits) return false;
  return traits.bias_intensity >= 4 || traits.boundary_respect <= 3 || traits.hostility >= 7;
}

function getMomentText(moment: ReviewEvidenceLedgerMoment | null, evidence: AnalyticsEvidenceRow | null) {
  const evidenceText = evidence
    ? [
        evidence.evidence_type,
        ...Object.entries((evidence.evidence_data ?? {}) as Record<string, unknown>).flatMap(([key, value]) => {
          if (value == null) return [];
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            return [`${key} ${String(value)}`];
          }
          if (Array.isArray(value)) {
            return value.map((item) => `${key} ${String(item)}`);
          }
          return [];
        }),
      ].join(" ")
    : "";

  return normaliseText([
    evidenceText,
    moment?.active_need_or_barrier,
    moment?.what_partly_landed,
    moment?.what_was_missing,
    moment?.why_it_mattered_reason,
    moment?.observed_consequence,
    moment?.next_best_move,
    moment?.previous_turn?.content,
    moment?.focus_turn?.content,
    moment?.next_turn?.content,
  ].filter(Boolean).join(" "));
}

function hasMarker(evidence: AnalyticsEvidenceRow | null, markers: string[]) {
  const values = Array.isArray((evidence?.evidence_data as Record<string, unknown> | undefined)?.markers)
    ? ((evidence?.evidence_data as Record<string, unknown>).markers as unknown[])
    : [];
  return values.some((value) => typeof value === "string" && markers.includes(value));
}

function mapEvidenceToTheme(
  session: NormalizedSession,
  evidence: AnalyticsEvidenceRow | null,
  moment: ReviewEvidenceLedgerMoment | null
): EducatorTeachingTheme {
  const evidenceType = evidence?.evidence_type ?? normaliseText(moment?.evidence_type).replace(/\s+/g, "_");
  const text = getMomentText(moment, evidence);
  const previousTurn = moment?.previous_turn?.content ?? "";
  const boundaryRisk = detectBoundaryRisk(session.traits);
  const uncertaintySignal =
    /\b(next step|what happens next|what will happen|check and|come back|find out|update|not sure|uncertain|by when)\b/i.test(text);
  const reassuranceSignal =
    /\b(reassur|specificity before reassurance|delay|blocker|go home|reason for the delay|could not go home yet)\b/i.test(text);
  const distressSignal =
    DISTRESS_PATTERN.test(previousTurn) || /\b(frustration|emotion|acknowledgement|acknowledge|worry)\b/i.test(text);
  const repeatedChallengeSignal =
    REPEATED_CHALLENGE_PATTERN.test(text) || /\b(repeated question|direct question|still not clear|did not answer the question)\b/i.test(text);
  const defensiveSignal =
    hasMarker(evidence, ["defensive_tone", "sarcastic_tone", "irritated_tone", "hostile_tone"]) ||
    /\b(defensive|self focused|self-focused|my workload|i already told|i already said|listen to me|you need to calm)\b/i.test(text);

  if (evidenceType === "support_not_requested" || evidenceType === "critical_no_support" || evidenceType === "support_invoked") {
    return "seeking_support_appropriately";
  }

  if (boundaryRisk && (DISCRIMINATION_PATTERN.test(previousTurn) || HOSTILITY_PATTERN.test(previousTurn) || /microaggression|discriminatory|boundary/i.test(text))) {
    return "boundary_setting_under_hostility_or_microaggression";
  }

  if (defensiveSignal) {
    return "avoiding_defensive_or_self_focused_language";
  }

  if (evidenceType === "de_escalation_attempt" && !((evidence?.evidence_data as Record<string, unknown> | undefined)?.effective === true)) {
    return "repairing_after_a_missed_moment";
  }

  if (uncertaintySignal) {
    return "handling_uncertainty_clearly";
  }

  if (reassuranceSignal) {
    return "giving_credible_reassurance";
  }

  if (distressSignal && (evidenceType === "de_escalation_harm" || evidenceType === "low_substance_response" || /acknowledge|frustration|emotion/i.test(text))) {
    return "addressing_distress_early";
  }

  if (
    repeatedChallengeSignal ||
    evidenceType === "low_substance_response" && /\b(question|listen|heard|repeated)\b/i.test(text) ||
    hasMarker(evidence, ["interruption"])
  ) {
    return "listening_and_attention";
  }

  if (
    evidenceType === "composure_marker" ||
    evidenceType === "delivery_marker" ||
    hasMarker(evidence, ["tense_hurried", "flat_detached", "anxious_unsteady"])
  ) {
    return "maintaining_composure_under_pressure";
  }

  return "answering_the_core_concern";
}

function detectStage(
  session: NormalizedSession,
  evidence: AnalyticsEvidenceRow | null,
  moment: ReviewEvidenceLedgerMoment | null
): EducatorConversationStage {
  const turnIndex = evidence?.turn_index ?? moment?.turn_index ?? 0;
  const turnCount = session.reviewArtifacts?.ledger.outcome_state.turn_count ?? 0;
  const previousTurn = moment?.previous_turn?.content ?? "";
  const text = getMomentText(moment, evidence);

  if ((evidence?.evidence_type ?? "").toLowerCase() === "de_escalation_attempt") {
    return "repair_attempt";
  }

  if (DISCRIMINATION_PATTERN.test(previousTurn) && detectBoundaryRisk(session.traits)) {
    return "after_explicit_discriminatory_remark";
  }

  if (HOSTILITY_PATTERN.test(previousTurn)) {
    return "after_direct_hostility";
  }

  if (REPEATED_CHALLENGE_PATTERN.test(text)) {
    return "after_repeated_challenge";
  }

  if (turnIndex <= 1) {
    return "opening";
  }

  if (turnCount > 0 && turnIndex >= Math.max(2, turnCount - 1)) {
    return "close";
  }

  return "first_substantive_response";
}

function buildFallbackBehaviour(moment: ReviewEvidenceLedgerMoment | null) {
  const candidate = moment?.what_was_missing ?? moment?.headline_hint ?? moment?.active_need_or_barrier ?? null;
  const trimmed = candidate?.replace(/\s+/g, " ").trim();
  if (!trimmed) return "The reply stayed too broad for the pressure point in the conversation.";
  return trimmed.length > 120 ? `${trimmed.slice(0, 119).trimEnd()}…` : trimmed;
}

function buildOccurrence(
  session: NormalizedSession,
  evidence: AnalyticsEvidenceRow | null,
  moment: ReviewEvidenceLedgerMoment | null,
  positive: boolean,
  fallbackImpact?: number
): ThemeOccurrence {
  const theme = mapEvidenceToTheme(session, evidence, moment);
  const impactBase = evidence ? Math.abs(evidence.score_impact) : Math.abs(fallbackImpact ?? 0);
  const outcomeModifier =
    session.exitType === "instant_exit" || session.exitType === "educator_ended"
      ? 6
      : session.finalEscalationLevel != null && session.finalEscalationLevel >= 8
        ? 4
        : session.finalEscalationLevel != null && session.finalEscalationLevel >= 5
          ? 2
          : 0;

  return {
    theme,
    sessionId: session.id,
    traineeId: session.traineeId,
    scenarioTitle: session.scenarioTitle,
    attemptIndex: session.attemptIndex,
    isRepeatAttempt: session.isRepeatAttempt,
    stage: detectStage(session, evidence, moment),
    impact: Math.max(1, Math.round(impactBase + (positive ? 0 : outcomeModifier))),
    positive,
    moment,
    betterAlternative: moment?.next_best_move ?? THEME_GUIDANCE[theme].emphasise,
    whyItMatters: moment?.why_it_mattered_reason ?? null,
    traits: session.traits,
  };
}

function isPositiveEvidence(evidence: AnalyticsEvidenceRow) {
  if (evidence.score_impact > 0) return true;
  if (evidence.evidence_type === "milestone_completed") return true;
  if (evidence.evidence_type === "support_invoked") {
    return (evidence.evidence_data as Record<string, unknown> | undefined)?.appropriate === true;
  }
  if (evidence.evidence_type === "de_escalation_attempt") {
    return (evidence.evidence_data as Record<string, unknown> | undefined)?.effective === true;
  }
  return false;
}

function buildOccurrences(
  sessions: NormalizedSession[],
  evidenceRows: AnalyticsEvidenceRow[]
) {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const momentMaps = new Map<string, Map<string, ReviewEvidenceLedgerMoment>>();

  for (const session of sessions) {
    const moments = session.reviewArtifacts?.ledger.moments ?? [];
    const map = new Map<string, ReviewEvidenceLedgerMoment>();
    for (const moment of moments) {
      map.set(getMomentKey(moment.turn_index, moment.evidence_type), moment);
    }
    momentMaps.set(session.id, map);
  }

  const matchedMomentKeys = new Set<string>();
  const negative: ThemeOccurrence[] = [];
  const positive: ThemeOccurrence[] = [];

  for (const evidence of evidenceRows) {
    const session = sessionMap.get(evidence.session_id);
    if (!session) continue;

    const moment = momentMaps
      .get(session.id)
      ?.get(getMomentKey(evidence.turn_index, evidence.evidence_type)) ?? null;
    if (moment) {
      matchedMomentKeys.add(`${session.id}:${getMomentKey(evidence.turn_index, evidence.evidence_type)}`);
    }

    const occurrence = buildOccurrence(session, evidence, moment, isPositiveEvidence(evidence));
    if (occurrence.positive) {
      positive.push(occurrence);
    } else {
      negative.push(occurrence);
    }
  }

  for (const session of sessions) {
    const moments = session.reviewArtifacts?.ledger.moments ?? [];
    for (const moment of moments) {
      const key = `${session.id}:${getMomentKey(moment.turn_index, moment.evidence_type)}`;
      if (matchedMomentKeys.has(key)) continue;

      const evidenceType = normaliseText(moment.evidence_type).replace(/\s+/g, "_");
      const fallbackImpact = FALLBACK_IMPACT_BY_EVIDENCE[evidenceType] ?? 8;
      const occurrence = buildOccurrence(session, null, moment, moment.positive, fallbackImpact);
      if (occurrence.positive) {
        positive.push(occurrence);
      } else {
        negative.push(occurrence);
      }
    }
  }

  return { negative, positive };
}

function getTopMapEntries(map: Map<string, number>, limit: number) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function describeImpact(avgImpact: number) {
  if (avgImpact >= 22) return "very high";
  if (avgImpact >= 15) return "high";
  if (avgImpact >= 9) return "moderate";
  return "low";
}

function describePriority(priorityScore: number): EducatorPriorityLevel {
  if (priorityScore >= 68) return "high";
  if (priorityScore >= 42) return "medium";
  return "low";
}

function buildBehaviourCounts(occurrences: ThemeOccurrence[]) {
  const counts = new Map<string, number>();
  for (const occurrence of occurrences) {
    const behaviour = buildFallbackBehaviour(occurrence.moment);
    counts.set(behaviour, (counts.get(behaviour) ?? 0) + 1);
  }
  return counts;
}

function selectExamples(occurrences: ThemeOccurrence[], limit: number) {
  const picked: ThemeOccurrence[] = [];
  const usedScenarios = new Set<string>();

  for (const occurrence of [...occurrences].sort((a, b) => b.impact - a.impact)) {
    if (picked.length >= limit) break;
    if (usedScenarios.has(occurrence.scenarioTitle) && picked.length + 1 < limit) {
      continue;
    }
    picked.push(occurrence);
    usedScenarios.add(occurrence.scenarioTitle);
  }

  for (const occurrence of occurrences) {
    if (picked.length >= limit) break;
    if (picked.includes(occurrence)) continue;
    picked.push(occurrence);
  }

  return picked.slice(0, limit);
}

function computePersistence(
  theme: EducatorTeachingTheme,
  sessions: NormalizedSession[],
  occurrences: ThemeOccurrence[]
) {
  const themeSessions = new Set(occurrences.filter((item) => item.theme === theme).map((item) => item.sessionId));
  const groups = new Map<string, NormalizedSession[]>();

  for (const session of sessions) {
    const key = `${session.traineeId}:${session.scenarioId}`;
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }

  let denominator = 0;
  let persistent = 0;

  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.attemptIndex - b.attemptIndex);
    if (sorted.length < 2) continue;

    const firstWithThemeIndex = sorted.findIndex((session) => themeSessions.has(session.id));
    if (firstWithThemeIndex < 0 || firstWithThemeIndex === sorted.length - 1) continue;

    denominator += 1;
    const persisted = sorted.slice(firstWithThemeIndex + 1).some((session) => themeSessions.has(session.id));
    if (persisted) {
      persistent += 1;
    }
  }

  if (denominator === 0) return null;
  return (persistent / denominator) * 100;
}

function computeAttemptDelta(
  theme: EducatorTeachingTheme,
  firstAttemptSessions: NormalizedSession[],
  repeatSessions: NormalizedSession[],
  occurrences: ThemeOccurrence[]
) {
  if (firstAttemptSessions.length === 0 || repeatSessions.length === 0) return null;
  const themedSessions = new Set(occurrences.filter((item) => item.theme === theme).map((item) => item.sessionId));
  const firstRate =
    firstAttemptSessions.filter((session) => themedSessions.has(session.id)).length / firstAttemptSessions.length;
  const repeatRate =
    repeatSessions.filter((session) => themedSessions.has(session.id)).length / repeatSessions.length;
  return (firstRate - repeatRate) * 100;
}

function computeBaselineDelta(
  theme: EducatorTeachingTheme,
  selectedSessions: NormalizedSession[],
  baselineSessions: NormalizedSession[],
  occurrences: ThemeOccurrence[]
) {
  if (selectedSessions.length === 0 || baselineSessions.length === 0) return null;
  const themedSessions = new Set(occurrences.filter((item) => item.theme === theme).map((item) => item.sessionId));
  const selectedRate =
    selectedSessions.filter((session) => themedSessions.has(session.id)).length / selectedSessions.length;
  const baselineRate =
    baselineSessions.filter((session) => themedSessions.has(session.id)).length / baselineSessions.length;
  return (selectedRate - baselineRate) * 100;
}

function computeThemeSummary(
  theme: EducatorTeachingTheme,
  selectedSessions: NormalizedSession[],
  baselineSessions: NormalizedSession[],
  allNegativeOccurrences: ThemeOccurrence[]
) {
  const selectedSessionIds = new Set(selectedSessions.map((session) => session.id));
  const themeOccurrences = allNegativeOccurrences.filter((occurrence) => (
    occurrence.theme === theme && selectedSessionIds.has(occurrence.sessionId)
  ));
  const affectedLearners = new Set(themeOccurrences.map((occurrence) => occurrence.traineeId));
  const affectedSessions = new Set(themeOccurrences.map((occurrence) => occurrence.sessionId));
  const stages = new Map<EducatorConversationStage, number>();
  const scenarioLearnerSets = new Map<string, Set<string>>();
  const scenarioSessionSets = new Map<string, Set<string>>();

  for (const occurrence of themeOccurrences) {
    stages.set(occurrence.stage, (stages.get(occurrence.stage) ?? 0) + 1);
    const scenarioLearners = scenarioLearnerSets.get(occurrence.scenarioTitle) ?? new Set<string>();
    scenarioLearners.add(occurrence.traineeId);
    scenarioLearnerSets.set(occurrence.scenarioTitle, scenarioLearners);
    const scenarioSessions = scenarioSessionSets.get(occurrence.scenarioTitle) ?? new Set<string>();
    scenarioSessions.add(occurrence.sessionId);
    scenarioSessionSets.set(occurrence.scenarioTitle, scenarioSessions);
  }

  const scenarioLearnerCounts = new Map(
    [...scenarioLearnerSets.entries()].map(([scenarioTitle, learnerIds]) => [scenarioTitle, learnerIds.size])
  );
  const scenarioCounts = new Map(
    [...scenarioSessionSets.entries()].map(([scenarioTitle, sessionIds]) => [scenarioTitle, sessionIds.size])
  );

  const avgImpact = average(themeOccurrences.map((occurrence) => occurrence.impact));
  const learnerCount = new Set(selectedSessions.map((session) => session.traineeId)).size;
  const learnerPrevalencePct =
    learnerCount === 0 ? 0 : (affectedLearners.size / learnerCount) * 100;
  const sessionPrevalencePct =
    selectedSessions.length === 0 ? 0 : (affectedSessions.size / selectedSessions.length) * 100;
  const firstAttemptSessions = selectedSessions.filter((session) => !session.isRepeatAttempt);
  const repeatSessions = selectedSessions.filter((session) => session.isRepeatAttempt);
  const improvementDeltaPct = computeAttemptDelta(theme, firstAttemptSessions, repeatSessions, allNegativeOccurrences);
  const persistencePct = computePersistence(theme, selectedSessions, allNegativeOccurrences);
  const baselineDeltaPct = computeBaselineDelta(theme, selectedSessions, baselineSessions, allNegativeOccurrences);
  const impactScore = Math.min(100, avgImpact * 4.5);
  const persistenceScore = persistencePct ?? 0;
  const baselineScore = baselineDeltaPct != null ? Math.max(0, baselineDeltaPct) : 0;
  const priorityScore =
    learnerPrevalencePct * 0.45 +
    impactScore * 0.35 +
    persistenceScore * 0.2 +
    baselineScore * 0.1;
  const priorityLevel = describePriority(priorityScore);
  const trend: EducatorTrend =
    improvementDeltaPct == null
      ? "static"
      : improvementDeltaPct >= 8
        ? "improving"
        : improvementDeltaPct <= -4
          ? "worsening"
          : "static";

  return {
    theme,
    label: EDUCATOR_THEME_LABELS[theme],
    affectedLearners,
    affectedSessions,
    impacts: themeOccurrences.map((occurrence) => occurrence.impact),
    stages,
    scenarioLearnerCounts,
    scenarioCounts,
    behaviourCounts: buildBehaviourCounts(themeOccurrences),
    examples: selectExamples(themeOccurrences, 3),
    firstAttemptSessions: new Set(firstAttemptSessions.map((session) => session.id)),
    repeatAttemptSessions: new Set(repeatSessions.map((session) => session.id)),
    improvementDeltaPct,
    persistencePct,
    baselineDeltaPct,
    avgImpact,
    learnerPrevalencePct,
    sessionPrevalencePct,
    priorityScore,
    priorityLevel,
    trend,
  } satisfies ThemeSummary;
}

function buildFiltersApplied(
  filters: EducatorAnalyticsFiltersInput,
  sessions: NormalizedSession[],
  siteProgrammeLabel: string | null
): EducatorAnalyticsFiltersApplied {
  const scenario = filters.scenario_id
    ? sessions.find((session) => session.scenarioId === filters.scenario_id)?.scenarioTitle ?? null
    : null;
  const dateRange =
    filters.date_from || filters.date_to
      ? `${filters.date_from ?? "start"} to ${filters.date_to ?? "now"}`
      : null;

  return {
    profession_grade: null,
    scenario,
    date_range: dateRange,
    first_attempt_vs_repeat_attempts: filters.attempt_view,
    site_programme: siteProgrammeLabel,
    educator_facilitator: null,
  };
}

function buildComparisonLabel(filters: EducatorAnalyticsFiltersInput, baselineSessions: NormalizedSession[]) {
  if (baselineSessions.length === 0) {
    return "No separate comparison group applied";
  }

  if (filters.attempt_view === "first") {
    return "Repeat attempts in the same filtered group";
  }

  if (filters.attempt_view === "repeat") {
    return "First attempts in the same filtered group";
  }

  if (filters.trainee_id) {
    return "Other analysable sessions in the organisation";
  }

  return "Other analysable sessions in the organisation";
}

function buildPopulationSummary(
  sessions: NormalizedSession[],
  comparisonGroup: string
): EducatorAnalyticsReport["population_summary"] {
  const learnerIds = new Set(sessions.map((session) => session.traineeId));
  const scenarioIds = new Set(sessions.map((session) => session.scenarioId));
  const attemptsPerLearner = [...learnerIds].map((learnerId) => (
    sessions.filter((session) => session.traineeId === learnerId).length
  ));

  return {
    learners: learnerIds.size,
    sessions: sessions.length,
    scenarios: scenarioIds.size,
    avg_attempts_per_learner: Number(average(attemptsPerLearner).toFixed(1)),
    comparison_group: comparisonGroup,
  };
}

function getMostCommonStage(summary: ThemeSummary) {
  return EDUCATOR_STAGE_LABELS[
    [...summary.stages.entries()]
      .sort((a, b) => b[1] - a[1] || EDUCATOR_STAGE_ORDER.indexOf(a[0]) - EDUCATOR_STAGE_ORDER.indexOf(b[0]))[0]?.[0] ??
      "first_substantive_response"
  ];
}

function formatScenarioList(summary: ThemeSummary, selectedSessions: NormalizedSession[]) {
  return [...summary.scenarioCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([scenario, count]) => {
      const totalScenarioSessions = selectedSessions.filter((session) => session.scenarioTitle === scenario).length;
      const prevalence = totalScenarioSessions === 0 ? 0 : roundPct((count / totalScenarioSessions) * 100);
      return `${scenario} (${prevalence}% of analysed sessions)`;
    });
}

function describeBaselineDelta(summary: ThemeSummary, comparisonGroup: string) {
  if (summary.baselineDeltaPct == null) {
    return "No separate comparison group was applied for this view.";
  }

  const delta = Number(summary.baselineDeltaPct.toFixed(1));
  if (Math.abs(delta) < 2) {
    return `About the same prevalence as ${comparisonGroup.toLowerCase()}.`;
  }

  return delta > 0
    ? `${Math.round(delta)} percentage points more common than ${comparisonGroup.toLowerCase()}.`
    : `${Math.round(Math.abs(delta))} percentage points less common than ${comparisonGroup.toLowerCase()}.`;
}

function describePersistence(summary: ThemeSummary) {
  if (summary.persistencePct == null) {
    return "Not enough repeat-attempt data yet to judge persistence.";
  }

  const persistence = roundPct(summary.persistencePct);
  if (persistence >= 60) {
    return `Persistent on repeat attempts: it stayed visible in ${persistence}% of learner-scenario repeats once it had appeared.`;
  }
  if (persistence >= 35) {
    return `Partly persistent on repeat attempts: it stayed visible in ${persistence}% of learner-scenario repeats once it had appeared.`;
  }
  return `Often improved on repeat attempts: it only stayed visible in ${persistence}% of learner-scenario repeats once it had appeared.`;
}

function buildFutureScenarioGap(summary: ThemeSummary) {
  const topScenario = [...summary.scenarioCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!topScenario) return THEME_GUIDANCE[summary.theme].scenario_gap;

  const [scenario, count] = topScenario;
  const total = summary.affectedSessions.size || 1;
  if (count / total >= 0.6) {
    return `${scenario} is carrying much of the signal for this theme. Build at least one more scenario that tests the same skill under a different pressure pattern.`;
  }

  return THEME_GUIDANCE[summary.theme].scenario_gap;
}

function buildTopStruggleAreas(
  topThemes: ThemeSummary[],
  selectedSessions: NormalizedSession[],
  comparisonGroup: string
) {
  return topThemes.map((summary, index) => ({
    theme: summary.theme,
    priority_rank: index + 1,
    priority_level: summary.priorityLevel,
    why_this_matters: THEME_GUIDANCE[summary.theme].why,
    learner_prevalence_pct: roundPct(summary.learnerPrevalencePct),
    session_prevalence_pct: roundPct(summary.sessionPrevalencePct),
    avg_impact_summary: `Average impact: ${describeImpact(summary.avgImpact)}. These moments typically cost about ${Math.round(summary.avgImpact)} score points and often disrupted the next turn.`,
    repeat_persistence_summary: describePersistence(summary),
    most_common_conversation_stage: getMostCommonStage(summary),
    most_affected_scenarios: formatScenarioList(summary, selectedSessions),
    baseline_delta_summary: describeBaselineDelta(summary, comparisonGroup),
    typical_behaviours_seen: getTopMapEntries(summary.behaviourCounts, 3),
    representative_evidence: summary.examples.map((example) => ({
      scenario: example.scenarioTitle,
      before: truncateSentence(example.moment?.previous_turn?.content),
      learner_turn: truncateSentence(example.moment?.focus_turn?.content),
      after: truncateSentence(example.moment?.next_turn?.content),
      why_it_counts_as_this_theme: truncateSentence(example.whyItMatters ?? THEME_GUIDANCE[summary.theme].why),
    })),
    what_to_emphasise_in_class: THEME_GUIDANCE[summary.theme].emphasise,
    suggested_practice_drill: THEME_GUIDANCE[summary.theme].drill,
    future_scenario_gap: buildFutureScenarioGap(summary),
  }));
}

function buildCrossCuttingPatterns(topThemes: ThemeSummary[], negativeOccurrences: ThemeOccurrence[]) {
  const stageCounts = new Map<EducatorConversationStage, number>();
  for (const occurrence of negativeOccurrences) {
    stageCounts.set(occurrence.stage, (stageCounts.get(occurrence.stage) ?? 0) + 1);
  }

  const topStage = [...stageCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const patterns: string[] = [];

  if (topStage === "first_substantive_response" || topStage === "opening") {
    patterns.push("A large share of breakdowns is happening in the first substantive learner reply, so short opening-line drills should pay off quickly.");
  }

  if (topThemes.some((theme) => theme.theme === "answering_the_core_concern") && topThemes.some((theme) => theme.theme === "giving_credible_reassurance")) {
    patterns.push("Learners are often trying to reassure, but the explanation is not yet concrete enough for the reassurance to feel believable.");
  }

  if (topThemes.some((theme) => theme.theme === "maintaining_composure_under_pressure") || topThemes.some((theme) => theme.theme === "avoiding_defensive_or_self_focused_language")) {
    patterns.push("When pressure rises, delivery quality and wording are interacting: once tone tightens, a technically correct answer often still lands badly.");
  }

  return patterns;
}

function buildStrengthsToBuildOn(
  positiveOccurrences: ThemeOccurrence[],
  selectedSessions: NormalizedSession[]
) {
  const learnerCount = new Set(selectedSessions.map((session) => session.traineeId)).size || 1;
  const counts = new Map<EducatorTeachingTheme, Set<string>>();

  for (const occurrence of positiveOccurrences) {
    const set = counts.get(occurrence.theme) ?? new Set<string>();
    set.add(occurrence.traineeId);
    counts.set(occurrence.theme, set);
  }

  return [...counts.entries()]
    .map(([theme, learners]) => ({
      theme,
      prevalence: (learners.size / learnerCount) * 100,
    }))
    .sort((a, b) => b.prevalence - a.prevalence)
    .slice(0, 3)
    .map(({ theme, prevalence }) => `${roundPct(prevalence)}% of learners showed at least one example of ${EDUCATOR_THEME_LABELS[theme].toLowerCase()}, which gives you something concrete to reinforce in debrief.`);
}

function buildScenarioDesignIssues(sessions: NormalizedSession[]) {
  const byScenario = new Map<string, NormalizedSession[]>();
  for (const session of sessions) {
    const group = byScenario.get(session.scenarioTitle) ?? [];
    group.push(session);
    byScenario.set(session.scenarioTitle, group);
  }

  const issues: string[] = [];

  for (const [scenario, scenarioSessions] of byScenario.entries()) {
    if (scenarioSessions.length < 3) continue;

    const acceptableButNegative = scenarioSessions.filter((session) => {
      const ledger = session.reviewArtifacts?.ledger;
      if (!ledger) return false;

      const acceptableResponse =
        (ledger.outcome_state.overall_score ?? 0) >= 60 ||
        ledger.moments.filter((moment) => moment.positive).length >= ledger.moments.filter((moment) => !moment.positive).length;
      const negativeOutcome =
        ledger.pattern_ledger.session_outcome === "tense" ||
        ledger.pattern_ledger.session_outcome === "highly_strained" ||
        ledger.pattern_ledger.session_outcome === "ended_early";
      return acceptableResponse && negativeOutcome;
    });

    if (acceptableButNegative.length / scenarioSessions.length >= 0.4) {
      issues.push(`${scenario}: several learners produced at least partly acceptable responses, but the scenario still often ended badly. Review the scenario logic or outcome thresholds before treating this as a pure learner deficit.`);
    }
  }

  return issues;
}

function buildDataQualityFlags(allSessions: NormalizedSession[], selectedSessions: NormalizedSession[]) {
  const flags: string[] = [];
  const missingReviewArtifacts = allSessions.filter((session) => !session.reviewArtifacts).length;
  if (missingReviewArtifacts > 0) {
    flags.push(`${missingReviewArtifacts} session${missingReviewArtifacts === 1 ? "" : "s"} could not be included because review artefacts were missing or unparsable.`);
  }

  if (selectedSessions.length < 3) {
    flags.push("This view is based on fewer than 3 analysable sessions, so treat patterns as tentative rather than cohort-level conclusions.");
  }

  const weakAudioCoverage = selectedSessions.filter((session) => !session.reviewArtifacts?.ledger.delivery_aggregate.supported).length;
  if (selectedSessions.length > 0 && weakAudioCoverage / selectedSessions.length >= 0.5) {
    flags.push("Session-level audio evidence was weak or unsupported in many sessions, so delivery-based interpretations should be treated cautiously.");
  }

  return flags;
}

function buildEducatorTakeaways(topThemes: ThemeSummary[]) {
  const top3 = topThemes.slice(0, 3);
  const microDrills = top3
    .filter((theme) => theme.theme !== "boundary_setting_under_hostility_or_microaggression")
    .map((theme) => THEME_GUIDANCE[theme.theme].drill)
    .slice(0, 3);
  const newScenarios = topThemes
    .filter((theme) => theme.theme === "boundary_setting_under_hostility_or_microaggression" || theme.theme === "handling_uncertainty_clearly" || theme.theme === "seeking_support_appropriately")
    .map((theme) => buildFutureScenarioGap(theme))
    .slice(0, 3);

  return {
    top_3_teaching_priorities: top3.map((theme) => THEME_GUIDANCE[theme.theme].emphasise),
    skills_to_reinforce_with_micro_drills: microDrills,
    skills_better_taught_with_new_scenarios: newScenarios,
    recommended_debrief_focus: top3.length === 0
      ? "No clear debrief focus yet because there are not enough analysable sessions."
      : `Start with ${top3.map((theme) => EDUCATOR_THEME_LABELS[theme.theme].toLowerCase()).join(", ")}, and anchor the discussion in short before/after examples rather than broad score talk.`,
  };
}

function buildHeadlineCard(
  title: string,
  theme: ThemeSummary | null,
  summary: string
): EducatorHeadlineCard {
  return {
    title,
    theme: theme?.theme ?? null,
    label: theme?.label ?? null,
    summary,
  };
}

function buildDashboard(
  topThemes: ThemeSummary[],
  selectedSessions: NormalizedSession[],
  allThemeSummaries: ThemeSummary[],
  selectedNegativeOccurrences: ThemeOccurrence[]
): EducatorAnalyticsDashboard {
  const mostWidespread = [...allThemeSummaries].sort((a, b) => b.learnerPrevalencePct - a.learnerPrevalencePct)[0] ?? null;
  const mostHarmful = [...allThemeSummaries].sort((a, b) => b.avgImpact - a.avgImpact)[0] ?? null;
  const mostImproved = [...allThemeSummaries]
    .filter((summary) => summary.improvementDeltaPct != null)
    .sort((a, b) => (b.improvementDeltaPct ?? 0) - (a.improvementDeltaPct ?? 0))[0] ?? null;
  const stageCounts = new Map<EducatorConversationStage, number>();

  for (const occurrence of selectedNegativeOccurrences) {
    stageCounts.set(occurrence.stage, (stageCounts.get(occurrence.stage) ?? 0) + 1);
  }

  const totalStageCount = [...stageCounts.values()].reduce((sum, value) => sum + value, 0);

  const evidenceDrawers: EducatorEvidenceDrawer[] = topThemes.map((summary) => ({
    theme: summary.theme,
    label: summary.label,
    examples: summary.examples.map((example) => ({
      scenario: example.scenarioTitle,
      before: truncateSentence(example.moment?.previous_turn?.content),
      learner_turn: truncateSentence(example.moment?.focus_turn?.content),
      after: truncateSentence(example.moment?.next_turn?.content),
      why_it_matters: truncateSentence(example.whyItMatters ?? THEME_GUIDANCE[summary.theme].why),
      better_alternative: truncateSentence(example.betterAlternative ?? THEME_GUIDANCE[summary.theme].emphasise),
    })),
  }));

  const scenarioTitles = [...new Set(selectedSessions.map((session) => session.scenarioTitle))];

  return {
    headline_cards: {
      most_widespread: buildHeadlineCard(
        "Most Widespread Struggle",
        mostWidespread,
        mostWidespread
          ? `${mostWidespread.label} affected ${roundPct(mostWidespread.learnerPrevalencePct)}% of learners in this view.`
          : "No dominant struggle yet."
      ),
      most_harmful: buildHeadlineCard(
        "Most Harmful Struggle",
        mostHarmful,
        mostHarmful
          ? `${mostHarmful.label} carried the highest average interaction impact.`
          : "No harmful pattern detected yet."
      ),
      most_improved_on_repeat_attempts: buildHeadlineCard(
        "Most Improved on Repeat Attempts",
        mostImproved,
        mostImproved && mostImproved.improvementDeltaPct != null
          ? `${mostImproved.label} was ${Math.round(mostImproved.improvementDeltaPct)} percentage points less common on repeat attempts.`
          : "Not enough repeat-attempt data to show improvement yet."
      ),
    },
    priority_matrix: topThemes.map((summary, index) => ({
      theme: summary.theme,
      label: summary.label,
      priority_rank: index + 1,
      priority_level: summary.priorityLevel,
      learner_prevalence_pct: roundPct(summary.learnerPrevalencePct),
      avg_impact_score: Number(summary.avgImpact.toFixed(1)),
      persistence_pct: roundPct(summary.persistencePct ?? 0),
      trend: summary.trend,
    })),
    heatmap: {
      scenarios: scenarioTitles,
      themes: topThemes.map((summary) => ({
        theme: summary.theme,
        label: summary.label,
      })),
      cells: scenarioTitles.flatMap((scenario) => topThemes.map((summary) => {
        const count = summary.scenarioLearnerCounts.get(scenario) ?? 0;
        const totalScenarioLearners = new Set(
          selectedSessions
            .filter((session) => session.scenarioTitle === scenario)
            .map((session) => session.traineeId)
        ).size;
        const prevalencePct = totalScenarioLearners === 0 ? 0 : (count / totalScenarioLearners) * 100;
        return {
          scenario,
          theme: summary.theme,
          prevalence_pct: roundPct(prevalencePct),
          priority_score: Number((summary.priorityScore * (prevalencePct / 100)).toFixed(1)),
        };
      })),
    },
    conversation_stage_breakdown: EDUCATOR_STAGE_ORDER.map((stage) => {
      const count = stageCounts.get(stage) ?? 0;
      return {
        stage,
        label: EDUCATOR_STAGE_LABELS[stage],
        count,
        pct: totalStageCount === 0 ? 0 : roundPct((count / totalStageCount) * 100),
      };
    }),
    evidence_drawers: evidenceDrawers,
    action_panel: {
      what_to_emphasise_in_the_next_tutorial: topThemes.slice(0, 3).map((summary) => THEME_GUIDANCE[summary.theme].emphasise),
    },
  };
}

function buildAvailableFilters(
  allSessions: NormalizedSession[]
): EducatorAnalyticsResponse["available_filters"] {
  const users = [...new Map(
    allSessions.map((session) => [session.traineeId, { value: session.traineeId, label: session.traineeLabel }])
  ).values()].sort((a, b) => a.label.localeCompare(b.label));
  const scenarios = [...new Map(
    allSessions.map((session) => [session.scenarioId, { value: session.scenarioId, label: session.scenarioTitle }])
  ).values()].sort((a, b) => a.label.localeCompare(b.label));
  const dateValues = allSessions.map((session) => session.createdAt.slice(0, 10)).sort();

  return {
    profession_grade_available: false,
    educator_facilitator_available: false,
    users,
    scenarios,
    min_date: dateValues[0] ?? null,
    max_date: dateValues[dateValues.length - 1] ?? null,
  };
}

export function buildEducatorAnalyticsResponse(input: {
  sessions: AnalyticsSessionRow[];
  evidenceRows: AnalyticsEvidenceRow[];
  filters: EducatorAnalyticsFiltersInput;
  siteProgrammeLabel: string | null;
}) {
  const allSessions = normaliseSessions(input.sessions);
  const analysableSessions = allSessions.filter((session) => session.reviewArtifacts != null);
  const availableFilters = buildAvailableFilters(analysableSessions);
  const selectedSessions = analysableSessions.filter((session) => matchesFilters(session, input.filters));
  const baselineSessions = input.filters.attempt_view === "all"
    ? analysableSessions.filter((session) => !matchesFilters(session, input.filters))
    : analysableSessions.filter((session) => (
      matchesFiltersWithoutAttempt(session, input.filters) &&
      !matchesFilters(session, input.filters)
    ));
  const allEvidenceRows = input.evidenceRows.filter((row) => analysableSessions.some((session) => session.id === row.session_id));
  const { negative, positive } = buildOccurrences(analysableSessions, allEvidenceRows);
  const selectedSessionIds = new Set(selectedSessions.map((session) => session.id));
  const selectedNegative = negative.filter((occurrence) => selectedSessionIds.has(occurrence.sessionId));
  const selectedPositive = positive.filter((occurrence) => selectedSessionIds.has(occurrence.sessionId));
  const comparisonGroup = buildComparisonLabel(input.filters, baselineSessions);
  const themeSummaries = EDUCATOR_TEACHING_THEMES
    .map((theme) => computeThemeSummary(theme, selectedSessions, baselineSessions, negative))
    .filter((summary) => summary.affectedSessions.size > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const topThemes = themeSummaries.slice(0, Math.min(5, Math.max(3, themeSummaries.length)));
  const report: EducatorAnalyticsReport = {
    filters_applied: buildFiltersApplied(input.filters, allSessions, input.siteProgrammeLabel),
    population_summary: buildPopulationSummary(selectedSessions, comparisonGroup),
    top_struggle_areas: buildTopStruggleAreas(topThemes, selectedSessions, comparisonGroup),
    cross_cutting_patterns: buildCrossCuttingPatterns(topThemes, selectedNegative),
    strengths_to_build_on: buildStrengthsToBuildOn(selectedPositive, selectedSessions),
    scenario_design_issues: buildScenarioDesignIssues(selectedSessions),
    data_quality_flags: buildDataQualityFlags(allSessions, selectedSessions),
    educator_takeaways: buildEducatorTakeaways(topThemes),
  };
  const dashboard = buildDashboard(topThemes, selectedSessions, themeSummaries, selectedNegative);

  return {
    generated_at: new Date().toISOString(),
    available_filters: availableFilters,
    report,
    dashboard,
  } satisfies EducatorAnalyticsResponse;
}
