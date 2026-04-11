import type { ScoreBreakdown } from "@/lib/engine/scoring";
import type { ReviewSummaryData } from "@/lib/review/feedback";
import { z } from "zod";

interface ScenarioHistorySessionInput {
  id: string;
  createdAt: string;
  score: ScoreBreakdown;
  reviewSummary: ReviewSummaryData | null;
}

const THEME_DEFINITIONS = [
  {
    positiveLabel: "acknowledging emotion earlier",
    coachingLabel: "acknowledging the emotion before moving into explanation",
    keywords: ["acknowledg", "emotion", "distress", "upsetting", "frustrat", "angry", "hear how", "validate", "empath"],
  },
  {
    positiveLabel: "explaining the barrier and next step more clearly",
    coachingLabel: "pairing acknowledgement with a clear barrier and next step",
    keywords: ["explain", "barrier", "next step", "what is happening", "plan", "specific", "clear", "update", "practical"],
  },
  {
    positiveLabel: "keeping the delivery steadier under pressure",
    coachingLabel: "keeping the delivery calm and non-defensive under pressure",
    keywords: ["calm", "steady", "steadier", "delivery", "composure", "defensive", "guarded", "hesitant"],
  },
  {
    positiveLabel: "staying anchored to the care issue",
    coachingLabel: "bringing the conversation back to the immediate care issue",
    keywords: ["discharge", "safety", "care", "clinical", "immediate issue", "barrier", "functional", "social"],
  },
  {
    positiveLabel: "setting clearer boundaries without matching the tone",
    coachingLabel: "setting calm boundaries without getting pulled into the tone",
    keywords: ["boundary", "boundaries", "limit", "limits", "discrimin", "remark"],
  },
  {
    positiveLabel: "judging support needs more deliberately",
    coachingLabel: "bringing in support at the right moment",
    keywords: ["support", "colleague", "senior", "help"],
  },
] as const;

const scenarioHistoryCoachResponseSchema = z.object({
  totalSessions: z.number().int().min(1),
  sessionLabel: z.string(),
  headline: z.string(),
  progress: z.string(),
  development: z.string(),
  practiceTarget: z.string(),
});

export type ScenarioHistoryCoachResponse = z.infer<typeof scenarioHistoryCoachResponseSchema>;

const DIMENSION_META = [
  {
    key: "composure",
    label: "composure",
    description: "keeping your delivery steady under pressure",
  },
  {
    key: "deEscalation",
    label: "de-escalation",
    description: "lowering the emotional temperature",
  },
  {
    key: "clinicalTask",
    label: "clinical task",
    description: "bringing the conversation back to the care issue",
  },
  {
    key: "supportSeeking",
    label: "support seeking",
    description: "judging when to bring in support",
  },
] as const;

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getDimensionValue(score: ScoreBreakdown, key: (typeof DIMENSION_META)[number]["key"]) {
  if (key === "clinicalTask") {
    return score.clinicalTask;
  }

  return score[key];
}

function getPositiveThemeLabel(texts: string[]) {
  const counts = THEME_DEFINITIONS.map((theme) => ({
    label: theme.positiveLabel,
    count: texts.filter((text) => theme.keywords.some((keyword) => text.includes(keyword))).length,
  }));
  const bestMatch = counts.sort((a, b) => b.count - a.count)[0];
  return bestMatch?.count ? bestMatch.label : null;
}

function getCoachingThemeLabel(texts: string[]) {
  const counts = THEME_DEFINITIONS.map((theme) => ({
    label: theme.coachingLabel,
    count: texts.filter((text) => theme.keywords.some((keyword) => text.includes(keyword))).length,
  }));
  const bestMatch = counts.sort((a, b) => b.count - a.count)[0];
  return bestMatch?.count ? bestMatch.label : null;
}

function normalizePositiveTexts(session: ScenarioHistorySessionInput | undefined | null) {
  if (!session?.reviewSummary) return [];

  return [
    session.reviewSummary.overview,
    session.reviewSummary.positiveMoment,
  ].flatMap((value) => (
    typeof value === "string" && value.trim()
      ? [value.trim().toLowerCase()]
      : []
  ));
}

function normalizeCoachingTexts(session: ScenarioHistorySessionInput | undefined | null) {
  if (!session?.reviewSummary) return [];

  return [
    session.reviewSummary.coachingFocus,
    session.reviewSummary.objectiveFocus,
    session.reviewSummary.personFocus,
    session.reviewSummary.whatToSayInstead,
  ].flatMap((value) => (
    typeof value === "string" && value.trim()
      ? [value.trim().toLowerCase()]
      : []
  ));
}

function getBestImprovement(
  current: ScenarioHistorySessionInput,
  previous: ScenarioHistorySessionInput[]
) {
  const deltas = DIMENSION_META.flatMap((dimension) => {
    const currentValue = getDimensionValue(current.score, dimension.key);
    if (currentValue == null) return [];

    const previousAverage = average(
      previous.flatMap((session) => {
        const value = getDimensionValue(session.score, dimension.key);
        return value == null ? [] : [value];
      })
    );
    if (previousAverage == null) return [];

    return [{
      ...dimension,
      delta: currentValue - previousAverage,
    }];
  });

  if (deltas.length === 0) return null;
  return deltas.sort((a, b) => b.delta - a.delta)[0];
}

function getWeakestCurrentDimension(current: ScenarioHistorySessionInput) {
  const dimensions = DIMENSION_META.flatMap((dimension) => {
    const value = getDimensionValue(current.score, dimension.key);
    return value == null ? [] : [{ ...dimension, value }];
  });

  if (dimensions.length === 0) return null;
  return dimensions.sort((a, b) => a.value - b.value)[0];
}

function buildHeadline(totalSessions: number, overallTrend: number | null) {
  if (totalSessions <= 1) {
    return "This is your first recorded run of this scenario, so use it as a starting point rather than a final judgement.";
  }

  if (overallTrend != null && overallTrend >= 8) {
    return `Across ${totalSessions} sessions in this scenario, you are sounding more settled and more usable under pressure.`;
  }

  if (overallTrend != null && overallTrend >= 3) {
    return `Across ${totalSessions} sessions, there is steady progress here, even if it is not fully consistent yet.`;
  }

  if (overallTrend != null && overallTrend <= -5) {
    return `Across ${totalSessions} sessions, the same pressure points are still making this conversation harder than it needs to be.`;
  }

  return `Across ${totalSessions} sessions, the picture is mixed: there are gains here, but they are not yet showing up consistently.`;
}

function buildProgressParagraph(
  totalSessions: number,
  current: ScenarioHistorySessionInput,
  previous: ScenarioHistorySessionInput[],
  positiveThemeLabel: string | null
) {
  if (totalSessions <= 1) {
    return positiveThemeLabel
      ? `There is already something useful to build on: this summary points to ${positiveThemeLabel}. Keep that, because it gives you a real base for the next run.`
      : "There is already something useful to build on: parts of this summary suggest you can steady the tone once you slow yourself down.";
  }

  const bestImprovement = getBestImprovement(current, previous);
  if (bestImprovement && bestImprovement.delta >= 5) {
    return positiveThemeLabel
      ? `Your clearest shift is in ${bestImprovement.label}, and the summaries are increasingly noticing ${positiveThemeLabel}.`
      : `Your clearest shift is in ${bestImprovement.label}, which suggests you are starting to repeat the right move more reliably.`;
  }

  if (bestImprovement && bestImprovement.delta >= 2) {
    return positiveThemeLabel
      ? `There is some movement in the right direction, especially around ${positiveThemeLabel}, but it still needs to happen earlier and more consistently.`
      : `There is some movement in the right direction, but the same good move still needs to happen earlier and more consistently.`;
  }

  return "The summaries show glimpses of the right response, but the gain is not yet strong enough to call it a reliable shift.";
}

function buildDevelopmentParagraph(
  totalSessions: number,
  current: ScenarioHistorySessionInput,
  coachingThemeLabel: string | null
) {
  const weakestDimension = getWeakestCurrentDimension(current);

  if (totalSessions <= 1) {
    if (coachingThemeLabel) {
      return `The next step is ${coachingThemeLabel}. That is the move to practise until it starts to feel automatic rather than late.`;
    }

    return "The next step is to acknowledge the emotion, explain the main barrier, and give the next step in one calm sequence.";
  }

  if (coachingThemeLabel && weakestDimension) {
    return `Keep working on ${coachingThemeLabel}. That theme is still showing up across your sessions, and it links closely to ${weakestDimension.description}.`;
  }

  if (coachingThemeLabel) {
    return `Keep working on ${coachingThemeLabel}. That is the thread that still needs to become more consistent across your attempts.`;
  }

  if (weakestDimension) {
    return `The main development edge is ${weakestDimension.description}. That is where a little more structure would make the biggest difference next time.`;
  }

  return "The main development edge is still consistency: do the helpful move earlier, and hold onto it once the pressure rises.";
}

function buildPracticeTarget(
  current: ScenarioHistorySessionInput,
  coachingThemeLabel: string | null
) {
  const suggestedLine = current.reviewSummary?.whatToSayInstead?.trim();
  if (suggestedLine) {
    return `On the next attempt, practise leading with something as concrete as: “${suggestedLine}”`;
  }

  if (coachingThemeLabel) {
    return `On the next attempt, make ${coachingThemeLabel} your first deliberate move, not your recovery move.`;
  }

  return "On the next attempt, aim for one calm sentence that acknowledges the emotion, names the barrier, and gives the next step.";
}

export function buildScenarioHistoryCoachSummary(
  sessions: ScenarioHistorySessionInput[],
  currentSessionId: string,
  totalSessionCount: number
): ScenarioHistoryCoachResponse {
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const currentSession = sortedSessions.find((session) => session.id === currentSessionId) ?? sortedSessions.at(-1);

  if (!currentSession) {
    return {
      totalSessions: Math.max(1, totalSessionCount),
      sessionLabel: totalSessionCount <= 1
        ? "1 non-deleted session in this scenario"
        : `${totalSessionCount} non-deleted sessions in this scenario`,
      headline: "Use repeated runs of this scenario to turn one coaching point into a habit.",
      progress: "Look for the moment where the tone starts to tip, because that is usually where the most useful learning sits.",
      development: "Keep the next target narrow: one calmer opening, one clearer explanation, or one firmer boundary.",
      practiceTarget: "On the next attempt, choose one phrase you want to say more clearly and use it earlier.",
    };
  }

  const previousSessions = sortedSessions.filter(
    (session) => session.id !== currentSession.id && session.score.sessionValid
  );
  const overallTrend = currentSession.score.sessionValid
    ? currentSession.score.overall - (average(previousSessions.map((session) => session.score.overall)) ?? currentSession.score.overall)
    : null;
  const positiveThemeLabel = getPositiveThemeLabel(
    sortedSessions.flatMap((session) => normalizePositiveTexts(session))
  );
  const coachingThemeLabel = getCoachingThemeLabel(
    sortedSessions.flatMap((session) => normalizeCoachingTexts(session))
  );

  return scenarioHistoryCoachResponseSchema.parse({
    totalSessions: Math.max(1, totalSessionCount),
    sessionLabel: totalSessionCount <= 1
      ? "1 non-deleted session in this scenario"
      : `${totalSessionCount} non-deleted sessions in this scenario`,
    headline: buildHeadline(totalSessionCount, overallTrend),
    progress: buildProgressParagraph(totalSessionCount, currentSession, previousSessions, positiveThemeLabel),
    development: buildDevelopmentParagraph(totalSessionCount, currentSession, coachingThemeLabel),
    practiceTarget: buildPracticeTarget(currentSession, coachingThemeLabel),
  });
}

export { scenarioHistoryCoachResponseSchema };
