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
    id: "emotion_first",
    positiveLabel: "acknowledging emotion earlier",
    primaryGuidance: "Make acknowledgement your first move before explanation, so the other person can take in the rest.",
    secondaryGuidance: "When the pressure rises, name the emotion or concern earlier instead of trying to solve it immediately.",
    practiceCue: "On the next attempt, make your first sentence an acknowledgement of the emotion or concern before you explain anything else.",
    keywords: ["acknowledg", "emotion", "distress", "upsetting", "frustrat", "angry", "hear how", "validate", "empath"],
    dimension: "deEscalation",
    requiresRecurrence: false,
  },
  {
    id: "barrier_next_step",
    positiveLabel: "explaining the barrier and next step more clearly",
    primaryGuidance: "After acknowledging the concern, explain the barrier and next step more clearly in the same reply.",
    secondaryGuidance: "Keep the response concrete: what is happening, what you can do now, and what comes next.",
    practiceCue: "On the next attempt, practise one reply that names the barrier and the next step in plain, concrete language.",
    keywords: ["explain", "barrier", "next step", "what is happening", "plan", "specific", "clear", "update", "practical"],
    dimension: "clinicalTask",
    requiresRecurrence: false,
  },
  {
    id: "delivery_under_pressure",
    positiveLabel: "keeping the delivery steadier under pressure",
    primaryGuidance: "Keep the opening of your reply slower and less defensive so the message can land under pressure.",
    secondaryGuidance: "Watch for pace, tightness, or defensiveness once you are challenged; that is when the wording starts to lose impact.",
    practiceCue: "On the next attempt, slow the first line of your reply and keep it shorter so the tone stays steadier under pressure.",
    keywords: ["calm", "steady", "steadier", "delivery", "composure", "defensive", "guarded", "hesitant", "hurried", "tight", "tense", "measured", "pace"],
    dimension: "composure",
    requiresRecurrence: true,
  },
  {
    id: "care_issue",
    positiveLabel: "staying anchored to the care issue",
    primaryGuidance: "Bring the conversation back to the immediate care issue sooner so the practical task does not disappear into the conflict.",
    secondaryGuidance: "Hold onto the concrete care problem while you manage the emotion, instead of treating them as separate jobs.",
    practiceCue: "On the next attempt, bring the conversation back to the immediate care issue within the same reply that acknowledges the emotion.",
    keywords: ["discharge", "safety", "care", "clinical", "immediate issue", "barrier", "functional", "social"],
    dimension: "clinicalTask",
    requiresRecurrence: false,
  },
  {
    id: "boundaries",
    positiveLabel: "setting clearer boundaries without matching the tone",
    primaryGuidance: "Set calmer, clearer boundaries without matching the tone when the interaction turns hostile.",
    secondaryGuidance: "Use a short limit-setting line, then refocus on care or safety rather than arguing with the tone.",
    practiceCue: "On the next attempt, practise one short boundary line that stays calm and then returns to care or safety.",
    keywords: ["boundary", "boundaries", "limit", "limits", "discrimin", "remark"],
    dimension: "composure",
    requiresRecurrence: false,
  },
  {
    id: "support",
    positiveLabel: "judging support needs more deliberately",
    primaryGuidance: "Decide earlier whether this has crossed into a support-seeking moment instead of staying in solo repair mode too long.",
    secondaryGuidance: "When the safety threshold is reached, bring in support promptly rather than trying one more explanation.",
    practiceCue: "On the next attempt, decide the point where you would bring in support, and act there rather than one turn later.",
    keywords: ["support", "colleague", "senior", "help"],
    dimension: "supportSeeking",
    requiresRecurrence: false,
  },
] as const;

type ThemeDefinition = (typeof THEME_DEFINITIONS)[number];

const scenarioHistoryCoachResponseSchema = z.object({
  totalSessions: z.number().int().min(1),
  sessionLabel: z.string(),
  headline: z.string(),
  progress: z.string(),
  primaryTarget: z.string(),
  secondaryPatterns: z.array(z.string()).max(2).default([]),
  practiceTarget: z.string(),
});

export type ScenarioHistoryCoachResponse = z.infer<typeof scenarioHistoryCoachResponseSchema>;

const DIMENSION_META = [
  {
    key: "composure",
    label: "composure",
    description: "keeping your delivery steady under pressure",
    fallbackTarget: "Keep one calm, structured reply under pressure so the message does not start to sound defensive.",
    fallbackPractice: "On the next attempt, hold to one calm reply: acknowledge the concern, explain the barrier, then give the next step.",
  },
  {
    key: "deEscalation",
    label: "de-escalation",
    description: "lowering the emotional temperature",
    fallbackTarget: "Make acknowledgement your first move before explanation, so the other person can take in the rest.",
    fallbackPractice: "On the next attempt, make your first sentence an acknowledgement of the emotion or concern before you explain anything else.",
  },
  {
    key: "clinicalTask",
    label: "clinical task",
    description: "bringing the conversation back to the care issue",
    fallbackTarget: "Keep the practical barrier and next step clearer in the same reply, so the care task does not go missing.",
    fallbackPractice: "On the next attempt, answer with one short acknowledgement, one clear barrier, and one specific next step.",
  },
  {
    key: "supportSeeking",
    label: "support seeking",
    description: "judging when to bring in support",
    fallbackTarget: "Decide earlier when the interaction has crossed into a support-seeking moment, rather than trying one more repair.",
    fallbackPractice: "On the next attempt, pick the point where you would involve support, and act there instead of one turn later.",
  },
] as const;

type DimensionMeta = (typeof DIMENSION_META)[number];
type ThemeSignal = {
  theme: ThemeDefinition;
  sessionHits: number;
  currentHit: boolean;
  score: number;
  eligible: boolean;
};

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getDimensionValue(score: ScoreBreakdown, key: DimensionMeta["key"]) {
  if (key === "clinicalTask") {
    return score.clinicalTask;
  }

  return score[key];
}

function includesThemeKeyword(text: string, theme: ThemeDefinition) {
  return theme.keywords.some((keyword) => text.includes(keyword));
}

function getPositiveThemeLabel(texts: string[]) {
  const counts = THEME_DEFINITIONS.map((theme) => ({
    label: theme.positiveLabel,
    count: texts.filter((text) => includesThemeKeyword(text, theme)).length,
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
    session.reviewSummary.whyItMattered,
    session.reviewSummary.coachingFocus,
    session.reviewSummary.objectiveFocus,
    session.reviewSummary.personFocus,
    session.reviewSummary.whatToSayInstead,
    session.reviewSummary.overallDelivery,
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

function getSortedCurrentDimensions(current: ScenarioHistorySessionInput) {
  return DIMENSION_META.flatMap((dimension) => {
    const value = getDimensionValue(current.score, dimension.key);
    return value == null ? [] : [{ ...dimension, value }];
  }).sort((a, b) => a.value - b.value);
}

function getWeakestCurrentDimension(current: ScenarioHistorySessionInput) {
  return getSortedCurrentDimensions(current)[0] ?? null;
}

function themeAppearsInSession(
  session: ScenarioHistorySessionInput,
  theme: ThemeDefinition
) {
  return normalizeCoachingTexts(session).some((text) => includesThemeKeyword(text, theme));
}

function rankThemeSignals(
  sessions: ScenarioHistorySessionInput[],
  current: ScenarioHistorySessionInput,
  weakestDimension: ReturnType<typeof getWeakestCurrentDimension>
) {
  const currentTexts = normalizeCoachingTexts(current);

  return THEME_DEFINITIONS
    .map((theme) => {
      const sessionHits = sessions.filter((session) => themeAppearsInSession(session, theme)).length;
      const currentHit = currentTexts.some((text) => includesThemeKeyword(text, theme));
      const weakestBoost = weakestDimension?.key === theme.dimension ? 1 : 0;
      const eligible = theme.requiresRecurrence
        ? sessionHits >= 2 && (currentHit || weakestBoost > 0)
        : sessionHits >= 1 || currentHit || weakestBoost > 0;

      return {
        theme,
        sessionHits,
        currentHit,
        score: sessionHits * 3 + (currentHit ? 2 : 0) + weakestBoost,
        eligible,
      };
    })
    .filter((signal) => signal.eligible)
    .sort((a, b) => b.score - a.score || b.sessionHits - a.sessionHits);
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

function getFallbackTargetFromDimension(
  weakestDimension: ReturnType<typeof getWeakestCurrentDimension>
) {
  return weakestDimension?.fallbackTarget
    ?? "Keep the next target narrow: one calmer opening, one clearer explanation, or one firmer boundary.";
}

function getFallbackPracticeTargetFromDimension(
  weakestDimension: ReturnType<typeof getWeakestCurrentDimension>
) {
  return weakestDimension?.fallbackPractice
    ?? "On the next attempt, aim for one calm reply that acknowledges the emotion, names the barrier, and gives the next step in your own words.";
}

function isDistinctPattern(candidate: string, existing: string[]) {
  const normalizedCandidate = candidate.trim().toLowerCase();
  if (!normalizedCandidate) return false;

  return !existing.some((item) => {
    const normalizedExisting = item.trim().toLowerCase();
    return (
      normalizedExisting === normalizedCandidate ||
      normalizedExisting.includes(normalizedCandidate) ||
      normalizedCandidate.includes(normalizedExisting)
    );
  });
}

function addPattern(
  items: string[],
  candidate: string | null | undefined,
  existing: string[],
  limit = 2
) {
  const value = candidate?.trim();
  if (!value || items.length >= limit || !isDistinctPattern(value, existing)) {
    return;
  }

  items.push(value);
  existing.push(value);
}

function buildPrimaryTarget(
  totalSessions: number,
  current: ScenarioHistorySessionInput,
  sessions: ScenarioHistorySessionInput[],
  weakestDimension: ReturnType<typeof getWeakestCurrentDimension>
) {
  const rankedThemes = rankThemeSignals(sessions, current, weakestDimension);
  const primaryTheme = rankedThemes[0] ?? null;

  if (primaryTheme) {
    return {
      text: primaryTheme.theme.primaryGuidance,
      theme: primaryTheme.theme,
      rankedThemes,
    };
  }

  if (totalSessions <= 1) {
    const currentCoachingFocus = current.reviewSummary?.coachingFocus?.trim();
    if (currentCoachingFocus) {
      return {
        text: currentCoachingFocus,
        theme: null,
        rankedThemes,
      };
    }
  }

  return {
    text: getFallbackTargetFromDimension(weakestDimension),
    theme: null,
    rankedThemes,
  };
}

function buildSecondaryPatterns(
  totalSessions: number,
  current: ScenarioHistorySessionInput,
  primaryTarget: string,
  rankedThemes: ThemeSignal[]
) {
  const patterns: string[] = [];
  const existing = [primaryTarget];

  addPattern(patterns, current.reviewSummary?.objectiveFocus, existing, 2);
  addPattern(patterns, current.reviewSummary?.personFocus, existing, 2);

  if (totalSessions <= 1) {
    return patterns;
  }

  for (const signal of rankedThemes) {
    if (patterns.length >= 2) break;
    if (signal.sessionHits < 2) continue;
    if (signal.theme.requiresRecurrence && signal.sessionHits < 2) continue;
    if (!isDistinctPattern(signal.theme.secondaryGuidance, existing)) continue;

    patterns.push(signal.theme.secondaryGuidance);
    existing.push(signal.theme.secondaryGuidance);
  }

  return patterns.slice(0, 2);
}

function buildPracticeTargetFromSuggestion(suggestedLine: string) {
  const normalized = suggestedLine.toLowerCase();

  if (
    normalized.includes("colleague") ||
    normalized.includes("help us with this now") ||
    normalized.includes("extra help")
  ) {
    return "On the next attempt, practise naming the safety concern clearly and bringing in support without delay.";
  }

  if (
    normalized.includes("angry") ||
    normalized.includes("unacceptable") ||
    normalized.includes("most urgent") ||
    normalized.includes("what is driving")
  ) {
    return "On the next attempt, practise naming the emotion or concern first, then inviting the person to say what is driving it.";
  }

  if (
    normalized.includes("upsetting") ||
    normalized.includes("what is happening") ||
    normalized.includes("question") ||
    normalized.includes("barrier") ||
    normalized.includes("delay") ||
    normalized.includes("next step")
  ) {
    return "On the next attempt, practise the sequence rather than the script: acknowledge the emotion, name the barrier, and give the next step in your own words.";
  }

  return "On the next attempt, practise the underlying move in your own words rather than memorising a script.";
}

function buildPracticeTarget(
  current: ScenarioHistorySessionInput,
  primaryTheme: ThemeDefinition | null,
  weakestDimension: ReturnType<typeof getWeakestCurrentDimension>
) {
  const suggestedLine = current.reviewSummary?.whatToSayInstead?.trim();
  if (suggestedLine) {
    return buildPracticeTargetFromSuggestion(suggestedLine);
  }

  if (primaryTheme) {
    return primaryTheme.practiceCue;
  }

  return getFallbackPracticeTargetFromDimension(weakestDimension);
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
      primaryTarget: "Keep the next target narrow: one calmer opening, one clearer explanation, or one firmer boundary.",
      secondaryPatterns: [],
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
  const weakestDimension = getWeakestCurrentDimension(currentSession);
  const primaryTarget = buildPrimaryTarget(
    totalSessionCount,
    currentSession,
    sortedSessions,
    weakestDimension
  );
  const secondaryPatterns = buildSecondaryPatterns(
    totalSessionCount,
    currentSession,
    primaryTarget.text,
    primaryTarget.rankedThemes
  );

  return scenarioHistoryCoachResponseSchema.parse({
    totalSessions: Math.max(1, totalSessionCount),
    sessionLabel: totalSessionCount <= 1
      ? "1 non-deleted session in this scenario"
      : `${totalSessionCount} non-deleted sessions in this scenario`,
    headline: buildHeadline(totalSessionCount, overallTrend),
    progress: buildProgressParagraph(totalSessionCount, currentSession, previousSessions, positiveThemeLabel),
    primaryTarget: primaryTarget.text,
    secondaryPatterns,
    practiceTarget: buildPracticeTarget(currentSession, primaryTarget.theme, weakestDimension),
  });
}

export { scenarioHistoryCoachResponseSchema };
