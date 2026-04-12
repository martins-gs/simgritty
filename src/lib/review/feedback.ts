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
  overview: string;
  overallDelivery: string | null;
  positiveMoment: string | null;
  coachingFocus: string | null;
  whatToSayInstead: string | null;
  objectiveFocus: string | null;
  personFocus: string | null;
  achievedObjectives: string[];
  outstandingObjectives: string[];
}

const reviewSummaryMomentSchema = z.object({
  turnIndex: z.number().int().min(0),
  timecode: z.string().min(1),
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
  overview: z.string(),
  overallDelivery: z.string().nullable().default(null),
  positiveMoment: z.string().nullable().default(null),
  coachingFocus: z.string().nullable().default(null),
  whatToSayInstead: z.string().nullable().default(null),
  objectiveFocus: z.string().nullable().default(null),
  personFocus: z.string().nullable().default(null),
  achievedObjectives: z.array(z.string()).max(6).default([]),
  outstandingObjectives: z.array(z.string()).max(6).default([]),
});

export const reviewSummaryRequestSchema = z.object({
  scenarioTitle: z.string().min(1),
  learningObjectives: z.string().nullable().optional(),
  backstory: z.string().nullable().optional(),
  emotionalDriver: z.string().nullable().optional(),
  personSummary: z.string().nullable().optional(),
  finalEscalationLevel: z.number().int().min(1).max(10).nullable().optional(),
  exitType: z.string().nullable().optional(),
  fallback: reviewSummaryResponseSchema,
  achievedObjectives: z.array(z.string()).max(6).optional().default([]),
  outstandingObjectives: z.array(z.string()).max(6).optional().default([]),
  moments: z.array(reviewSummaryMomentSchema).max(6),
});

export type ReviewSummaryMomentInput = z.infer<typeof reviewSummaryMomentSchema>;
export type ReviewSummaryRequest = z.infer<typeof reviewSummaryRequestSchema>;
export type ReviewSummaryResponse = z.infer<typeof reviewSummaryResponseSchema>;

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

function formatSpeakerLabel(speaker: TranscriptTurn["speaker"] | string): string {
  if (speaker === "trainee") return "You";
  if (speaker === "system") return "AI clinician";
  return "Patient/relative";
}

function quoteTurn(turn: TranscriptTurn | null) {
  if (!turn?.content) return null;
  return turn.content.trim();
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

function getTryInsteadText(moment: ScoreEvidence): string | null {
  switch (moment.evidenceType) {
    case "de_escalation_harm":
    case "composure_marker":
    case "low_substance_response":
      return "Lead with the emotion, then name the immediate barrier and the next step in concrete terms.";
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

function getComposureNarrative(turn: TranscriptTurn | null, moment: ScoreEvidence) {
  const markers = Array.isArray(moment.evidenceData.markers)
    ? (moment.evidenceData.markers as string[]).map(humanizeIdentifier)
    : [];
  const markerText = markers.length > 0
    ? markers.join(", ")
    : "defensive or dismissive";

  return {
    headline: "This may have landed as defensive.",
    likelyImpact: getReasoningOrFallback(
      turn,
      `Parts of this response may have come across as ${markerText}, which can make it harder for the other person to feel heard.`
    ),
    whyItMattered: "In a distressed exchange, people usually need acknowledgement before they can take in explanation or boundaries.",
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

function getDeEscalationNarrative(turn: TranscriptTurn | null, moment: ScoreEvidence) {
  const effective = moment.evidenceData.effective === true;
  const technique = typeof moment.evidenceData.technique === "string"
    ? humanizeIdentifier(moment.evidenceData.technique)
    : "de-escalation";

  if (moment.evidenceType === "de_escalation_harm") {
    return {
      headline: "This likely raised tension.",
      likelyImpact: getReasoningOrFallback(
        turn,
        `This response appeared to raise tension rather than settle it, even if it was trying to move the conversation forward.`
      ),
      whyItMattered: "When the person is highly distressed, a move that is technically reasonable can still escalate things if it comes before acknowledgement.",
    };
  }

  if (effective) {
    return {
      headline: `This ${technique} move seemed to help.`,
      likelyImpact: getReasoningOrFallback(
        turn,
        `This sounded like a constructive ${technique} move and likely helped the person feel more contained.`
      ),
      whyItMattered: "Once the other person feels understood, it becomes easier to keep the conversation workable.",
    };
  }

  return {
    headline: `This ${technique} move was a reasonable attempt, but it did not fully land.`,
    likelyImpact: getReasoningOrFallback(
      turn,
      `The intention here was helpful, but it does not seem to have been enough to shift the conversation.`
    ),
    whyItMattered: "A partial repair still matters, but if the distress stays high you often need clearer acknowledgement or a more concrete next step.",
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
  const { focusTurn } = getMomentTurnContext(turns, moment.turnIndex);
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
      narrative = getComposureNarrative(focusTurn, moment);
      break;
    case "delivery_marker":
      narrative = getDeliveryNarrative(focusTurn, moment);
      break;
    case "de_escalation_attempt":
    case "de_escalation_harm":
      narrative = getDeEscalationNarrative(focusTurn, moment);
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
    tryInstead: getTryInsteadText(moment),
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

function summarizeCoachingFocus(args: {
  challengingMoment: ReviewMomentNarrative | null;
  objectiveFocus: string | null;
  personFocus: string | null;
}) {
  const { challengingMoment, objectiveFocus, personFocus } = args;
  return challengingMoment?.whyItMattered ?? objectiveFocus ?? personFocus;
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
      overview: "This session ended before there was enough trainee speech to build a full coaching summary. The transcript and reflection are still available below.",
      overallDelivery: null,
      positiveMoment: null,
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
    overviewParts.push(
      `You found a steadier moment around ${positiveMoment.timecode}, where ${stripTrailingPeriod(positiveMoment.likelyImpact).toLowerCase()}.`
    );
  }

  if (challengingMoment) {
    overviewParts.push(
      `The key turning point came around ${challengingMoment.timecode}, where ${stripTrailingPeriod(challengingMoment.likelyImpact).toLowerCase()}.`
    );
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
    overview: overviewParts.join(" "),
    overallDelivery,
    positiveMoment: summarizePositiveMoment(positiveMoment),
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
