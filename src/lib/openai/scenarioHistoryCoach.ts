import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import {
  describeStructuredOutputFailure,
  getResponseOutputText,
  parseStructuredOutputText,
} from "@/lib/openai/structuredOutput";
import {
  REVIEW_HISTORY_PROMPT_VERSION,
  REVIEW_HISTORY_SCHEMA_VERSION,
  type ReviewSurfaceMeta,
} from "@/lib/review/artifacts";
import {
  scenarioHistoryCoachResponseSchema,
  type ScenarioHistoryCoachResponse,
  type ScenarioHistorySessionInput,
} from "@/lib/review/history";

const SCENARIO_HISTORY_MODEL = process.env.OPENAI_SCENARIO_HISTORY_MODEL || "gpt-5.4";
const SCENARIO_HISTORY_MAX_OUTPUT_TOKENS = 2200;
const SCENARIO_HISTORY_REPAIR_MAX_OUTPUT_TOKENS = 1000;

const scenarioHistoryRenderSchema = z.object({
  headline: z.string(),
  progress: z.string(),
  primaryTarget: z.string(),
  secondaryPatterns: z.array(z.string()).max(2).default([]),
  practiceTarget: z.string(),
});

interface ScenarioHistoryCoachInput {
  currentSessionId: string;
  totalSessionCount: number;
  sessions: ScenarioHistorySessionInput[];
}

type RenderFailureClass = NonNullable<ReviewSurfaceMeta["failure_class"]>;

function sanitizeScenarioHistoryRender(render: z.infer<typeof scenarioHistoryRenderSchema>) {
  return {
    headline: render.headline.trim(),
    progress: render.progress.trim(),
    primaryTarget: render.primaryTarget.trim(),
    secondaryPatterns: render.secondaryPatterns
      .map((item) => item.trim())
      .filter(Boolean),
    practiceTarget: render.practiceTarget.trim(),
  };
}

function truncatePromptText(value: string | null | undefined, maxLength = 220) {
  if (!value) return null;

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function containsEducatorJargon(value: string | null | undefined) {
  if (!value) return false;

  return /\bpractical blocker\b|\bcontained reply\b|\bclinical task\b|\bland more\b|\blanding\b|\blanded\b/i.test(
    value
  );
}

function buildPrompt(input: ScenarioHistoryCoachInput) {
  const sessions = [...input.sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return [
    `Total sessions: ${Math.max(1, input.totalSessionCount)}`,
    `Current session id: ${input.currentSessionId}`,
    `Use the sessions below to identify what is genuinely improving, what still breaks down, and the single most useful next target.`,
    sessions.map((session, index) => [
      `Session ${index + 1}${session.id === input.currentSessionId ? " (current)" : ""}`,
      `- Date: ${session.createdAt}`,
      session.caseNeed ? `- Main case need: ${truncatePromptText(session.caseNeed, 180)}` : null,
      session.sessionOutcome ? `- Outcome: ${truncatePromptText(session.sessionOutcome, 180)}` : null,
      session.deliverySummary ? `- Delivery: ${truncatePromptText(session.deliverySummary, 200)}` : null,
      session.outstandingObjectives.length > 0
        ? `- Still not clear enough: ${session.outstandingObjectives.map((item) => truncatePromptText(item, 160)).join(" | ")}`
        : null,
      session.achievedObjectives.length > 0
        ? `- What did come through: ${session.achievedObjectives.map((item) => truncatePromptText(item, 160)).join(" | ")}`
        : null,
      session.transcriptExcerpt ? `- Transcript excerpt:\n${session.transcriptExcerpt}` : null,
      session.keyMoments.length > 0
        ? session.keyMoments.map((moment) => [
            `- Selected moment ${moment.id} (${moment.positive ? "stronger" : "weaker"})`,
            moment.evidenceLabel ? `  Lens: ${truncatePromptText(moment.evidenceLabel, 120)}` : null,
            moment.before ? `  Before: ${truncatePromptText(moment.before, 170)}` : null,
            moment.youSaid ? `  You said: ${truncatePromptText(moment.youSaid, 190)}` : null,
            moment.after ? `  After: ${truncatePromptText(moment.after, 170)}` : null,
          ].filter(Boolean).join("\n")).join("\n")
        : null,
    ].filter(Boolean).join("\n")).join("\n\n"),
  ].filter(Boolean).join("\n\n");
}

async function rescueScenarioHistoryParse(
  client: NonNullable<ReturnType<typeof getOpenAIClient>>,
  input: ScenarioHistoryCoachInput,
  rawDraft: string,
  maxOutputTokens: number
) {
  const response = await client.responses.parse({
    model: SCENARIO_HISTORY_MODEL,
    instructions: `You are converting a draft "Review your progress" panel into strict structured output.

Return only the schema content.

Rules:
- Use British English.
- Use plain English that a trainee can understand quickly.
- Keep one primary target only.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- If the draft is incomplete, correct it from the supplied session evidence.`,
    input: [
      "Original evidence and task:",
      buildPrompt(input),
      "Draft to convert:",
      rawDraft,
    ].join("\n\n"),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(scenarioHistoryRenderSchema, "scenario_history_render_rescue"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, scenarioHistoryRenderSchema);
  return {
    parsed,
    failure: describeStructuredOutputFailure(response),
  };
}

async function requestScenarioHistorySummary(
  input: ScenarioHistoryCoachInput,
  maxOutputTokens: number
) {
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

Analyse the actual session evidence across attempts. Do not write from canned coaching categories.

Rules:
- Use British English.
- Be behaviour-focused, specific, and non-shaming.
- Write in plain English that a trainee can understand quickly after a short scenario.
- Reinforce genuine progress when it is present, but do not invent progress.
- Keep one primary target only.
- Include up to two secondary patterns only when they are clearly distinct.
- Keep the practice target drill-like and concrete.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- Do not mention hidden model states, percentages, or confidence.
- Ground the coaching in the evidence from the sessions provided.`,
    input: buildPrompt(input),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(scenarioHistoryRenderSchema, "scenario_history_render"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, scenarioHistoryRenderSchema);
  if (parsed) {
    return sanitizeScenarioHistoryRender(parsed);
  }

  const rawDraft = getResponseOutputText(response);
  if (rawDraft) {
    const rescued = await rescueScenarioHistoryParse(client, input, rawDraft, maxOutputTokens);
    if (rescued.parsed) {
      return sanitizeScenarioHistoryRender(rescued.parsed);
    }

    throw new SyntaxError(
      `Unable to parse structured scenario history JSON (${describeStructuredOutputFailure(response)}; rescue=${rescued.failure})`
    );
  }

  throw new SyntaxError(
    `Unable to parse structured scenario history JSON (${describeStructuredOutputFailure(response)})`
  );
}

function validateScenarioHistoryRender(render: z.infer<typeof scenarioHistoryRenderSchema>) {
  const issues = new Set<string>();

  if (!render.headline.trim()) issues.add("blank_headline");
  if (!render.progress.trim()) issues.add("blank_progress");
  if (!render.primaryTarget.trim()) issues.add("blank_primary_target");
  if (!render.practiceTarget.trim()) issues.add("blank_practice_target");

  if (
    containsEducatorJargon(render.headline) ||
    containsEducatorJargon(render.progress) ||
    containsEducatorJargon(render.primaryTarget) ||
    containsEducatorJargon(render.practiceTarget) ||
    render.secondaryPatterns.some((item) => containsEducatorJargon(item))
  ) {
    issues.add("educator_jargon");
  }

  if (/show more empathy|be calmer next time|carry into similar conversations/i.test(
    [render.progress, render.primaryTarget, render.practiceTarget, ...render.secondaryPatterns].join(" ")
  )) {
    issues.add("generic_coaching");
  }

  return [...issues];
}

async function repairScenarioHistorySummary(
  input: ScenarioHistoryCoachInput,
  current: z.infer<typeof scenarioHistoryRenderSchema>,
  issues: string[]
) {
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }

  const response = await client.responses.parse({
    model: SCENARIO_HISTORY_MODEL,
    instructions: `You are repairing the "Review your progress" panel for repeated runs of one scenario.

Only fix the listed issues.

Rules:
- Use British English.
- Use plain English that a trainee can understand quickly.
- Keep one clear primary target.
- Keep the output grounded in the sessions provided.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".`,
    input: [
      `Problems to fix: ${issues.join(", ")}`,
      buildPrompt(input),
      "Current draft:",
      JSON.stringify(current),
    ].join("\n\n"),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: SCENARIO_HISTORY_REPAIR_MAX_OUTPUT_TOKENS,
    text: {
      format: zodTextFormat(scenarioHistoryRenderSchema, "scenario_history_render_repair"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, scenarioHistoryRenderSchema);
  if (!parsed) {
    throw new SyntaxError(
      `Unable to parse structured scenario history repair JSON (${describeStructuredOutputFailure(response)})`
    );
  }

  return sanitizeScenarioHistoryRender(parsed);
}

function buildMeta(
  failureClass: RenderFailureClass | null,
  retryCount: number,
  validatorFailures: string[]
): ReviewSurfaceMeta {
  return {
    prompt_version: REVIEW_HISTORY_PROMPT_VERSION,
    schema_version: REVIEW_HISTORY_SCHEMA_VERSION,
    model: SCENARIO_HISTORY_MODEL,
    reasoning_effort: "medium",
    retry_count: retryCount,
    fallback_used: false,
    failure_class: failureClass,
    validator_failures: validatorFailures,
    field_provenance: {},
  };
}

export async function generateScenarioHistoryCoachSummary(
  input: ScenarioHistoryCoachInput
): Promise<{ summary: ScenarioHistoryCoachResponse | null; meta: ReviewSurfaceMeta }> {
  let retryCount = 0;
  let validatorFailures: string[] = [];
  let failureClass: RenderFailureClass | null = null;

  if (input.sessions.length === 0) {
    return {
      summary: null,
      meta: buildMeta("semantic", retryCount, ["no_sessions"]),
    };
  }

  try {
    const initial = await requestScenarioHistorySummary(input, SCENARIO_HISTORY_MAX_OUTPUT_TOKENS);
    if (!initial) {
      return {
        summary: null,
        meta: buildMeta("schema", retryCount, ["openai_unavailable"]),
      };
    }

    let current = initial;
    validatorFailures = validateScenarioHistoryRender(current);

    if (validatorFailures.length > 0) {
      retryCount += 1;
      const repaired = await repairScenarioHistorySummary(input, current, validatorFailures);
      if (repaired) {
        current = repaired;
        validatorFailures = validateScenarioHistoryRender(current);
      }
    }

    if (validatorFailures.length > 0) {
      return {
        summary: null,
        meta: buildMeta("semantic", retryCount, validatorFailures),
      };
    }

    const summary = scenarioHistoryCoachResponseSchema.parse({
      totalSessions: Math.max(1, input.totalSessionCount),
      sessionLabel: input.totalSessionCount <= 1
        ? "1 non-deleted session in this scenario"
        : `${input.totalSessionCount} non-deleted sessions in this scenario`,
      headline: current.headline,
      progress: current.progress,
      primaryTarget: current.primaryTarget,
      secondaryPatterns: current.secondaryPatterns,
      practiceTarget: current.practiceTarget,
    });

    return {
      summary,
      meta: buildMeta(null, retryCount, []),
    };
  } catch (error) {
    failureClass = error instanceof SyntaxError ? "parse" : "schema";
    validatorFailures = error instanceof Error ? [error.message] : validatorFailures;
    return {
      summary: null,
      meta: buildMeta(failureClass, retryCount, validatorFailures),
    };
  }
}
