import { createHash } from "node:crypto";
import { z } from "zod";
import type { ScoreBreakdown, ScoreEvidence } from "@/lib/engine/scoring";
import {
  generateReviewMoments,
  type ReviewMomentSelectionMeta,
  type SelectedReviewMoment,
} from "@/lib/openai/reviewMomentSelection";
import {
  REVIEW_SUMMARY_VERSION,
  buildObjectiveCoverage,
  formatReviewTimecode,
  reviewSummaryResponseSchema,
  reviewTimelineResponseSchema,
  type GeneratedTimelineNarrative,
  type ReviewSummaryData,
} from "@/lib/review/feedback";
import { reviewArtifactsSchema } from "@/lib/validation/schemas";
import type { ScenarioMilestone, ScenarioTraits } from "@/types/scenario";
import type {
  ExitType,
  SessionDeliveryAnalysis,
  SimulationSession,
  TraineeDeliveryAnalysis,
  TraineeDeliveryMarker,
  TranscriptTurn,
} from "@/types/simulation";

export const REVIEW_ARTIFACTS_VERSION = 10;

export const REVIEW_SUMMARY_PROMPT_VERSION = "review-summary-v5";
export const REVIEW_SUMMARY_SCHEMA_VERSION = "review-summary-render-v3";
export const REVIEW_TIMELINE_PROMPT_VERSION = "review-timeline-v5";
export const REVIEW_TIMELINE_SCHEMA_VERSION = "review-timeline-render-v2";
export const REVIEW_HISTORY_PROMPT_VERSION = "scenario-history-v4";
export const REVIEW_HISTORY_SCHEMA_VERSION = "scenario-history-render-v2";

const DELIVERY_CONFIDENCE_THRESHOLD = 0.45;
const POSITIVE_DELIVERY_MARKERS = new Set<TraineeDeliveryMarker>([
  "calm_measured",
  "warm_empathic",
]);
const NEGATIVE_DELIVERY_MARKERS = new Set<TraineeDeliveryMarker>([
  "tense_hurried",
  "flat_detached",
  "defensive_tone",
  "sarcastic_tone",
  "irritated_tone",
  "hostile_tone",
  "anxious_unsteady",
]);
const STRONG_NEGATIVE_DELIVERY_MARKERS = new Set<TraineeDeliveryMarker>([
  "defensive_tone",
  "sarcastic_tone",
  "irritated_tone",
  "hostile_tone",
]);

const reviewMomentSnippetSchema = z.object({
  speaker: z.string(),
  content: z.string(),
});

export const reviewEvidenceLedgerMomentSchema = z.object({
  id: z.string(),
  turn_index: z.number().int().min(0),
  positive: z.boolean(),
  dimension: z.string(),
  evidence_type: z.string(),
  headline_hint: z.string(),
  active_need_or_barrier: z.string().nullable().default(null),
  what_partly_landed: z.string().nullable().default(null),
  what_was_missing: z.string().nullable().default(null),
  why_it_mattered_reason: z.string(),
  likely_impact: z.string(),
  observed_consequence: z.string(),
  next_best_move: z.string().nullable().default(null),
  evidence_signals: z.array(z.string()).default([]),
  transcript_anchor: z.string().nullable().default(null),
  previous_turn: reviewMomentSnippetSchema.nullable().default(null),
  focus_turn: reviewMomentSnippetSchema.nullable().default(null),
  next_turn: reviewMomentSnippetSchema.nullable().default(null),
});

export const scenarioPatternLedgerSchema = z.object({
  main_missed_move_codes: z.array(z.string()).default([]),
  positive_move_codes: z.array(z.string()).default([]),
  objective_gaps: z.array(z.string()).default([]),
  repeated_question_answered_promptly: z.boolean().nullable().default(null),
  specificity_before_reassurance: z.boolean().nullable().default(null),
  support_timing: z.enum(["not_needed", "appropriate", "late", "early", "missed"]).nullable().default(null),
  delivery_pattern_supported_by_audio: z.boolean().default(false),
  session_outcome: z.enum(["settled", "partly_settled", "tense", "highly_strained", "ended_early", "unclear"]),
});

export const reviewEvidenceLedgerSchema = z.object({
  session_id: z.string(),
  scenario_title: z.string(),
  scenario_setting: z.string().nullable().default(null),
  trainee_role: z.string().nullable().default(null),
  ai_role: z.string().nullable().default(null),
  person_adaptation_note: z.string().nullable().default(null),
  scenario_demand_summary: z.object({
    primary_need: z.string().nullable().default(null),
    common_pitfall: z.string().nullable().default(null),
    success_pattern: z.string().nullable().default(null),
    adaptation_note: z.string().nullable().default(null),
  }),
  objective_ledger: z.object({
    objective_focus: z.string().nullable().default(null),
    achieved_objectives: z.array(z.string()).default([]),
    outstanding_objectives: z.array(z.string()).default([]),
  }),
  delivery_aggregate: z.object({
    supported: z.boolean().default(false),
    summary: z.string().nullable().default(null),
    markers: z.array(z.string()).default([]),
    evidence_turn_indexes: z.array(z.number().int()).default([]),
    trend: z.enum(["improving", "worsening", "steady", "mixed"]).nullable().default(null),
  }),
  outcome_state: z.object({
    session_valid: z.boolean(),
    turn_count: z.number().int().min(0),
    final_escalation_level: z.number().int().nullable().default(null),
    exit_type: z.string().nullable().default(null),
    overall_score: z.number().nullable().default(null),
    qualitative_label: z.string().nullable().default(null),
  }),
  moments: z.array(reviewEvidenceLedgerMomentSchema).default([]),
  pattern_ledger: scenarioPatternLedgerSchema,
});

export const summaryPlanSchema = z.object({
  focus_moment_id: z.string().nullable().default(null),
  positive_moment_id: z.string().nullable().default(null),
  main_case_need: z.string().nullable().default(null),
  what_partly_landed: z.string().nullable().default(null),
  what_was_missing: z.string().nullable().default(null),
  why_it_mattered_reason: z.string().nullable().default(null),
  next_best_move: z.string().nullable().default(null),
  delivery_pattern: z.string().nullable().default(null),
  objective_gap: z.string().nullable().default(null),
  person_adaptation: z.string().nullable().default(null),
  show_overall_delivery: z.boolean().default(false),
});

export const timelinePlanSchema = z.object({
  moment_id: z.string(),
  active_need_or_barrier: z.string().nullable().default(null),
  what_partly_landed: z.string().nullable().default(null),
  what_was_missing: z.string().nullable().default(null),
  why_it_mattered_reason: z.string(),
  observed_consequence: z.string(),
  next_best_move: z.string().nullable().default(null),
  banned_phrases: z.array(z.string()).default([]),
  positive: z.boolean(),
});

const renderSurfaceMetaSchema = z.object({
  prompt_version: z.string(),
  schema_version: z.string(),
  model: z.string(),
  reasoning_effort: z.enum(["none", "low", "medium", "high", "xhigh"]),
  retry_count: z.number().int().min(0).default(0),
  fallback_used: z.boolean().default(false),
  failure_class: z.enum(["parse", "schema", "semantic", "duplication", "provenance"]).nullable().default(null),
  validator_failures: z.array(z.string()).default([]),
  field_provenance: z.record(z.string(), z.object({
    source: z.enum([
      "deterministic_evidence",
      "summary_plan",
      "timeline_plan",
      "llm_render",
      "audio_aggregate",
      "fallback",
    ]),
    evidenceIds: z.array(z.string()).default([]),
    note: z.string().nullable().default(null),
  })).default({}),
});

export const storedReviewArtifactsSchema = z.object({
  version: z.number().int().min(1),
  evidence_hash: z.string(),
  meta: z.object({
    built_at: z.string(),
    moment_selection: renderSurfaceMetaSchema.nullable().default(null),
    summary: renderSurfaceMetaSchema.nullable().default(null),
    timeline: renderSurfaceMetaSchema.nullable().default(null),
  }),
  ledger: reviewEvidenceLedgerSchema,
  summary_plan: summaryPlanSchema,
  timeline_plans: z.array(timelinePlanSchema).default([]),
  summary: reviewSummaryResponseSchema.nullable().default(null),
  timeline: reviewTimelineResponseSchema.nullable().default(null),
});

export type ReviewEvidenceLedger = z.infer<typeof reviewEvidenceLedgerSchema>;
export type ReviewEvidenceLedgerMoment = z.infer<typeof reviewEvidenceLedgerMomentSchema>;
export type ScenarioPatternLedger = z.infer<typeof scenarioPatternLedgerSchema>;
export type SummaryPlan = z.infer<typeof summaryPlanSchema>;
export type TimelinePlan = z.infer<typeof timelinePlanSchema>;
export type ReviewSurfaceMeta = z.infer<typeof renderSurfaceMetaSchema>;
export type StoredReviewArtifacts = z.infer<typeof storedReviewArtifactsSchema>;

interface ReviewArtifactContext {
  session: SimulationSession;
  score: ScoreBreakdown;
  turns: TranscriptTurn[];
  sessionDeliveryAnalysis?: SessionDeliveryAnalysis | null;
  milestones?: ScenarioMilestone[];
  learningObjectives?: string | null | undefined;
  aiRole?: string | null | undefined;
  backstory?: string | null | undefined;
  emotionalDriver?: string | null | undefined;
  traits?: ScenarioTraits | null | undefined;
}

function sentenceCase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function stripTrailingPeriod(value: string) {
  return value.trim().replace(/[. ]+$/, "");
}

function normaliseText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function humanizeIdentifier(value: string) {
  return value.replace(/_/g, " ");
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getSortedTurns(turns: TranscriptTurn[]) {
  return [...turns].sort((a, b) => a.turn_index - b.turn_index);
}

function getMomentTurnContext(turns: TranscriptTurn[], turnIndex: number) {
  const sortedTurns = getSortedTurns(turns);
  const focusIndex = sortedTurns.findIndex((turn) => turn.turn_index === turnIndex);

  if (focusIndex < 0) {
    return {
      previousTurn: null,
      focusTurn: null,
      nextTurn: null,
    };
  }

  return {
    previousTurn: focusIndex > 0 ? sortedTurns[focusIndex - 1] : null,
    focusTurn: sortedTurns[focusIndex] ?? null,
    nextTurn: focusIndex < sortedTurns.length - 1 ? sortedTurns[focusIndex + 1] : null,
  };
}

function findNextPatientTurn(turns: TranscriptTurn[], turnIndex: number) {
  return getSortedTurns(turns).find((turn) => turn.turn_index > turnIndex && turn.speaker === "ai") ?? null;
}

function inferConcernPhrase(...turns: Array<TranscriptTurn | null>) {
  const text = turns
    .flatMap((turn) => (turn?.content ? [turn.content.toLowerCase()] : []))
    .join(" ");

  if (!text) return null;
  if (text.includes("discharge")) return "the discharge blocker";
  if (text.includes("go home") || text.includes("home")) return "going home";
  if (text.includes("delay") || text.includes("wait") || text.includes("waiting")) return "the delay";
  if (text.includes("safe") || text.includes("unsafe") || text.includes("risk")) return "the safety concern";
  if (text.includes("pain")) return "the pain concern";
  if (text.includes("why")) return "the reason for the problem";
  if (text.includes("when")) return "what happens next";
  if (text.includes("question") || text.includes("?")) return "the direct question";
  return "the main concern";
}

function getTurnDeliveryAnalysis(turn: TranscriptTurn): TraineeDeliveryAnalysis | null {
  const analysis = turn.trainee_delivery_analysis ?? turn.classifier_result?.trainee_delivery_analysis ?? null;
  if (
    !analysis ||
    analysis.source !== "audio" ||
    analysis.confidence < DELIVERY_CONFIDENCE_THRESHOLD
  ) {
    return null;
  }

  return analysis;
}

function countDeliveryMarkerHits(
  markerGroups: Array<{ markers: TraineeDeliveryMarker[] }>,
  allowedMarkers: Set<TraineeDeliveryMarker>
) {
  const counts = new Map<TraineeDeliveryMarker, number>();

  for (const group of markerGroups) {
    for (const marker of group.markers) {
      if (!allowedMarkers.has(marker)) continue;
      counts.set(marker, (counts.get(marker) ?? 0) + 1);
    }
  }

  return counts;
}

function describePositiveDelivery(
  counts: Map<TraineeDeliveryMarker, number>
) {
  const calm = counts.get("calm_measured") ?? 0;
  const warm = counts.get("warm_empathic") ?? 0;

  if (calm > 0 && warm > 0) {
    return "steady, measured, and warm";
  }

  if (warm > calm) {
    return "warm and empathic";
  }

  return "steady and measured";
}

function describeNegativeDelivery(
  counts: Map<TraineeDeliveryMarker, number>
) {
  const hurried =
    (counts.get("tense_hurried") ?? 0) +
    (counts.get("anxious_unsteady") ?? 0);
  const defensive =
    (counts.get("defensive_tone") ?? 0) +
    (counts.get("sarcastic_tone") ?? 0) +
    (counts.get("irritated_tone") ?? 0) +
    (counts.get("hostile_tone") ?? 0);
  const detached = counts.get("flat_detached") ?? 0;

  if (hurried > 0 && defensive > 0) {
    return "more hurried and defensive";
  }

  if (defensive > 0) {
    return "more defensive and reactive";
  }

  if (hurried > 0) {
    return "more hurried and less grounded";
  }

  if (detached > 0) {
    return "flatter and more detached";
  }

  return "less settled";
}

function buildLegacyDeliveryAggregate(turns: TranscriptTurn[]) {
  const deliveryMoments = getSortedTurns(turns).flatMap((turn) => {
    if (turn.speaker !== "trainee") return [];

    const analysis = getTurnDeliveryAnalysis(turn);
    if (!analysis) return [];

    const markers = [...new Set(analysis.markers)];
    if (markers.length === 0) return [];

    return [{
      turnIndex: turn.turn_index,
      markers,
      score: markers.reduce((sum, marker) => {
        if (marker === "warm_empathic") return sum + 2;
        if (marker === "calm_measured") return sum + 1;
        if (STRONG_NEGATIVE_DELIVERY_MARKERS.has(marker)) return sum - 2;
        return sum - 1;
      }, 0),
    }];
  });

  if (deliveryMoments.length < 2) {
    return {
      supported: false,
      summary: null,
      markers: [] as string[],
      evidence_turn_indexes: [] as number[],
      trend: null,
    };
  }

  const positiveTurns = deliveryMoments.filter((moment) => moment.score > 0).length;
  const negativeTurns = deliveryMoments.filter((moment) => moment.score < 0).length;
  const midpoint = Math.ceil(deliveryMoments.length / 2);
  const firstHalfAverage = average(deliveryMoments.slice(0, midpoint).map((moment) => moment.score)) ?? 0;
  const secondHalfAverage = average(deliveryMoments.slice(midpoint).map((moment) => moment.score)) ?? firstHalfAverage;
  const totalScore = deliveryMoments.reduce((sum, moment) => sum + moment.score, 0);
  const positiveCounts = countDeliveryMarkerHits(deliveryMoments, POSITIVE_DELIVERY_MARKERS);
  const negativeCounts = countDeliveryMarkerHits(deliveryMoments, NEGATIVE_DELIVERY_MARKERS);
  const strongNegativeHits = [...negativeCounts.entries()].reduce(
    (sum, [marker, count]) => sum + (STRONG_NEGATIVE_DELIVERY_MARKERS.has(marker) ? count : 0),
    0
  );
  const positiveDescriptor = describePositiveDelivery(positiveCounts);
  const negativeDescriptor = describeNegativeDelivery(negativeCounts);
  const uniqueMarkers = [...new Set(deliveryMoments.flatMap((moment) => moment.markers))];
  const evidenceTurnIndexes = deliveryMoments.map((moment) => moment.turnIndex);

  if (
    deliveryMoments.length >= 3 &&
    firstHalfAverage >= 0 &&
    secondHalfAverage <= -0.75 &&
    negativeTurns >= 2
  ) {
    return {
      supported: true,
      summary: `Across the conversation, your delivery started steadier but became ${negativeDescriptor} once the pressure rose.`,
      markers: uniqueMarkers,
      evidence_turn_indexes: evidenceTurnIndexes,
      trend: "worsening" as const,
    };
  }

  if (
    deliveryMoments.length >= 3 &&
    firstHalfAverage <= -0.75 &&
    secondHalfAverage >= 0.5 &&
    positiveTurns >= 2
  ) {
    return {
      supported: true,
      summary: `Across the conversation, your delivery sounded tighter at first, then became ${positiveDescriptor} as the exchange settled.`,
      markers: uniqueMarkers,
      evidence_turn_indexes: evidenceTurnIndexes,
      trend: "improving" as const,
    };
  }

  if (negativeTurns >= 2 && (totalScore <= -2 || strongNegativeHits >= 2)) {
    return {
      supported: true,
      summary: `Across the conversation, your delivery often sounded ${negativeDescriptor}, which may have made the message harder to receive.`,
      markers: uniqueMarkers,
      evidence_turn_indexes: evidenceTurnIndexes,
      trend: "steady" as const,
    };
  }

  if (positiveTurns >= 2 && negativeTurns === 0 && totalScore >= 2) {
    return {
      supported: true,
      summary: `Across the conversation, your delivery stayed ${positiveDescriptor}, which likely helped the message land more easily.`,
      markers: uniqueMarkers,
      evidence_turn_indexes: evidenceTurnIndexes,
      trend: "steady" as const,
    };
  }

  if (positiveTurns >= 2 && negativeTurns >= 1) {
    return {
      supported: true,
      summary: `Across the conversation, there were steadier moments, but the delivery was not yet fully settled under pressure.`,
      markers: uniqueMarkers,
      evidence_turn_indexes: evidenceTurnIndexes,
      trend: "mixed" as const,
    };
  }

  return {
    supported: false,
    summary: null,
    markers: uniqueMarkers,
    evidence_turn_indexes: evidenceTurnIndexes,
    trend: null,
  };
}

function buildDeliveryAggregate(
  turns: TranscriptTurn[],
  sessionDeliveryAnalysis?: SessionDeliveryAnalysis | null
) {
  if (!sessionDeliveryAnalysis) {
    return buildLegacyDeliveryAggregate(turns);
  }

  return {
    supported: sessionDeliveryAnalysis.supported,
    summary: sessionDeliveryAnalysis.supported ? sessionDeliveryAnalysis.summary : null,
    markers: sessionDeliveryAnalysis.markers,
    evidence_turn_indexes: sessionDeliveryAnalysis.evidenceTurnIndexes,
    trend: sessionDeliveryAnalysis.supported ? sessionDeliveryAnalysis.trend : null,
  };
}

function getSessionOutcome(finalLevel: number | null | undefined, exitType: ExitType | null | undefined) {
  if (exitType === "instant_exit") return "ended_early" as const;
  if (finalLevel == null) return "unclear" as const;
  if (finalLevel <= 2) return "settled" as const;
  if (finalLevel <= 4) return "partly_settled" as const;
  if (finalLevel <= 7) return "tense" as const;
  return "highly_strained" as const;
}

function buildPersonAdaptationNote(traits?: ScenarioTraits | null) {
  if (!traits) return null;

  if (traits.repetition >= 6) {
    return "Keep answers concrete because the person is likely to repeat the question when the reply lacks specifics.";
  }

  if (traits.interruption_likelihood >= 7 || traits.impatience >= 7) {
    return "Keep the opening short and signposted because long answers are likely to be interrupted.";
  }

  if (traits.trust <= 3) {
    return "Lead with the practical reason before reassurance because low trust makes vague reassurance land badly.";
  }

  if (traits.entitlement >= 7) {
    return "Be explicit about what can happen today and what cannot, because the person is pushing for a concrete answer.";
  }

  if (traits.boundary_respect <= 3 || traits.hostility >= 7) {
    return "Use calm, specific limits without matching the tone if the conversation becomes openly hostile.";
  }

  return null;
}

function lowerFirst(value: string | null | undefined) {
  if (!value) return null;

  const trimmed = stripTrailingPeriod(value);
  if (!trimmed) return null;

  return trimmed[0].toLowerCase() + trimmed.slice(1);
}

function describeNeedPlain(activeNeedOrBarrier: string | null | undefined) {
  const need = lowerFirst(activeNeedOrBarrier);
  if (!need) return null;

  if (/\b(discharge|go home|delay|blocker)\b/i.test(need)) {
    return "why the patient could not go home yet";
  }

  if (/\bwhat happens next\b/i.test(need) || /\bnext step\b/i.test(need)) {
    return "what would happen next";
  }

  if (/\bdirect answer\b/i.test(need) || /\brepeated question\b/i.test(need) || /\bquestion\b/i.test(need)) {
    return "the question";
  }

  if (/\bsafety\b/i.test(need)) {
    return "how the safety risk was being managed";
  }

  if (need.startsWith("clarity about ")) {
    return need.slice("clarity about ".length);
  }

  if (need.startsWith("a direct answer to ")) {
    return need.slice("a direct answer to ".length);
  }

  if (need.startsWith("a direct answer about ")) {
    return need.slice("a direct answer about ".length);
  }

  if (need.startsWith("a concrete explanation of ")) {
    return need.slice("a concrete explanation of ".length);
  }

  if (need.startsWith("a concrete reason for ")) {
    return need.slice("a concrete reason for ".length);
  }

  if (need.startsWith("a concrete update on ")) {
    return need.slice("a concrete update on ".length);
  }

  if (need.startsWith("a clear outline of ")) {
    return need.slice("a clear outline of ".length);
  }

  if (need.startsWith("a clear statement of ")) {
    return need.slice("a clear statement of ".length);
  }

  return need.replace(/^(a|an)\s+/i, "");
}

function buildNeedExpectation(activeNeedOrBarrier: string | null | undefined) {
  const need = describeNeedPlain(activeNeedOrBarrier);
  if (!need) return null;

  if (/^(why|how|what)\b/i.test(need)) {
    return `to hear ${need}`;
  }

  if (need === "the question") {
    return "to hear a clear answer to the question";
  }

  return `to hear about ${need}`;
}

function buildNeedFromObjective(objective: string | null | undefined) {
  const fragment = lowerFirst(objective);
  if (!fragment) return null;

  if (/\b(discharge|go home|home safely)\b/i.test(fragment) && /\b(complexity|delay|safe|safety|blocker)\b/i.test(fragment)) {
    return "why the patient could not go home yet";
  }

  if (/\bdischarge\b/i.test(fragment) && /\bcomplexity\b/i.test(fragment)) {
    return "why the patient could not go home yet";
  }

  if (/\bdelay\b/i.test(fragment) && /\bdischarge\b/i.test(fragment)) {
    return "why there was a delay";
  }

  if (/\bsafety\b/i.test(fragment) && /\b(discharge|home|go home)\b/i.test(fragment)) {
    return "how the safety risk was being managed";
  }

  if (/^explain\b/i.test(fragment)) {
    return `a concrete explanation of ${fragment.replace(/^explain\s+/i, "")}`;
  }

  if (/^clarify\b/i.test(fragment)) {
    return `clarity about ${fragment.replace(/^clarify\s+/i, "")}`;
  }

  if (/^(answer|address)\b/i.test(fragment)) {
    return `a direct answer about ${fragment.replace(/^(answer|address)\s+/i, "")}`;
  }

  if (/^give\b/i.test(fragment)) {
    return `a concrete update on ${fragment.replace(/^give\s+/i, "")}`;
  }

  if (/^outline\b/i.test(fragment)) {
    return `a clear outline of ${fragment.replace(/^outline\s+/i, "")}`;
  }

  if (/^name\b/i.test(fragment)) {
    return `a clear statement of ${fragment.replace(/^name\s+/i, "")}`;
  }

  if (/^tell\b/i.test(fragment)) {
    return `a clear explanation of ${fragment.replace(/^tell\s+/i, "")}`;
  }

  if (/^demonstrat(?:e|es)\s+understanding\s+of\b/i.test(fragment)) {
    return `a concrete explanation of ${fragment.replace(/^demonstrat(?:e|es)\s+understanding\s+of\s+/i, "")}`;
  }

  if (/^show(?:s)?\s+understanding\s+of\b/i.test(fragment)) {
    return `a concrete explanation of ${fragment.replace(/^show(?:s)?\s+understanding\s+of\s+/i, "")}`;
  }

  if (/^understanding\s+of\b/i.test(fragment)) {
    return `a concrete explanation of ${fragment.replace(/^understanding\s+of\s+/i, "")}`;
  }

  return fragment;
}

function isSpecificNeed(value: string | null | undefined) {
  if (!value) return false;
  return /\b(discharge|delay|blocker|safety|risk|pain|home|next step|question|answer|plan|support|why|what happens next|what would happen next)\b/i.test(value);
}

function buildCaseMoveFromNeed(activeNeedOrBarrier: string | null) {
  const need = describeNeedPlain(activeNeedOrBarrier);
  if (!need) return null;

  if (need === "why the patient could not go home yet") {
    return "say clearly why the patient could not go home yet";
  }

  if (need === "the question") {
    return "answer the question directly";
  }

  if (need === "what would happen next") {
    return "say what would happen next";
  }

  if (need === "how the safety risk was being managed") {
    return "say how the safety risk was being managed";
  }

  if (/^(why|how|what)\b/i.test(need)) {
    return `say clearly ${need}`;
  }

  if (need.startsWith("the ")) {
    return `be clear about ${need}`;
  }

  return `be clear about ${need}`;
}

function buildActiveNeedOrBarrier(
  moment: ScoreEvidence,
  context: ReturnType<typeof getMomentTurnContext>,
  outstandingObjectives: string[]
) {
  const concernPhrase = inferConcernPhrase(context.previousTurn, context.focusTurn, context.nextTurn);
  const objectiveNeed = buildNeedFromObjective(outstandingObjectives[0] ?? null);

  if (moment.evidenceType === "support_not_requested" || moment.evidenceType === "critical_no_support") {
    return "a safe containment plan once the interaction had crossed the support threshold";
  }

  if (moment.evidenceType === "support_invoked" && moment.evidenceData.appropriate === false) {
    return "one contained reply before moving to extra support";
  }

  if (objectiveNeed && (isSpecificNeed(objectiveNeed) || concernPhrase === "the direct question" || concernPhrase === "what happens next")) {
    return objectiveNeed;
  }

  if (concernPhrase === "the reason for the problem" || concernPhrase === "the delay" || concernPhrase === "the discharge blocker") {
    return concernPhrase === "the discharge blocker"
      ? "why the patient could not go home yet"
      : "why there was a delay";
  }

  if (concernPhrase === "the direct question" || concernPhrase === "what happens next") {
    return concernPhrase === "what happens next"
      ? "what would happen next"
      : "a clear answer to the repeated question";
  }

  if (concernPhrase) {
    return `clarity about ${concernPhrase}`;
  }

  if (outstandingObjectives[0]) {
    return objectiveNeed ?? lowerFirst(outstandingObjectives[0]);
  }

  return "a concrete answer to the main concern";
}

function buildWhatPartlyLanded(
  moment: ScoreEvidence,
  positive: boolean,
  activeNeedOrBarrier: string | null
) {
  if (!positive && moment.evidenceType === "de_escalation_attempt") {
    return "You did make a repair attempt.";
  }

  if (!positive) {
    return null;
  }

  switch (moment.evidenceType) {
    case "milestone_completed":
      if (activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("go home")) {
        return "You did start to explain why the patient could not go home yet.";
      }
      if (activeNeedOrBarrier?.includes("what happens next") || activeNeedOrBarrier?.includes("direct answer")) {
        return "You did answer the question more directly.";
      }
      return "You kept the reply focused on the actual issue.";
    case "delivery_marker":
      return activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("go home")
        ? "There was a steadier reply when you explained the reason for the delay more clearly."
        : "Your delivery sounded steadier and easier to receive.";
    case "support_invoked":
      return moment.evidenceData.appropriate === true
        ? "You recognised the point where extra support was the safest move."
        : "You did recognise that the situation might need extra support.";
    case "de_escalation_attempt":
      return "The acknowledgement gave the other person a little more room to listen.";
    default:
      return "Part of the response helped the conversation stay workable.";
  }
}

function buildWhatWasMissing(moment: ScoreEvidence, activeNeedOrBarrier: string | null) {
  const need = describeNeedPlain(activeNeedOrBarrier);

  switch (moment.evidenceType) {
    case "de_escalation_harm":
      return activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")
        ? "you acknowledged the frustration before you clearly explained why the patient could not go home yet"
        : "the acknowledgement came before the explanation was clear";
    case "low_substance_response":
      return activeNeedOrBarrier?.includes("question") || activeNeedOrBarrier?.includes("what happens next")
        ? "the reply still did not clearly answer the question"
        : activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge")
          ? "the reply still did not clearly explain why the patient could not go home yet"
          : "the answer stayed too vague for the question being asked";
    case "composure_marker":
      return activeNeedOrBarrier?.includes("question") || activeNeedOrBarrier?.includes("what happens next")
        ? "the answer sounded tight and defensive while the question was still open"
        : activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge")
          ? "the tone tightened before the reason for the delay was clear"
          : "the reply sounded more defensive than containing";
    case "de_escalation_attempt":
      return activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge")
        ? "the acknowledgement still did not explain why the delay was happening"
        : "the repair move still did not answer the main concern clearly enough";
    case "support_not_requested":
    case "critical_no_support":
      return "support was delayed after the threshold had already been crossed";
    case "support_invoked":
      return moment.evidenceData.appropriate === false
        ? "extra support came in before the main concern had been answered"
        : null;
    default:
      return need
        ? `${need} still was not clear enough`
        : "the main need stayed unresolved";
  }
}

function buildWhyItMatteredReason(
  moment: ScoreEvidence,
  activeNeedOrBarrier: string | null
) {
  const expectation = buildNeedExpectation(activeNeedOrBarrier);

  switch (moment.evidenceType) {
    case "support_not_requested":
    case "critical_no_support":
      return "Once the interaction had crossed the support threshold, the coaching task shifted from persuasion to safety and containment.";
    case "support_invoked":
      return moment.evidenceData.appropriate === false
        ? "Bringing in support before answering the main concern can close down a workable repair too early."
        : "Good support-seeking is part of skilled communication when the interaction is no longer safe or containable alone.";
    case "de_escalation_harm":
      if (activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")) {
        return "The relative was still asking why the patient was stuck in hospital, so acknowledgement on its own did not answer the question driving the frustration.";
      }
      if (activeNeedOrBarrier?.includes("question") || activeNeedOrBarrier?.includes("what happens next")) {
        return "The emotion was real, but the unanswered question was still driving the pressure in the conversation.";
      }
      return "Acknowledgement may have helped with tone, but it did not answer what the other person most needed to know.";
    case "low_substance_response":
      if (activeNeedOrBarrier?.includes("question") || activeNeedOrBarrier?.includes("what happens next")) {
        return "Because the question stayed unanswered, the conversation was likely to circle back to it again.";
      }
      if (activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")) {
        return "A broad answer left the person without a clear reason for the delay, so the pressure was likely to stay high.";
      }
      return expectation
        ? `The other person was still waiting ${expectation}, so the conversation had little reason to move on.`
        : "The answer was too broad to settle the concern, so the same pressure point was likely to return.";
    case "delivery_marker":
      return moment.scoreImpact > 0
        ? expectation
          ? `The steadier tone made it easier for the other person ${expectation}.`
          : "The steadier tone made the explanation easier to hear."
        : activeNeedOrBarrier?.includes("question") || activeNeedOrBarrier?.includes("what happens next")
          ? "When the tone sounds defensive before the question is answered, the other person is more likely to hear resistance than help."
          : activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")
            ? "When the tone tightens before the reason is clear, the explanation is harder to trust."
            : "Once the tone tightens, even a reasonable explanation can sound like pushback.";
    case "composure_marker":
      if (activeNeedOrBarrier?.includes("question") || activeNeedOrBarrier?.includes("what happens next")) {
        return "When the tone sounds defensive before the question is answered, the other person is more likely to hear resistance than help.";
      }
      if (activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")) {
        return "When the tone tightens before the reason is clear, the explanation is harder to trust.";
      }
      return "Once the tone tightens, even a reasonable explanation can sound like pushback.";
    case "de_escalation_attempt":
      if (activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")) {
        return "The acknowledgement may have bought a little space, but it still left the reason for the delay unclear.";
      }
      return expectation
        ? `The acknowledgement helped briefly, but it still left the other person waiting ${expectation}.`
        : "The acknowledgement helped briefly, but it still did not resolve the main concern.";
    default:
      if (activeNeedOrBarrier?.includes("safety")) {
        return "Without a clear response to the safety concern, the pressure in the exchange had little reason to drop.";
      }
      return expectation
        ? `The other person was still waiting ${expectation}, so a vague or badly timed reply was unlikely to settle the exchange.`
        : "The other person still needed one clear answer before the conversation could move on.";
  }
}

function buildNextBestMove(moment: ScoreEvidence, activeNeedOrBarrier: string | null) {
  const moveTarget = buildCaseMoveFromNeed(activeNeedOrBarrier);

  switch (moment.evidenceType) {
    case "de_escalation_harm":
      return activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")
        ? "Acknowledge the frustration, then say clearly why the patient could not go home yet and what would happen next."
        : "Acknowledge the frustration, then answer the main question in one short clear reply.";
    case "low_substance_response":
      return moveTarget
        ? `${sentenceCase(moveTarget)}, then end with one clear next step.`
        : "Answer the concern directly, then give one clear next step.";
    case "composure_marker":
      return moveTarget
        ? `Keep the first line shorter and steadier, then ${moveTarget}.`
        : "Keep the first line shorter and steadier, then answer the concern directly.";
    case "de_escalation_attempt":
      return activeNeedOrBarrier?.includes("delay") || activeNeedOrBarrier?.includes("blocker") || activeNeedOrBarrier?.includes("discharge") || activeNeedOrBarrier?.includes("go home")
        ? "Keep the acknowledgement, but follow it straight away with why the patient could not go home yet and what would happen next."
        : "Keep the acknowledgement, but follow it straight away with the answer and the next step.";
    case "support_not_requested":
    case "critical_no_support":
      return "Name the safety concern clearly and bring in support at that point rather than one turn later.";
    case "support_invoked":
      return moment.evidenceData.appropriate === false
        ? "Answer the main concern first, then decide whether extra support is actually needed."
        : null;
    default:
      return moveTarget
        ? `${sentenceCase(moveTarget)} earlier in the reply.`
        : null;
  }
}

function buildObservedConsequence(turns: TranscriptTurn[], moment: ScoreEvidence) {
  const nextPatientTurn = findNextPatientTurn(turns, moment.turnIndex);
  const levelBefore = typeof moment.evidenceData.levelBefore === "number"
    ? moment.evidenceData.levelBefore
    : null;
  const levelAfter = nextPatientTurn?.state_after?.level ?? null;
  const nextReplyText = nextPatientTurn?.content?.toLowerCase() ?? "";
  const nextReplyStillHeated = /\b(what the hell|bloody|fed up|don['’]t talk down|disgrace|no one.*gives a toss|helpless|clueless|alright\??)\b/i.test(
    nextReplyText
  );

  if (!nextPatientTurn) {
    return "The conversation ended before the effect of this moment was fully clear.";
  }

  if (levelBefore != null && levelAfter != null) {
    if (levelAfter < levelBefore) {
      if (nextReplyStillHeated) {
        return "The next reply still pushed back hard, even if the pressure dipped slightly.";
      }
      return "The next reply sounded steadier and the pressure came down.";
    }

    if (levelAfter > levelBefore) {
      return "The next reply stayed heated and the pressure continued to rise.";
    }

    if (nextReplyStillHeated) {
      return "The next reply was still heated, so the concern had not really settled.";
    }

    return "The next reply did not show much recovery.";
  }

  if (nextPatientTurn.content.trim()) {
    const nextConcern = inferConcernPhrase(nextPatientTurn);
    if (nextConcern === "the delay" || nextConcern === "the discharge blocker") {
      return "The next reply came straight back to the delay, suggesting the explanation had not landed.";
    }
    if (nextConcern === "the direct question" || nextConcern === "what happens next") {
      return "The next reply repeated the question, suggesting the answer still was not clear enough.";
    }
    if (nextConcern === "the safety concern") {
      return "The next reply stayed on the safety concern rather than settling.";
    }
    return "The next reply stayed on the same pressure point rather than moving on.";
  }

  return "The next reply did not show a clear recovery.";
}

function buildLikelyImpact(moment: ScoreEvidence, activeNeedOrBarrier: string | null) {
  const need = lowerFirst(activeNeedOrBarrier);
  const sentenceNeed = need && /^(a|an)\b/i.test(need) ? `the ${need}` : need;

  if (moment.scoreImpact > 0) {
    return sentenceNeed
      ? `This move likely made it easier for the other person to hear ${sentenceNeed}.`
      : "This move likely helped the message land more easily.";
  }

  return sentenceNeed
    ? `This reply likely made it harder for the other person to hear ${sentenceNeed}.`
    : "This reply likely made the message harder to receive.";
}

function buildHeadlineHint(
  positive: boolean,
  whatPartlyLanded: string | null,
  whatWasMissing: string | null
) {
  if (positive && whatPartlyLanded) {
    return `${sentenceCase(stripTrailingPeriod(whatPartlyLanded))}.`;
  }

  if (!positive && whatWasMissing) {
    return `${sentenceCase(stripTrailingPeriod(whatWasMissing))}.`;
  }

  return positive
    ? "Part of this reply helped the message land."
    : "This moment left the main need unresolved.";
}

export function buildMomentEntry(
  moment: ScoreEvidence,
  turns: TranscriptTurn[],
  outstandingObjectives: string[]
): ReviewEvidenceLedgerMoment {
  const context = getMomentTurnContext(turns, moment.turnIndex);
  const positive =
    moment.scoreImpact > 0 ||
    moment.evidenceType === "milestone_completed" ||
    (moment.evidenceType === "de_escalation_attempt" && moment.evidenceData.effective === true);
  const activeNeedOrBarrier = buildActiveNeedOrBarrier(moment, context, outstandingObjectives);
  const whatPartlyLanded = buildWhatPartlyLanded(moment, positive, activeNeedOrBarrier);
  const whatWasMissing = positive ? null : buildWhatWasMissing(moment, activeNeedOrBarrier);

  return reviewEvidenceLedgerMomentSchema.parse({
    id: `m${moment.turnIndex}`,
    turn_index: moment.turnIndex,
    positive,
    dimension: humanizeIdentifier(moment.dimension),
    evidence_type: humanizeIdentifier(moment.evidenceType),
    headline_hint: buildHeadlineHint(positive, whatPartlyLanded, whatWasMissing),
    active_need_or_barrier: activeNeedOrBarrier,
    what_partly_landed: whatPartlyLanded,
    what_was_missing: whatWasMissing,
    why_it_mattered_reason: buildWhyItMatteredReason(moment, activeNeedOrBarrier),
    likely_impact: buildLikelyImpact(moment, activeNeedOrBarrier),
    observed_consequence: buildObservedConsequence(turns, moment),
    next_best_move: positive ? null : buildNextBestMove(moment, activeNeedOrBarrier),
    evidence_signals: Object.entries(moment.evidenceData).flatMap(([key, value]) => {
      if (value == null) return [];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return [`${humanizeIdentifier(key)}: ${String(value)}`];
      }
      if (Array.isArray(value) && value.length > 0) {
        return [`${humanizeIdentifier(key)}: ${value.join(", ")}`];
      }
      return [];
    }).slice(0, 6),
    transcript_anchor: context.focusTurn?.content ?? null,
    previous_turn: context.previousTurn
      ? { speaker: context.previousTurn.speaker, content: context.previousTurn.content }
      : null,
    focus_turn: context.focusTurn
      ? { speaker: context.focusTurn.speaker, content: context.focusTurn.content }
      : null,
    next_turn: context.nextTurn
      ? { speaker: context.nextTurn.speaker, content: context.nextTurn.content }
      : null,
  });
}

function buildMomentEntryFromSelection(
  moment: SelectedReviewMoment,
  turns: TranscriptTurn[]
): ReviewEvidenceLedgerMoment {
  const context = getMomentTurnContext(turns, moment.turnIndex);

  return reviewEvidenceLedgerMomentSchema.parse({
    id: `m${moment.turnIndex}`,
    turn_index: moment.turnIndex,
    positive: moment.positive,
    dimension: sentenceCase(stripTrailingPeriod(moment.dimension)),
    evidence_type: sentenceCase(stripTrailingPeriod(moment.evidenceType)),
    headline_hint: sentenceCase(stripTrailingPeriod(moment.headlineHint)) + ".",
    active_need_or_barrier: moment.activeNeedOrBarrier,
    what_partly_landed: moment.whatPartlyLanded,
    what_was_missing: moment.whatWasMissing,
    why_it_mattered_reason: moment.whyItMatteredReason,
    likely_impact: moment.likelyImpact,
    observed_consequence: moment.observedConsequence,
    next_best_move: moment.positive ? null : moment.nextBestMove,
    evidence_signals: [
      `Selection lens: ${stripTrailingPeriod(moment.dimension)}`,
      `Evidence label: ${stripTrailingPeriod(moment.evidenceType)}`,
    ],
    transcript_anchor: context.focusTurn?.content ?? null,
    previous_turn: context.previousTurn
      ? { speaker: context.previousTurn.speaker, content: context.previousTurn.content }
      : null,
    focus_turn: context.focusTurn
      ? { speaker: context.focusTurn.speaker, content: context.focusTurn.content }
      : null,
    next_turn: context.nextTurn
      ? { speaker: context.nextTurn.speaker, content: context.nextTurn.content }
      : null,
  });
}

function addUnique(items: string[], value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return;
  if (!items.includes(trimmed)) {
    items.push(trimmed);
  }
}

function getNegativeMomentPriority(moment: ReviewEvidenceLedgerMoment) {
  switch (moment.evidence_type) {
    case "low substance response":
    case "de escalation harm":
      return 5;
    case "support not requested":
    case "critical no support":
      return 4;
    case "support invoked":
    case "de escalation attempt":
      return 3;
    case "composure marker":
      return 2;
    case "delivery marker":
      return 1;
    default:
      return 2;
  }
}

function getPositiveMomentPriority(moment: ReviewEvidenceLedgerMoment) {
  switch (moment.evidence_type) {
    case "milestone completed":
      return 4;
    case "de escalation attempt":
      return 3;
    case "support invoked":
      return 2;
    case "delivery marker":
      return 1;
    default:
      return 1;
  }
}

function pickFocusMoment(moments: ReviewEvidenceLedgerMoment[]) {
  return [...moments]
    .filter((moment) => !moment.positive)
    .sort((a, b) => {
      const priorityDiff = getNegativeMomentPriority(b) - getNegativeMomentPriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      return b.turn_index - a.turn_index;
    })[0] ?? null;
}

function pickPositiveMoment(moments: ReviewEvidenceLedgerMoment[]) {
  return [...moments]
    .filter((moment) => moment.positive)
    .sort((a, b) => {
      const priorityDiff = getPositiveMomentPriority(b) - getPositiveMomentPriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      return b.turn_index - a.turn_index;
    })[0] ?? null;
}

function buildPatternLedger(
  moments: ReviewEvidenceLedgerMoment[],
  objectiveGaps: string[],
  deliveryAggregate: ReviewEvidenceLedger["delivery_aggregate"],
  outcomeState: ReviewEvidenceLedger["outcome_state"]
): ScenarioPatternLedger {
  const mainMissedMoveCodes: string[] = [];
  const positiveMoveCodes: string[] = [];
  let supportTiming: ScenarioPatternLedger["support_timing"] = "not_needed";

  for (const moment of moments) {
    if (moment.positive) {
      if (moment.evidence_type === "milestone completed") addUnique(positiveMoveCodes, "clinical_task_kept_visible");
      if (moment.evidence_type === "delivery marker") addUnique(positiveMoveCodes, "steady_delivery_under_pressure");
      if (moment.evidence_type === "support invoked") {
        addUnique(positiveMoveCodes, "support_sought_appropriately");
        supportTiming = "appropriate";
      }
      if (moment.active_need_or_barrier?.includes("direct answer")) addUnique(positiveMoveCodes, "direct_question_answered");
      if (
        moment.active_need_or_barrier?.includes("concrete explanation") ||
        moment.active_need_or_barrier?.includes("concrete reason") ||
        moment.active_need_or_barrier?.includes("delay") ||
        moment.active_need_or_barrier?.includes("blocker") ||
        moment.active_need_or_barrier?.includes("discharge")
      ) {
        addUnique(positiveMoveCodes, "specific_explanation");
      }
      if (moment.next_best_move == null && moment.evidence_type === "de escalation attempt") {
        addUnique(positiveMoveCodes, "acknowledgement_landed");
      }
      continue;
    }

    if (moment.evidence_type === "low substance response") {
      addUnique(mainMissedMoveCodes, "direct_question_answered_promptly");
      addUnique(mainMissedMoveCodes, "concrete_next_step");
    }

    if (
      moment.evidence_type === "de escalation harm" ||
      moment.active_need_or_barrier?.includes("concrete explanation") ||
      moment.active_need_or_barrier?.includes("concrete reason") ||
      moment.active_need_or_barrier?.includes("delay") ||
      moment.active_need_or_barrier?.includes("blocker") ||
      moment.active_need_or_barrier?.includes("discharge")
    ) {
      addUnique(mainMissedMoveCodes, "specificity_before_reassurance");
    }

    if (moment.evidence_type === "composure marker" || moment.evidence_type === "delivery marker") {
      addUnique(mainMissedMoveCodes, "steady_delivery_under_pressure");
    }

    if (moment.evidence_type === "support not requested" || moment.evidence_type === "critical no support") {
      addUnique(mainMissedMoveCodes, "support_escalated_appropriately");
      supportTiming = "missed";
    }

    if (moment.evidence_type === "support invoked") {
      addUnique(mainMissedMoveCodes, "support_escalated_appropriately");
      supportTiming = "early";
    }
  }

  const repeatedQuestionAnsweredPromptly =
    positiveMoveCodes.includes("direct_question_answered")
      ? true
      : mainMissedMoveCodes.includes("direct_question_answered_promptly")
        ? false
        : null;
  const specificityBeforeReassurance =
    positiveMoveCodes.includes("specific_explanation")
      ? true
      : mainMissedMoveCodes.includes("specificity_before_reassurance")
        ? false
        : null;

  return scenarioPatternLedgerSchema.parse({
    main_missed_move_codes: mainMissedMoveCodes,
    positive_move_codes: positiveMoveCodes,
    objective_gaps: objectiveGaps,
    repeated_question_answered_promptly: repeatedQuestionAnsweredPromptly,
    specificity_before_reassurance: specificityBeforeReassurance,
    support_timing: supportTiming,
    delivery_pattern_supported_by_audio: deliveryAggregate.supported,
    session_outcome: getSessionOutcome(outcomeState.final_escalation_level, outcomeState.exit_type as ExitType | null),
  });
}

function buildScenarioDemandSummary(
  moments: ReviewEvidenceLedgerMoment[],
  objectiveGaps: string[],
  traits?: ScenarioTraits | null
) {
  const challengingMoment = pickFocusMoment(moments);
  const positiveMoment = pickPositiveMoment(moments);
  const primaryNeed = challengingMoment?.active_need_or_barrier ?? objectiveGaps[0] ?? positiveMoment?.active_need_or_barrier ?? "a concrete answer to the main concern";
  const commonPitfall = challengingMoment?.what_was_missing?.includes("defensive")
    ? challengingMoment?.active_need_or_barrier?.includes("question") || challengingMoment?.active_need_or_barrier?.includes("what happens next")
      ? "sounding defensive before answering the repeated question"
      : "sounding tight before the answer is clear"
    : challengingMoment?.active_need_or_barrier?.includes("delay") || challengingMoment?.active_need_or_barrier?.includes("blocker") || challengingMoment?.active_need_or_barrier?.includes("discharge")
      ? "trying to reassure before clearly saying why the patient could not go home yet"
      : challengingMoment?.what_was_missing?.includes("support")
        ? "one more repair after the support threshold had been crossed"
        : challengingMoment?.active_need_or_barrier?.includes("question")
          ? "a reply that circles around the question instead of answering it"
          : "a reply that stays too general for the main question";
  const successPattern = positiveMoment?.active_need_or_barrier?.includes("delay") || positiveMoment?.active_need_or_barrier?.includes("blocker") || positiveMoment?.active_need_or_barrier?.includes("discharge")
    ? "say why the patient could not go home yet, then explain what would happen next"
    : positiveMoment?.active_need_or_barrier?.includes("question") || positiveMoment?.active_need_or_barrier?.includes("what happens next")
      ? "answer the question in the first line, then add the reason and next step"
      : challengingMoment?.active_need_or_barrier?.includes("support threshold")
        ? "name the safety concern and bring in support without one more repair attempt"
        : objectiveGaps.length > 0
          ? `keep the reply concrete enough to cover ${objectiveGaps[0].toLowerCase()}`
          : "acknowledge the concern, keep the reply concrete, and give one next step";
  const adaptationNote = buildPersonAdaptationNote(traits);

  return {
    primary_need: sentenceCase(stripTrailingPeriod(primaryNeed)) + ".",
    common_pitfall: sentenceCase(stripTrailingPeriod(commonPitfall)) + ".",
    success_pattern: sentenceCase(stripTrailingPeriod(successPattern)) + ".",
    adaptation_note: adaptationNote,
  };
}

function buildSummaryPlan(ledger: ReviewEvidenceLedger): SummaryPlan {
  const focusMoment = pickFocusMoment(ledger.moments);
  const positiveMoment = pickPositiveMoment(ledger.moments);

  return summaryPlanSchema.parse({
    focus_moment_id: focusMoment?.id ?? null,
    positive_moment_id: positiveMoment?.id ?? null,
    main_case_need: focusMoment?.active_need_or_barrier ?? ledger.scenario_demand_summary.primary_need,
    what_partly_landed: focusMoment?.what_partly_landed ?? positiveMoment?.what_partly_landed ?? null,
    what_was_missing: focusMoment?.what_was_missing ?? null,
    why_it_mattered_reason: focusMoment?.why_it_mattered_reason ?? null,
    next_best_move: focusMoment?.next_best_move ?? null,
    delivery_pattern: ledger.delivery_aggregate.supported ? ledger.delivery_aggregate.summary : null,
    objective_gap: ledger.objective_ledger.outstanding_objectives[0] ?? null,
    person_adaptation: ledger.person_adaptation_note ?? ledger.scenario_demand_summary.adaptation_note,
    show_overall_delivery: ledger.delivery_aggregate.supported,
  });
}

function buildTimelinePlans(ledger: ReviewEvidenceLedger) {
  const acceptedPhrases: string[] = [];

  return ledger.moments.map((moment) => {
    const plan = timelinePlanSchema.parse({
      moment_id: moment.id,
      active_need_or_barrier: moment.active_need_or_barrier,
      what_partly_landed: moment.what_partly_landed,
      what_was_missing: moment.what_was_missing,
      why_it_mattered_reason: moment.why_it_mattered_reason,
      observed_consequence: moment.observed_consequence,
      next_best_move: moment.next_best_move,
      banned_phrases: [...acceptedPhrases],
      positive: moment.positive,
    });

    addUnique(acceptedPhrases, normaliseText(moment.why_it_mattered_reason));
    addUnique(acceptedPhrases, normaliseText(moment.next_best_move));

    return plan;
  });
}

function buildSummaryOverview(
  plan: SummaryPlan,
  ledger: ReviewEvidenceLedger
) {
  const overviewParts: string[] = [];

  if (plan.positive_moment_id) {
    const positiveMoment = ledger.moments.find((moment) => moment.id === plan.positive_moment_id) ?? null;
    if (positiveMoment?.what_partly_landed) {
      overviewParts.push(`A useful part of the conversation was that ${stripTrailingPeriod(positiveMoment.what_partly_landed).toLowerCase()}.`);
    }
  }

  if (plan.what_was_missing) {
    const missing = stripTrailingPeriod(plan.what_was_missing).toLowerCase();
    const why = lowerFirst(plan.why_it_mattered_reason);
    if (why) {
      overviewParts.push(`The main problem was that ${missing}, so ${why}.`);
    } else {
      const need = describeNeedPlain(plan.main_case_need);
      if (need && !normaliseText(missing).includes(normaliseText(need))) {
        overviewParts.push(`The main problem was that ${missing}, and ${need} still was not clear enough.`);
      } else {
        overviewParts.push(`The main problem was that ${missing}.`);
      }
    }
  } else if (plan.main_case_need) {
    const need = describeNeedPlain(plan.main_case_need);
    if (need) {
      overviewParts.push(`The main job in this conversation was to explain ${need}.`);
    } else {
      overviewParts.push(`The main job in this conversation was to answer the main concern clearly.`);
    }
  }

  const outcome = getSessionOutcome(
    ledger.outcome_state.final_escalation_level,
    ledger.outcome_state.exit_type as ExitType | null
  );
  if (outcome === "settled") {
    overviewParts.push("It finished on a steadier note.");
  } else if (outcome === "partly_settled") {
    overviewParts.push("It settled somewhat, but some pressure remained.");
  } else if (outcome === "tense") {
    overviewParts.push("It finished with the interaction still tense.");
  } else if (outcome === "highly_strained") {
    overviewParts.push("It finished with the interaction still highly strained.");
  } else if (outcome === "ended_early") {
    overviewParts.push("The session ended early, so there was limited time to repair the interaction.");
  }

  return overviewParts.join(" ").trim();
}

function buildObjectiveFocus(ledger: ReviewEvidenceLedger, plan: SummaryPlan) {
  if (!plan.objective_gap) return null;
  return `Make sure the reply clearly covers this: ${stripTrailingPeriod(plan.objective_gap).toLowerCase()}.`;
}

function buildCoachingFocus(plan: SummaryPlan) {
  if (plan.what_was_missing) {
    return sentenceCase(stripTrailingPeriod(plan.what_was_missing)) + ".";
  }

  if (plan.main_case_need) {
    return sentenceCase(stripTrailingPeriod(plan.main_case_need)) + ".";
  }

  return null;
}

export function buildThinReviewSummary(
  ledger: ReviewEvidenceLedger,
  plan: SummaryPlan
): ReviewSummaryData {
  const positiveMoment = plan.positive_moment_id
    ? ledger.moments.find((moment) => moment.id === plan.positive_moment_id) ?? null
    : null;

  return {
    version: REVIEW_SUMMARY_VERSION,
    source: "fallback",
    overview: buildSummaryOverview(plan, ledger),
    overallDelivery: plan.show_overall_delivery ? ledger.delivery_aggregate.summary : null,
    positiveMoment: positiveMoment?.what_partly_landed ?? null,
    whyItMattered: plan.why_it_mattered_reason,
    coachingFocus: buildCoachingFocus(plan),
    whatToSayInstead: plan.next_best_move,
    objectiveFocus: buildObjectiveFocus(ledger, plan),
    personFocus: plan.person_adaptation,
    achievedObjectives: ledger.objective_ledger.achieved_objectives,
    outstandingObjectives: ledger.objective_ledger.outstanding_objectives,
  };
}

export function buildThinTimelineNarratives(
  ledger: ReviewEvidenceLedger,
  plans: TimelinePlan[],
  turns: TranscriptTurn[],
  sessionStartedAt: string | null | undefined
): GeneratedTimelineNarrative[] {
  return plans.flatMap((plan) => {
    const moment = ledger.moments.find((item) => item.id === plan.moment_id);
    if (!moment) return [];

    const context = getMomentTurnContext(turns, moment.turn_index);

    return [{
      turnIndex: moment.turn_index,
      timecode: formatReviewTimecode(context.focusTurn?.started_at, sessionStartedAt, moment.turn_index),
      lens: moment.dimension,
      headline: moment.headline_hint,
      likelyImpact: moment.likely_impact,
      whatHappenedNext: plan.observed_consequence,
      whyItMattered: plan.why_it_mattered_reason,
      tryInstead: plan.next_best_move,
      positive: plan.positive,
    }];
  });
}

function buildReviewEvidenceBase(context: ReviewArtifactContext) {
  const objectiveCoverage = buildObjectiveCoverage(
    context.score,
    context.milestones ?? [],
    context.learningObjectives
  );
  const deliveryAggregate = buildDeliveryAggregate(
    context.turns,
    context.sessionDeliveryAnalysis ?? null
  );
  const outcomeState = {
    session_valid: context.score.sessionValid,
    turn_count: context.score.turnCount,
    final_escalation_level: context.session.final_escalation_level ?? null,
    exit_type: context.session.exit_type ?? null,
    overall_score: context.score.sessionValid ? context.score.overall : null,
    qualitative_label: context.score.sessionValid ? context.score.qualitativeLabel : null,
  };

  return {
    objectiveCoverage,
    deliveryAggregate,
    outcomeState,
  };
}

export function buildReviewArtifactsEvidenceHash(context: ReviewArtifactContext) {
  const {
    objectiveCoverage,
    deliveryAggregate,
    outcomeState,
  } = buildReviewEvidenceBase(context);

  return createHash("sha256")
    .update(JSON.stringify({
      version: REVIEW_ARTIFACTS_VERSION,
      session_id: context.session.id,
      scenario_id: context.session.scenario_id ?? null,
      scenario_title: context.session.scenario_templates?.title ?? "Simulation",
      objective_ledger: {
        objective_focus: objectiveCoverage.objectiveFocus,
        achieved_objectives: objectiveCoverage.achievedObjectives,
        outstanding_objectives: objectiveCoverage.outstandingObjectives,
      },
      delivery_aggregate: deliveryAggregate,
      outcome_state: outcomeState,
      turns: context.turns.map((turn) => ({
        turn_index: turn.turn_index,
        speaker: turn.speaker,
        content: turn.content,
        started_at: turn.started_at,
      })),
    }))
    .digest("hex")
    .slice(0, 24);
}

export async function buildReviewEvidenceLedger(context: ReviewArtifactContext): Promise<{
  ledger: ReviewEvidenceLedger;
  momentSelectionMeta: ReviewMomentSelectionMeta | null;
}> {
  const {
    objectiveCoverage,
    deliveryAggregate,
    outcomeState,
  } = buildReviewEvidenceBase(context);
  const momentSelection = await generateReviewMoments({
    scenarioTitle: context.session.scenario_templates?.title ?? "Simulation",
    scenarioSetting: context.session.scenario_templates?.setting ?? null,
    aiRole: context.aiRole ?? context.session.scenario_templates?.ai_role ?? null,
    personAdaptationNote: buildPersonAdaptationNote(context.traits ?? null),
    scenarioDemandSummary: {
      primary_need: objectiveCoverage.outstandingObjectives[0] ?? objectiveCoverage.objectiveFocus ?? null,
      common_pitfall: null,
      success_pattern: objectiveCoverage.achievedObjectives[0] ?? null,
      adaptation_note: buildPersonAdaptationNote(context.traits ?? null),
    },
    objectiveLedger: {
      achieved_objectives: objectiveCoverage.achievedObjectives,
      outstanding_objectives: objectiveCoverage.outstandingObjectives,
    },
    deliveryAggregate: {
      supported: deliveryAggregate.supported,
      summary: deliveryAggregate.summary,
    },
    turns: context.turns,
  });
  const moments = momentSelection.moments.map((moment) => (
    buildMomentEntryFromSelection(moment, context.turns)
  ));
  const scenarioDemandSummary = buildScenarioDemandSummary(
    moments,
    objectiveCoverage.outstandingObjectives,
    context.traits ?? null
  );

  return {
    ledger: reviewEvidenceLedgerSchema.parse({
      session_id: context.session.id,
      scenario_title: context.session.scenario_templates?.title ?? "Simulation",
      scenario_setting: context.session.scenario_templates?.setting ?? null,
      trainee_role: context.session.scenario_templates?.trainee_role ?? null,
      ai_role: context.aiRole ?? context.session.scenario_templates?.ai_role ?? null,
      person_adaptation_note: buildPersonAdaptationNote(context.traits ?? null),
      scenario_demand_summary: scenarioDemandSummary,
      objective_ledger: {
        objective_focus: objectiveCoverage.objectiveFocus,
        achieved_objectives: objectiveCoverage.achievedObjectives,
        outstanding_objectives: objectiveCoverage.outstandingObjectives,
      },
      delivery_aggregate: deliveryAggregate,
      outcome_state: outcomeState,
      moments,
      pattern_ledger: buildPatternLedger(
        moments,
        objectiveCoverage.outstandingObjectives,
        deliveryAggregate,
        outcomeState
      ),
    }),
    momentSelectionMeta: momentSelection.meta,
  };
}

export async function buildReviewArtifactsDraft(context: ReviewArtifactContext) {
  const {
    ledger,
    momentSelectionMeta,
  } = await buildReviewEvidenceLedger(context);
  const summaryPlan = buildSummaryPlan(ledger);
  const timelinePlans = buildTimelinePlans(ledger);
  const summaryFallback = buildThinReviewSummary(ledger, summaryPlan);
  const timelineFallback = buildThinTimelineNarratives(
    ledger,
    timelinePlans,
    context.turns,
    context.session.started_at
  );
  const evidenceHash = buildReviewArtifactsEvidenceHash(context);

  return {
    evidenceHash,
    ledger,
    momentSelectionMeta,
    summaryPlan,
    timelinePlans,
    summaryFallback,
    timelineFallback,
  };
}

export function parseStoredReviewArtifacts(value: unknown) {
  const parsed = reviewArtifactsSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.version !== REVIEW_ARTIFACTS_VERSION) return null;

  const summary = parsed.data.summary == null
    ? null
    : reviewSummaryResponseSchema.safeParse(parsed.data.summary).success
      ? reviewSummaryResponseSchema.parse(parsed.data.summary)
      : null;
  const timeline = parsed.data.timeline == null
    ? null
    : reviewTimelineResponseSchema.safeParse(parsed.data.timeline).success
      ? reviewTimelineResponseSchema.parse(parsed.data.timeline)
      : null;

  const reParsed = storedReviewArtifactsSchema.safeParse({
    ...parsed.data,
    summary,
    timeline,
  });
  return reParsed.success ? reParsed.data : null;
}
