import type { ScoreBreakdown, ScoreEvidence } from "@/lib/engine/scoring";
import { ESCALATION_LABELS } from "@/types/escalation";
import type { ScenarioMilestone, ScenarioTraits } from "@/types/scenario";
import type {
  ExitType,
  SimulationSession,
  TranscriptTurn,
  TraineeDeliveryAnalysis,
  TraineeDeliveryMarker,
} from "@/types/simulation";
import { z } from "zod";

export interface ReviewTurnContext {
  previousTurn: TranscriptTurn | null;
  focusTurn: TranscriptTurn | null;
  nextTurn: TranscriptTurn | null;
}

export interface ReviewMomentNarrative {
  timecode: string;
  headline: string;
  likelyImpact: string;
  whatHappenedNext: string;
  whyItMattered: string;
  tryInstead: string | null;
  positive: boolean;
  turnIndex: number;
}

export interface ReviewSummaryData {
  version: number;
  source: "generated" | "fallback";
  overview: string;
  overallDelivery: string | null;
  positiveMoment: string | null;
  whyItMattered: string | null;
  coachingFocus: string | null;
  whatToSayInstead: string | null;
  objectiveFocus: string | null;
  personFocus: string | null;
  achievedObjectives: string[];
  outstandingObjectives: string[];
}

export const REVIEW_SUMMARY_VERSION = 6;

const reviewScenarioTraitsSchema = z.object({
  hostility: z.number().min(0).max(10),
  frustration: z.number().min(0).max(10),
  impatience: z.number().min(0).max(10),
  trust: z.number().min(0).max(10),
  willingness_to_listen: z.number().min(0).max(10),
  sarcasm: z.number().min(0).max(10),
  bias_intensity: z.number().min(0).max(10),
  bias_category: z.string().default("none"),
  volatility: z.number().min(0).max(10),
  boundary_respect: z.number().min(0).max(10),
  coherence: z.number().min(0).max(10),
  repetition: z.number().min(0).max(10),
  entitlement: z.number().min(0).max(10),
  interruption_likelihood: z.number().min(0).max(10),
  escalation_tendency: z.number().min(0).max(10),
});

const reviewMilestoneSchema = z.object({
  id: z.string(),
  order: z.number().int().nonnegative(),
  description: z.string().min(1).max(160),
  classifier_hint: z.string().max(300).default(""),
});

const reviewSummaryMomentSchema = z.object({
  turnIndex: z.number().int().min(0),
  timecode: z.string().min(1),
  dimension: z.string().min(1),
  evidenceType: z.string().min(1),
  evidenceSignals: z.array(z.string()).max(8).default([]),
  positive: z.boolean(),
  whatTraineeSaid: z.string().nullable(),
  previousTurn: z.object({
    speaker: z.string(),
    content: z.string(),
  }).nullable(),
  nextTurn: z.object({
    speaker: z.string(),
    content: z.string(),
  }).nullable(),
  likelyImpact: z.string(),
  whatHappenedNext: z.string(),
  whyItMattered: z.string(),
  tryInstead: z.string().nullable(),
});

export const reviewSummaryResponseSchema = z.object({
  version: z.number().int().default(REVIEW_SUMMARY_VERSION),
  source: z.enum(["generated", "fallback"]).default("generated"),
  overview: z.string().describe("One or two short sentences summarising the overall arc of the conversation."),
  overallDelivery: z.string().nullable().default(null).describe("Optional conversation-level summary of how the trainee sounded overall."),
  positiveMoment: z.string().nullable().default(null).describe("Specific helpful move from this case worth repeating."),
  whyItMattered: z.string().nullable().default(null).describe("Why the main difficulty mattered in this exact interaction, as an explanation rather than an instruction."),
  coachingFocus: z.string().nullable().default(null).describe("The main coaching takeaway from this case, phrased as one specific learning point."),
  whatToSayInstead: z.string().nullable().default(null).describe("A short behavioural prompt or tightly case-specific model line for the next attempt."),
  objectiveFocus: z.string().nullable().default(null).describe("Optional concise scenario-objective point that matters for this case."),
  personFocus: z.string().nullable().default(null).describe("Optional concise person-specific adaptation point that matters for this case."),
  achievedObjectives: z.array(z.string()).max(6).default([]),
  outstandingObjectives: z.array(z.string()).max(6).default([]),
});

export const reviewSummaryRequestSchema = z.object({
  scenarioTitle: z.string().min(1),
  scenarioSetting: z.string().nullable().optional(),
  traineeRole: z.string().nullable().optional(),
  aiRole: z.string().nullable().optional(),
  learningObjectives: z.string().nullable().optional(),
  backstory: z.string().nullable().optional(),
  emotionalDriver: z.string().nullable().optional(),
  traits: reviewScenarioTraitsSchema.nullable().optional(),
  milestones: z.array(reviewMilestoneSchema).max(12).optional().default([]),
  personSummary: z.string().nullable().optional(),
  finalEscalationLevel: z.number().int().min(1).max(10).nullable().optional(),
  exitType: z.string().nullable().optional(),
  fallback: reviewSummaryResponseSchema,
  achievedObjectives: z.array(z.string()).max(6).optional().default([]),
  outstandingObjectives: z.array(z.string()).max(6).optional().default([]),
  moments: z.array(reviewSummaryMomentSchema).max(6),
});

export const generatedTimelineNarrativeSchema = z.object({
  turnIndex: z.number().int().min(0),
  timecode: z.string().min(1),
  lens: z.string().nullable().default(null),
  headline: z.string(),
  likelyImpact: z.string(),
  whatHappenedNext: z.string(),
  whyItMattered: z.string(),
  tryInstead: z.string().nullable().default(null),
  positive: z.boolean(),
});

export const reviewTimelineResponseSchema = z.object({
  version: z.number().int().default(REVIEW_SUMMARY_VERSION),
  narratives: z.array(generatedTimelineNarrativeSchema).max(12).default([]),
});

export const reviewDebugSchema = z.object({
  ok: z.boolean(),
  message: z.string().nullable().default(null),
  promptVersion: z.string().nullable().default(null),
  schemaVersion: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  reasoningEffort: z.string().nullable().default(null),
  fallbackUsed: z.boolean().default(false),
  failureClass: z.enum(["parse", "schema", "semantic", "duplication", "provenance"]).nullable().default(null),
  validatorFailures: z.array(z.string()).default([]),
});

export const reviewSummaryApiResponseSchema = z.object({
  summary: reviewSummaryResponseSchema.nullable().default(null),
  debug: reviewDebugSchema,
});

export const reviewTimelineApiResponseSchema = z.object({
  timeline: reviewTimelineResponseSchema.nullable().default(null),
  debug: reviewDebugSchema,
});

export type ReviewSummaryMomentInput = z.infer<typeof reviewSummaryMomentSchema>;
export type ReviewSummaryRequest = z.infer<typeof reviewSummaryRequestSchema>;
export type ReviewSummaryResponse = z.infer<typeof reviewSummaryResponseSchema>;
export type GeneratedTimelineNarrative = z.infer<typeof generatedTimelineNarrativeSchema>;
export type ReviewTimelineResponse = z.infer<typeof reviewTimelineResponseSchema>;
export type ReviewDebug = z.infer<typeof reviewDebugSchema>;
export type ReviewSummaryApiResponse = z.infer<typeof reviewSummaryApiResponseSchema>;
export type ReviewTimelineApiResponse = z.infer<typeof reviewTimelineApiResponseSchema>;

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

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function stripTrailingPeriod(value: string): string {
  return value.trim().replace(/[. ]+$/, "");
}

function formatList(items: string[], conjunction: "and" | "or" = "and") {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

function humanizeIdentifier(value: string) {
  return value.replace(/_/g, " ");
}

export function getStoredReviewSummaryVersion(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return 0;
  }

  const version = (value as Record<string, unknown>).version;
  return typeof version === "number" && Number.isFinite(version) ? version : 0;
}

export function getStoredReviewSummarySource(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return "fallback" as const;
  }

  const source = (value as Record<string, unknown>).source;
  return source === "generated" || source === "fallback" ? source : "fallback";
}

function formatSpeakerLabel(speaker: TranscriptTurn["speaker"] | string): string {
  if (speaker === "trainee") return "You";
  if (speaker === "system") return "AI clinician";
  return "Patient/relative";
}

function quoteTurn(turn: TranscriptTurn | null) {
  if (!turn?.content) return null;
  return turn.content.trim();
}

function buildMomentEvidenceSignals(moment: ScoreEvidence): string[] {
  const signals: string[] = [];

  if (moment.dimension) {
    signals.push(`Scoring dimension: ${humanizeIdentifier(moment.dimension)}`);
  }

  if (moment.evidenceType) {
    signals.push(`Evidence type: ${humanizeIdentifier(moment.evidenceType)}`);
  }

  const markers = Array.isArray(moment.evidenceData.markers)
    ? (moment.evidenceData.markers as string[])
      .map((marker) => humanizeIdentifier(marker))
      .filter(Boolean)
    : [];
  if (markers.length > 0) {
    signals.push(`Markers noticed: ${formatList(markers)}`);
  }

  const technique = typeof moment.evidenceData.technique === "string"
    ? humanizeIdentifier(moment.evidenceData.technique)
    : typeof moment.evidenceData.de_escalation_technique === "string"
      ? humanizeIdentifier(moment.evidenceData.de_escalation_technique)
      : null;
  if (technique) {
    signals.push(`Technique label: ${technique}`);
  }

  if (typeof moment.evidenceData.description === "string" && moment.evidenceData.description.trim()) {
    signals.push(`Clinical objective involved: ${stripTrailingPeriod(moment.evidenceData.description)}`);
  }

  if (typeof moment.evidenceData.effective === "boolean") {
    signals.push(`Technique judged ${moment.evidenceData.effective ? "effective" : "not fully effective"}`);
  }

  if (typeof moment.evidenceData.appropriate === "boolean") {
    signals.push(`Support timing judged ${moment.evidenceData.appropriate ? "appropriate" : "early"}`);
  }

  if (typeof moment.evidenceData.levelBefore === "number") {
    signals.push(`Escalation before the turn: ${ESCALATION_LABELS[moment.evidenceData.levelBefore] ?? `level ${moment.evidenceData.levelBefore}`}`);
  }

  if (typeof moment.evidenceData.summary === "string" && moment.evidenceData.summary.trim()) {
    signals.push(`Delivery summary: ${stripTrailingPeriod(moment.evidenceData.summary)}`);
  }

  return signals.slice(0, 8);
}

function getSortedTurns(turns: TranscriptTurn[]) {
  return [...turns].sort((a, b) => a.turn_index - b.turn_index);
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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

function scoreDeliveryMarkers(markers: TraineeDeliveryMarker[]) {
  let score = 0;

  for (const marker of markers) {
    if (marker === "warm_empathic") {
      score += 2;
      continue;
    }

    if (marker === "calm_measured") {
      score += 1;
      continue;
    }

    if (STRONG_NEGATIVE_DELIVERY_MARKERS.has(marker)) {
      score -= 2;
      continue;
    }

    score -= 1;
  }

  return score;
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

function buildOverallDeliverySummary(turns: TranscriptTurn[]) {
  const deliveryMoments = getSortedTurns(turns).flatMap((turn) => {
    if (turn.speaker !== "trainee") return [];

    const analysis = getTurnDeliveryAnalysis(turn);
    if (!analysis) return [];

    const markers = [...new Set(analysis.markers)];
    if (markers.length === 0) return [];

    return [{
      markers,
      score: scoreDeliveryMarkers(markers),
    }];
  });

  if (deliveryMoments.length < 2) {
    return null;
  }

  const positiveTurns = deliveryMoments.filter((moment) => moment.score > 0).length;
  const negativeTurns = deliveryMoments.filter((moment) => moment.score < 0).length;
  if (positiveTurns === 0 && negativeTurns === 0) {
    return null;
  }

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

  if (
    deliveryMoments.length >= 3 &&
    firstHalfAverage >= 0 &&
    secondHalfAverage <= -0.75 &&
    negativeTurns >= 2
  ) {
    return `Across the conversation, your delivery started steadier but became ${negativeDescriptor} once the pressure rose.`;
  }

  if (
    deliveryMoments.length >= 3 &&
    firstHalfAverage <= -0.75 &&
    secondHalfAverage >= 0.5 &&
    positiveTurns >= 2
  ) {
    return `Across the conversation, your delivery sounded tighter early on, then became ${positiveDescriptor} as the exchange settled.`;
  }

  if (negativeTurns >= 2 && (totalScore <= -2 || strongNegativeHits >= 2)) {
    return `Across the conversation, your delivery often sounded ${negativeDescriptor}, which may have made the message harder to receive.`;
  }

  if (positiveTurns >= 2 && negativeTurns === 0 && totalScore >= 2) {
    return `Across the conversation, your delivery stayed ${positiveDescriptor}, which likely helped the message land more easily.`;
  }

  if (positiveTurns >= 2 && negativeTurns === 1 && totalScore >= 2) {
    return `Across the conversation, your delivery was mostly ${positiveDescriptor}, even though it tightened briefly under pressure.`;
  }

  if (negativeTurns >= 2 && positiveTurns === 1 && totalScore <= -2) {
    return `Across the conversation, there were steadier moments, but your delivery more often sounded ${negativeDescriptor}.`;
  }

  return null;
}

function getCompletedMilestoneIds(score: ScoreBreakdown) {
  return new Set(
    score.evidence.flatMap((item) => (
      item.evidenceType === "milestone_completed" && typeof item.evidenceData.milestoneId === "string"
        ? [item.evidenceData.milestoneId]
        : []
    ))
  );
}

function parseObjectiveLines(learningObjectives: string | null | undefined) {
  if (!learningObjectives) return [];

  return learningObjectives
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

export function getMomentTurnContext(
  turns: TranscriptTurn[],
  turnIndex: number
): ReviewTurnContext {
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
    focusTurn: sortedTurns[focusIndex],
    nextTurn: focusIndex < sortedTurns.length - 1 ? sortedTurns[focusIndex + 1] : null,
  };
}

export function formatReviewTimecode(
  startedAt: string | null | undefined,
  sessionStartedAt: string | null | undefined,
  fallbackTurnIndex?: number
): string {
  if (!startedAt || !sessionStartedAt) {
    return fallbackTurnIndex != null ? `Turn ${fallbackTurnIndex + 1}` : "Key moment";
  }

  const deltaSeconds = Math.max(
    0,
    Math.floor((new Date(startedAt).getTime() - new Date(sessionStartedAt).getTime()) / 1000)
  );
  const minutes = Math.floor(deltaSeconds / 60);
  const seconds = deltaSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function findNextPatientTurn(turns: TranscriptTurn[], turnIndex: number) {
  const sortedTurns = getSortedTurns(turns);
  return sortedTurns.find((turn) => turn.turn_index > turnIndex && turn.speaker === "ai") ?? null;
}

function describeOutcomeShift(
  turns: TranscriptTurn[],
  moment: ScoreEvidence
): string {
  const nextPatientTurn = findNextPatientTurn(turns, moment.turnIndex);
  const levelBefore = typeof moment.evidenceData.levelBefore === "number"
    ? moment.evidenceData.levelBefore
    : null;
  const levelAfter = nextPatientTurn?.state_after?.level ?? null;

  if (!nextPatientTurn) {
    return "The conversation ended before the response to this moment was fully clear.";
  }

  if (levelBefore != null && levelAfter != null) {
    if (levelAfter < levelBefore) {
      return `The next reply sounded steadier, and the conversation eased from ${ESCALATION_LABELS[levelBefore] ?? `level ${levelBefore}`} to ${ESCALATION_LABELS[levelAfter] ?? `level ${levelAfter}`}.`;
    }

    if (levelAfter > levelBefore) {
      return `The next reply stayed heated, and the conversation moved from ${ESCALATION_LABELS[levelBefore] ?? `level ${levelBefore}`} to ${ESCALATION_LABELS[levelAfter] ?? `level ${levelAfter}`}.`;
    }

    return `The next reply did not show much recovery, and the conversation stayed around ${ESCALATION_LABELS[levelAfter] ?? `level ${levelAfter}`}.`;
  }

  const nextTurnQuote = quoteTurn(nextPatientTurn);
  if (!nextTurnQuote) {
    return "The next patient/relative reply did not suggest a clear recovery.";
  }

  return `The next patient/relative reply was: "${nextTurnQuote}".`;
}

function inferConcernPhrase(...turns: Array<TranscriptTurn | null>) {
  const text = turns
    .flatMap((turn) => turn?.content ? [turn.content.toLowerCase()] : [])
    .join(" ");

  if (!text) return null;
  if (text.includes("discharge")) return "the discharge plan";
  if (text.includes("go home") || text.includes("home")) return "going home";
  if (text.includes("delay") || text.includes("wait") || text.includes("waiting")) return "the delay";
  if (text.includes("safe") || text.includes("unsafe") || text.includes("risk")) return "the safety concern";
  if (text.includes("pain")) return "the pain concern";
  if (text.includes("why")) return "the reason for the problem";
  if (text.includes("when")) return "what happens next";
  if (text.includes("question") || text.includes("?")) return "the direct question";
  return "the main concern";
}

function getTryInsteadText(
  moment: ScoreEvidence,
  context: ReviewTurnContext
): string | null {
  const concernPhrase = inferConcernPhrase(context.previousTurn, context.focusTurn, context.nextTurn);
  const concernObject = concernPhrase ? ` ${concernPhrase}` : " the main concern";
  const markers = Array.isArray(moment.evidenceData.markers)
    ? new Set((moment.evidenceData.markers as string[]).map((marker) => humanizeIdentifier(marker)))
    : new Set<string>();

  switch (moment.evidenceType) {
    case "de_escalation_harm":
      return `Start with the emotion behind${concernObject}, then explain the barrier and next step in one contained reply.`;
    case "composure_marker":
      if (markers.has("defensive tone") || markers.has("defensive language")) {
        return `Lower the defensiveness first: acknowledge${concernObject}, then give one clear explanation or next step.`;
      }
      if (markers.has("tense hurried") || markers.has("anxious unsteady")) {
        return `Slow the opening and acknowledge${concernObject} before you move into explanation.`;
      }
      return `Acknowledge${concernObject} first, then give the barrier and next step in concrete terms.`;
    case "low_substance_response":
      return `Answer${concernObject} directly, then explain the barrier and next step in concrete terms.`;
    case "support_not_requested":
    case "critical_no_support":
      return "State the safety concern clearly and bring a colleague in straight away.";
    case "support_invoked":
      return moment.evidenceData.appropriate === false
        ? "Pause long enough to find the main concern first, then decide whether extra help is actually needed."
        : null;
    case "de_escalation_attempt":
      return moment.evidenceData.effective === false
        ? "Name the emotion or concern more directly, then invite the person to say what is driving it."
        : null;
    default:
      return null;
  }
}

function getReasoningOrFallback(
  turn: TranscriptTurn | null,
  fallback: string
): string {
  const reasoning = turn?.classifier_result?.reasoning?.trim();
  if (!reasoning) return fallback;
  return sentenceCase(stripTrailingPeriod(reasoning)) + ".";
}

function getComposureNarrative(context: ReviewTurnContext, moment: ScoreEvidence) {
  const markers = Array.isArray(moment.evidenceData.markers)
    ? (moment.evidenceData.markers as string[]).map(humanizeIdentifier)
    : [];
  const markerText = markers.length > 0
    ? markers.join(", ")
    : "defensive or dismissive";
  const concernPhrase = inferConcernPhrase(context.previousTurn, context.focusTurn, context.nextTurn);

  return {
    headline: "This may have landed as defensive.",
    likelyImpact: getReasoningOrFallback(
      context.focusTurn,
      `Parts of this response may have come across as ${markerText}, which can make it harder for the other person to feel heard.`
    ),
    whyItMattered: concernPhrase
      ? `Because the other person was still looking for clarity about ${concernPhrase}, a response that sounded ${markerText} made it harder for the explanation to land.`
      : `Because the other person was still distressed, a response that sounded ${markerText} made it harder for acknowledgement or explanation to land.`,
  };
}

function getDeliveryNarrative(turn: TranscriptTurn | null, moment: ScoreEvidence) {
  const summary = typeof moment.evidenceData.summary === "string"
    ? moment.evidenceData.summary
    : null;
  const positive = moment.scoreImpact > 0;

  if (positive) {
    return {
      headline: "Your delivery sounded steadier here.",
      likelyImpact: summary
        ? sentenceCase(stripTrailingPeriod(summary)) + "."
        : "Your tone likely helped the message feel calmer and easier to receive.",
      whyItMattered: "When the delivery sounds grounded, it becomes easier for a distressed person to stay engaged with what you are saying.",
    };
  }

  return {
    headline: "Your delivery may have added pressure here.",
    likelyImpact: summary
      ? sentenceCase(stripTrailingPeriod(summary)) + "."
      : "The delivery likely sounded tense or reactive, which can make even reasonable wording land badly.",
    whyItMattered: "The emotional tone often lands before the content does, especially when someone already feels threatened or angry.",
  };
}

function getDeEscalationNarrative(context: ReviewTurnContext, moment: ScoreEvidence) {
  const effective = moment.evidenceData.effective === true;
  const technique = typeof moment.evidenceData.technique === "string"
    ? humanizeIdentifier(moment.evidenceData.technique)
    : "de-escalation";
  const concernPhrase = inferConcernPhrase(context.previousTurn, context.focusTurn, context.nextTurn);

  if (moment.evidenceType === "de_escalation_harm") {
    return {
      headline: "This likely raised tension.",
      likelyImpact: getReasoningOrFallback(
        context.focusTurn,
        `This response appeared to raise tension rather than settle it, even if it was trying to move the conversation forward.`
      ),
      whyItMattered: concernPhrase
        ? `The other person was still activated around ${concernPhrase}, so moving to problem-solving before acknowledgement was unlikely to settle the exchange.`
        : "When someone is highly distressed, a technically reasonable move can still escalate things if it comes before acknowledgement.",
    };
  }

  if (effective) {
    return {
      headline: `This ${technique} move seemed to help.`,
      likelyImpact: getReasoningOrFallback(
        context.focusTurn,
        `This sounded like a constructive ${technique} move and likely helped the person feel more contained.`
      ),
      whyItMattered: concernPhrase
        ? `Once the other person felt more understood about ${concernPhrase}, it became easier for the conversation to stay workable.`
        : "Once the other person feels understood, it becomes easier to keep the conversation workable.",
    };
  }

  return {
    headline: `This ${technique} move was a reasonable attempt, but it did not fully land.`,
    likelyImpact: getReasoningOrFallback(
      context.focusTurn,
      `The intention here was helpful, but it does not seem to have been enough to shift the conversation.`
    ),
    whyItMattered: concernPhrase
      ? `A partial repair still matters, but while the person was still stuck on ${concernPhrase}, the acknowledgement or next step needed to be clearer.`
      : "A partial repair still matters, but if distress stays high you often need clearer acknowledgement or a more concrete next step.",
  };
}

function getSupportNarrative(moment: ScoreEvidence) {
  const levelValue = moment.evidenceData.escalationLevel;
  const level = typeof levelValue === "number" ? levelValue : null;
  const levelLabel = level != null
    ? ESCALATION_LABELS[level] ?? `level ${level}`
    : "this stage";

  if (moment.evidenceType === "support_invoked" && moment.evidenceData.appropriate === true) {
    return {
      headline: "Bringing in support looked like the right call.",
      likelyImpact: `By this point the interaction had reached ${levelLabel}, and asking for help likely protected both the conversation and the people in it.`,
      whyItMattered: "Good support-seeking is part of skilled communication, not a failure of it.",
    };
  }

  if (moment.evidenceType === "support_invoked") {
    return {
      headline: "Support came in earlier than it needed to.",
      likelyImpact: `The interaction had not clearly reached the point where extra support was necessary, so this may have interrupted the chance to repair it yourself.`,
      whyItMattered: "Calling for help too early can close down opportunities to practise containment and explanation.",
    };
  }

  return {
    headline: "This was the point to consider extra support.",
    likelyImpact: `By ${levelLabel}, continuing alone likely made the conversation harder to contain safely.`,
    whyItMattered: "Once the interaction crosses a certain threshold, the coaching goal shifts from persuasion to safety and containment.",
  };
}

function getMilestoneNarrative(moment: ScoreEvidence) {
  const description = typeof moment.evidenceData.description === "string"
    ? moment.evidenceData.description
    : null;

  return {
    headline: "You kept the clinical task moving.",
    likelyImpact: description
      ? `You still addressed the practical issue here: ${description}.`
      : "You managed to keep hold of the practical clinical task rather than losing it completely to the conflict.",
    whyItMattered: "Good communication is not just about calming things down; it also means moving the care task forward safely.",
  };
}

export function buildReviewMomentNarrative(
  moment: ScoreEvidence,
  turns: TranscriptTurn[],
  sessionStartedAt: string | null | undefined
): ReviewMomentNarrative {
  const context = getMomentTurnContext(turns, moment.turnIndex);
  const { focusTurn } = context;
  const positive =
    moment.scoreImpact > 0 ||
    moment.evidenceType === "milestone_completed" ||
    (moment.evidenceType === "de_escalation_attempt" && moment.evidenceData.effective === true);

  let narrative: {
    headline: string;
    likelyImpact: string;
    whyItMattered: string;
  };

  switch (moment.evidenceType) {
    case "composure_marker":
    case "low_substance_response":
      narrative = getComposureNarrative(context, moment);
      break;
    case "delivery_marker":
      narrative = getDeliveryNarrative(focusTurn, moment);
      break;
    case "de_escalation_attempt":
    case "de_escalation_harm":
      narrative = getDeEscalationNarrative(context, moment);
      break;
    case "support_invoked":
    case "support_not_requested":
    case "critical_no_support":
      narrative = getSupportNarrative(moment);
      break;
    case "milestone_completed":
      narrative = getMilestoneNarrative(moment);
      break;
    default:
      narrative = {
        headline: positive ? "This looked helpful." : "This seemed to work against you.",
        likelyImpact: getReasoningOrFallback(
          focusTurn,
          positive
            ? "This moment likely helped keep the conversation workable."
            : "This moment likely made the conversation harder to settle."
        ),
        whyItMattered: "Small communication moves can change what happens next in a distressed exchange.",
      };
      break;
  }

  return {
    timecode: formatReviewTimecode(focusTurn?.started_at, sessionStartedAt, moment.turnIndex),
    headline: narrative.headline,
    likelyImpact: narrative.likelyImpact,
    whatHappenedNext: describeOutcomeShift(turns, moment),
    whyItMattered: narrative.whyItMattered,
    tryInstead: getTryInsteadText(moment, context),
    positive,
    turnIndex: moment.turnIndex,
  };
}

export function buildObjectiveCoverage(
  score: ScoreBreakdown,
  milestones: ScenarioMilestone[],
  learningObjectives: string | null | undefined
) {
  const completedMilestoneIds = getCompletedMilestoneIds(score);
  const authoredMilestones = [...milestones]
    .sort((a, b) => a.order - b.order)
    .map((milestone) => ({
      id: milestone.id,
      description: milestone.description,
    }));
  const achievedObjectives = authoredMilestones
    .filter((milestone) => completedMilestoneIds.has(milestone.id))
    .map((milestone) => milestone.description);
  const outstandingObjectives = authoredMilestones
    .filter((milestone) => !completedMilestoneIds.has(milestone.id))
    .map((milestone) => milestone.description);
  const fallbackLearningObjectives = parseObjectiveLines(learningObjectives)
    .filter((objective) => !achievedObjectives.includes(objective));

  if (authoredMilestones.length > 0) {
    if (outstandingObjectives.length === 0) {
      return {
        objectiveFocus:
          "This scenario also asked you to keep the clinical task moving as well as managing the emotion, and those authored milestones did come through in the conversation.",
        achievedObjectives,
        outstandingObjectives,
      };
    }

    if (achievedObjectives.length === 0) {
      return {
        objectiveFocus: `This scenario was also testing whether you would ${formatList(outstandingObjectives.map((item) => item.charAt(0).toLowerCase() + item.slice(1)))}. Those task moves did not come through clearly here, so most of the work stayed at the level of emotional containment.`,
        achievedObjectives,
        outstandingObjectives,
      };
    }

    return {
      objectiveFocus: `This scenario was also testing whether you would ${formatList(authoredMilestones.map((item) => item.description.charAt(0).toLowerCase() + item.description.slice(1)))}. You did show ${formatList(achievedObjectives.map((item) => item.charAt(0).toLowerCase() + item.slice(1)))}, but ${formatList(outstandingObjectives.map((item) => item.charAt(0).toLowerCase() + item.slice(1)))} stayed unclear.`,
      achievedObjectives,
      outstandingObjectives,
    };
  }

  if (fallbackLearningObjectives.length > 0) {
    return {
      objectiveFocus: `This scenario was not only about tone. It also called for evidence that you ${formatList(fallbackLearningObjectives.map((item) => item.charAt(0).toLowerCase() + item.slice(1)))}.`,
      achievedObjectives,
      outstandingObjectives: fallbackLearningObjectives,
    };
  }

  return {
    objectiveFocus: null,
    achievedObjectives,
    outstandingObjectives,
  };
}

export function buildPersonaGuidance(args: {
  aiRole: string | null | undefined;
  backstory: string | null | undefined;
  emotionalDriver: string | null | undefined;
  traits: ScenarioTraits | null | undefined;
}) {
  const { aiRole, backstory, emotionalDriver, traits } = args;
  const roleLabel = aiRole?.trim() || "person";

  if (!traits && !backstory && !emotionalDriver) {
    return null;
  }

  const descriptors: string[] = [];
  const tailoredMoves: string[] = [];

  if (emotionalDriver?.trim()) {
    descriptors.push(`driven by ${stripTrailingPeriod(emotionalDriver).toLowerCase()}`);
  }

  if (traits) {
    if (traits.trust <= 3) descriptors.push("starting from low trust");
    if (traits.frustration >= 7 && traits.hostility < 7) descriptors.push("more distressed and frustrated than openly aggressive");
    if (traits.hostility >= 7) descriptors.push("liable to become openly hostile");
    if (traits.entitlement >= 7) descriptors.push("expecting quick action and clear answers");
    if (traits.interruption_likelihood >= 7) descriptors.push("likely to interrupt if responses feel too long");
    if (traits.bias_intensity > 0 && traits.bias_category !== "none") {
      descriptors.push(`showing prejudice around ${humanizeIdentifier(traits.bias_category)}`);
    }

    if (traits.frustration >= 7 || traits.trust <= 3) {
      tailoredMoves.push("lead with acknowledgement before explanation or boundaries");
    }
    if (traits.impatience >= 7 || traits.interruption_likelihood >= 7) {
      tailoredMoves.push("keep responses short, signposted, and easy to interrupt safely");
    }
    if (traits.repetition >= 6) {
      tailoredMoves.push("answer the repeated concern directly before adding new information");
    }
    if (traits.boundary_respect <= 3 || traits.hostility >= 7) {
      tailoredMoves.push("set calm, specific limits without matching the tone");
    }
    if (traits.entitlement >= 7) {
      tailoredMoves.push("be explicit about what you can do now and what you cannot do yet");
    }
    if (traits.bias_intensity > 0 && traits.bias_category !== "none") {
      tailoredMoves.push("set boundaries on discriminatory remarks and refocus on care or safety");
    }
  }

  const summaryLead = descriptors.length > 0
    ? `This ${roleLabel.toLowerCase()} came in ${formatList(descriptors)}.`
    : backstory?.trim()
      ? `This ${roleLabel.toLowerCase()} came in with a specific backstory that should have shaped your approach.`
      : `This ${roleLabel.toLowerCase()} needed an approach tailored to the case setup.`;

  const backstoryLead = backstory?.trim()
    ? ` The backstory matters here: ${stripTrailingPeriod(backstory)}.`
    : "";
  const approachLead = tailoredMoves.length > 0
    ? ` With someone like this, it often helps to ${formatList(tailoredMoves)}.`
    : "";

  return `${summaryLead}${backstoryLead}${approachLead}`.trim();
}

function getEndingPhrase(finalLevel: number | null | undefined, exitType: ExitType | null | undefined) {
  if (exitType === "instant_exit") {
    return "The session ended early, so there was limited time to repair the interaction.";
  }

  if (finalLevel == null) {
    return "The ending did not show a fully clear resolution.";
  }

  if (finalLevel <= 2) {
    return "It finished on a much steadier note.";
  }

  if (finalLevel <= 4) {
    return "It settled somewhat by the end, but some tension still remained.";
  }

  if (finalLevel <= 6) {
    return "It finished with the interaction still tense and only partly contained.";
  }

  return "It finished with the interaction still highly strained.";
}

function summarizePositiveMoment(moment: ReviewMomentNarrative | null) {
  if (!moment) return null;
  return sentenceCase(stripTrailingPeriod(moment.likelyImpact)) + ".";
}

function summarizeOverviewFromNarrative(
  moment: ReviewMomentNarrative | null,
  prefix: string
) {
  if (!moment) return null;
  return `${prefix} ${stripTrailingPeriod(moment.likelyImpact).toLowerCase()}.`;
}

function summarizeCoachingFocus(args: {
  challengingMoment: ReviewMomentNarrative | null;
  objectiveFocus: string | null;
  personFocus: string | null;
}) {
  const { challengingMoment, objectiveFocus, personFocus } = args;
  if (challengingMoment?.tryInstead) {
    return sentenceCase(stripTrailingPeriod(challengingMoment.tryInstead)) + ".";
  }

  return challengingMoment?.likelyImpact ?? objectiveFocus ?? personFocus;
}

export function buildFallbackReviewSummary(
  session: SimulationSession,
  score: ScoreBreakdown,
  turns: TranscriptTurn[],
  keyMoments: ScoreEvidence[],
  options?: {
    milestones?: ScenarioMilestone[];
    learningObjectives?: string | null | undefined;
    aiRole?: string | null | undefined;
    backstory?: string | null | undefined;
    emotionalDriver?: string | null | undefined;
    traits?: ScenarioTraits | null | undefined;
  }
): ReviewSummaryData {
  if (!score.sessionValid) {
    return {
      version: REVIEW_SUMMARY_VERSION,
      source: "fallback",
      overview: "This session ended before there was enough trainee speech to build a full coaching summary. The transcript and reflection are still available below.",
      overallDelivery: null,
      positiveMoment: null,
      whyItMattered: null,
      coachingFocus: null,
      whatToSayInstead: null,
      objectiveFocus: null,
      personFocus: null,
      achievedObjectives: [],
      outstandingObjectives: [],
    };
  }

  const narratives = keyMoments
    .map((moment) => buildReviewMomentNarrative(moment, turns, session.started_at))
    .sort((a, b) => a.turnIndex - b.turnIndex);
  const positiveMoment = narratives.find((moment) => moment.positive) ?? null;
  const challengingMoment = [...narratives].reverse().find((moment) => !moment.positive) ?? null;

  const overviewParts: string[] = [];

  if (positiveMoment) {
    overviewParts.push(summarizeOverviewFromNarrative(
      positiveMoment,
      "There was a steadier phase where"
    )!);
  }

  if (challengingMoment) {
    overviewParts.push(summarizeOverviewFromNarrative(
      challengingMoment,
      positiveMoment
        ? "The main difficulty was that"
        : "The main difficulty in this conversation was that"
    )!);
  }

  overviewParts.push(getEndingPhrase(session.final_escalation_level, session.exit_type));

  const objectiveCoverage = buildObjectiveCoverage(
    score,
    options?.milestones ?? [],
    options?.learningObjectives
  );
  const overallDelivery = buildOverallDeliverySummary(turns);
  const personFocus = buildPersonaGuidance({
    aiRole: options?.aiRole,
    backstory: options?.backstory,
    emotionalDriver: options?.emotionalDriver,
    traits: options?.traits ?? null,
  });

  return {
    version: REVIEW_SUMMARY_VERSION,
    source: "fallback",
    overview: overviewParts.join(" "),
    overallDelivery,
    positiveMoment: summarizePositiveMoment(positiveMoment),
    whyItMattered: challengingMoment?.whyItMattered ?? objectiveCoverage.objectiveFocus ?? personFocus,
    coachingFocus: summarizeCoachingFocus({
      challengingMoment,
      objectiveFocus: objectiveCoverage.objectiveFocus,
      personFocus,
    }),
    whatToSayInstead: challengingMoment?.tryInstead ?? null,
    objectiveFocus: objectiveCoverage.objectiveFocus,
    personFocus,
    achievedObjectives: objectiveCoverage.achievedObjectives,
    outstandingObjectives: objectiveCoverage.outstandingObjectives,
  };
}

export function buildReviewSummaryMomentInput(
  moment: ScoreEvidence,
  turns: TranscriptTurn[],
  sessionStartedAt: string | null | undefined
): ReviewSummaryMomentInput {
  const context = getMomentTurnContext(turns, moment.turnIndex);
  const narrative = buildReviewMomentNarrative(moment, turns, sessionStartedAt);

  return {
    turnIndex: moment.turnIndex,
    timecode: narrative.timecode,
    dimension: humanizeIdentifier(moment.dimension),
    evidenceType: humanizeIdentifier(moment.evidenceType),
    evidenceSignals: buildMomentEvidenceSignals(moment),
    positive: narrative.positive,
    whatTraineeSaid: quoteTurn(context.focusTurn),
    previousTurn: context.previousTurn
      ? {
          speaker: formatSpeakerLabel(context.previousTurn.speaker),
          content: context.previousTurn.content,
        }
      : null,
    nextTurn: context.nextTurn
      ? {
          speaker: formatSpeakerLabel(context.nextTurn.speaker),
          content: context.nextTurn.content,
        }
      : null,
    likelyImpact: narrative.likelyImpact,
    whatHappenedNext: narrative.whatHappenedNext,
    whyItMattered: narrative.whyItMattered,
    tryInstead: narrative.tryInstead,
  };
}
