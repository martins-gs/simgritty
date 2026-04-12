import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import {
  scenarioHistoryCoachResponseSchema,
  type ScenarioHistoryCoachResponse,
} from "@/lib/review/history";
import type { ReviewSummaryData } from "@/lib/review/feedback";
import type { ScoreBreakdown } from "@/lib/engine/scoring";
import type { ScenarioTraits } from "@/types/scenario";

const SCENARIO_HISTORY_MODEL = process.env.OPENAI_SCENARIO_HISTORY_MODEL || "gpt-5.4";
const SCENARIO_HISTORY_MAX_OUTPUT_TOKENS = 1400;
const SCENARIO_HISTORY_RETRY_MAX_OUTPUT_TOKENS = 2200;

interface ScenarioHistoryCoachInput {
  scenarioTitle: string;
  scenarioSetting?: string | null;
  traineeRole?: string | null;
  aiRole?: string | null;
  learningObjectives?: string | null;
  backstory?: string | null;
  emotionalDriver?: string | null;
  traits?: ScenarioTraits | null;
  currentSessionId: string;
  totalSessionCount: number;
  sessions: Array<{
    id: string;
    createdAt: string;
    score: ScoreBreakdown;
    reviewSummary: ReviewSummaryData | null;
  }>;
}

function formatScenarioTraits(traits?: ScenarioTraits | null) {
  if (!traits) return null;

  return [
    `- Trust: ${traits.trust}/10`,
    `- Frustration: ${traits.frustration}/10`,
    `- Hostility: ${traits.hostility}/10`,
    `- Impatience: ${traits.impatience}/10`,
    `- Boundary respect: ${traits.boundary_respect}/10`,
    `- Repetition: ${traits.repetition}/10`,
    `- Entitlement: ${traits.entitlement}/10`,
    `- Interruption likelihood: ${traits.interruption_likelihood}/10`,
    `- Bias intensity: ${traits.bias_intensity}/10`,
    `- Bias category: ${traits.bias_category}`,
  ].join("\n");
}

function isStructuredOutputParseError(error: unknown) {
  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /unterminated string in json|unexpected end of json|json/i.test(message);
}

async function requestParsedHistorySummary(
  prompt: string,
  maxOutputTokens: number
): Promise<ScenarioHistoryCoachResponse | null> {
  const client = getOpenAIClient();
  if (!client) {
    if (shouldFailLoudOnOpenAIError()) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    return null;
  }

  const response = await client.responses.parse({
    model: SCENARIO_HISTORY_MODEL,
    instructions: `You are writing the "Review your progress" panel for repeated runs of one clinical communication scenario.

The goal is to give a learner a useful picture of progress without overwhelming them.

Coaching approach:
- Use British English.
- Sound like a skilled educator tracking patterns across practice attempts.
- Be behaviour-focused, specific, and non-shaming.
- Reinforce genuine progress where it exists.
- Choose one main communication target only.
- Add up to two secondary patterns only when they are distinct and clearly supported.
- Do not list every weakness in the data.
- Delivery can appear as a secondary pattern only if it is recurrent and well-supported across more than one session.
- Keep practiceTarget concrete and drill-like. It should tell the learner what to practise next, not just what to understand.
- Tie feedback to the actual scenario demands and the person's profile when relevant.

Output rules:
- headline: 1 sentence about the overall pattern across runs.
- progress: 1-2 sentences about what is improving or still inconsistent.
- primaryTarget: exactly one main communication target.
- secondaryPatterns: up to 2 distinct supporting patterns.
- practiceTarget: one clear practice task for the next run.
- sessionLabel should reflect totalSessionCount in plain language.
- Prefer language like "more consistently", "earlier", "under pressure", "not yet reliable", and "is starting to land".
- Do not mention hidden model states, scores, percentages, or confidence.

Illustrative style examples only — do not reuse wording:
- Weak main target: "Show more empathy."
- Better main target: "Acknowledge the frustration before you explain the delay, so the practical update has a chance to land."
- Weak practice target: "Be calmer next time."
- Better practice target: "Practise one opening sentence that names the concern first, then gives the barrier and next step in plain language."`,
    input: prompt,
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(scenarioHistoryCoachResponseSchema, "scenario_history_coach"),
      verbosity: "low",
    },
  });

  return response.output_parsed ?? null;
}

export async function generateScenarioHistoryCoachSummary(
  input: ScenarioHistoryCoachInput
): Promise<ScenarioHistoryCoachResponse | null> {
  const sortedSessions = [...input.sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const prompt = [
    `Scenario: ${input.scenarioTitle}`,
    input.scenarioSetting ? `Setting: ${input.scenarioSetting}` : null,
    input.traineeRole ? `Trainee role: ${input.traineeRole}` : null,
    input.aiRole ? `Other person role: ${input.aiRole}` : null,
    input.learningObjectives ? `Learning objectives:\n${input.learningObjectives}` : null,
    input.backstory ? `Backstory: ${input.backstory}` : null,
    input.emotionalDriver ? `Emotional driver: ${input.emotionalDriver}` : null,
    formatScenarioTraits(input.traits)
      ? `Authored scenario traits:\n${formatScenarioTraits(input.traits)}`
      : null,
    `Total non-deleted sessions in this scenario: ${input.totalSessionCount}`,
    `Current session id: ${input.currentSessionId}`,
    "",
    "Session history:",
    ...sortedSessions.map((session, index) => [
      `Session ${index + 1}${session.id === input.currentSessionId ? " (current session)" : ""}`,
      `Date: ${new Date(session.createdAt).toISOString()}`,
      `Scores: overall ${session.score.overall}, composure ${session.score.composure}, de-escalation ${session.score.deEscalation}, clinical task ${session.score.clinicalTask}, support seeking ${session.score.supportSeeking}`,
      session.reviewSummary
        ? `Stored review summary:
- Overview: ${session.reviewSummary.overview}
- Overall delivery: ${session.reviewSummary.overallDelivery ?? "None"}
- Positive moment: ${session.reviewSummary.positiveMoment ?? "None"}
- Coaching focus: ${session.reviewSummary.coachingFocus ?? "None"}
- Objective focus: ${session.reviewSummary.objectiveFocus ?? "None"}
- Person focus: ${session.reviewSummary.personFocus ?? "None"}
- What to say instead: ${session.reviewSummary.whatToSayInstead ?? "None"}`
        : "Stored review summary: None",
    ].join("\n")),
  ].filter(Boolean).join("\n");

  try {
    return await requestParsedHistorySummary(prompt, SCENARIO_HISTORY_MAX_OUTPUT_TOKENS);
  } catch (error) {
    if (!isStructuredOutputParseError(error)) {
      throw error;
    }

    return await requestParsedHistorySummary(prompt, SCENARIO_HISTORY_RETRY_MAX_OUTPUT_TOKENS);
  }
}
