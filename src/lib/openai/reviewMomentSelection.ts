import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import {
  describeStructuredOutputFailure,
  getResponseOutputText,
  parseStructuredOutputText,
} from "@/lib/openai/structuredOutput";
import type { Response } from "openai/resources/responses/responses";
import type { TranscriptTurn } from "@/types/simulation";

export const REVIEW_MOMENT_SELECTION_PROMPT_VERSION = "review-moment-selection-v2";
export const REVIEW_MOMENT_SELECTION_SCHEMA_VERSION = "review-moment-selection-v2";

const REVIEW_MOMENT_SELECTION_MODEL = process.env.OPENAI_REVIEW_MOMENT_SELECTION_MODEL || "gpt-5.4";
const REVIEW_MOMENT_SELECTION_MAX_OUTPUT_TOKENS = 2400;
const REVIEW_MOMENT_SELECTION_REPAIR_MAX_OUTPUT_TOKENS = 1200;

const reviewMomentSelectionCardSchema = z.object({
  turnIndex: z.number().int().min(0),
  positive: z.boolean(),
  dimension: z.string(),
  evidenceType: z.string(),
  headlineHint: z.string(),
  activeNeedOrBarrier: z.string().nullable().default(null),
  whatPartlyLanded: z.string().nullable().default(null),
  whatWasMissing: z.string().nullable().default(null),
  whyItMatteredReason: z.string(),
  likelyImpact: z.string(),
  observedConsequence: z.string(),
  nextBestMove: z.string().nullable().default(null),
});

const reviewMomentSelectionSchema = z.object({
  moments: z.array(reviewMomentSelectionCardSchema).max(4).default([]),
});

export type SelectedReviewMoment = z.infer<typeof reviewMomentSelectionCardSchema>;

export interface ReviewMomentSelectionInput {
  scenarioTitle: string;
  scenarioSetting?: string | null;
  aiRole?: string | null;
  personAdaptationNote?: string | null;
  scenarioDemandSummary: {
    primary_need?: string | null;
    common_pitfall?: string | null;
    success_pattern?: string | null;
    adaptation_note?: string | null;
  };
  objectiveLedger: {
    achieved_objectives: string[];
    outstanding_objectives: string[];
  };
  deliveryAggregate: {
    supported: boolean;
    summary?: string | null;
  };
  turns: TranscriptTurn[];
}

export interface ReviewMomentSelectionMeta {
  prompt_version: string;
  schema_version: string;
  model: string;
  reasoning_effort: "none" | "low" | "medium" | "high" | "xhigh";
  retry_count: number;
  fallback_used: boolean;
  failure_class: "parse" | "schema" | "semantic" | "duplication" | "provenance" | null;
  validator_failures: string[];
  field_provenance: Record<string, {
    source: "deterministic_evidence" | "summary_plan" | "timeline_plan" | "llm_render" | "audio_aggregate" | "fallback";
    evidenceIds: string[];
    note: string | null;
  }>;
}

function truncatePromptText(value: string | null | undefined, maxLength = 220) {
  if (!value) return null;

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function trimToNull(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeMomentSelection(render: z.infer<typeof reviewMomentSelectionSchema>) {
  return {
    moments: render.moments.map((moment) => ({
      ...moment,
      dimension: moment.dimension.trim(),
      evidenceType: moment.evidenceType.trim(),
      headlineHint: moment.headlineHint.trim(),
      activeNeedOrBarrier: trimToNull(moment.activeNeedOrBarrier),
      whatPartlyLanded: trimToNull(moment.whatPartlyLanded),
      whatWasMissing: trimToNull(moment.whatWasMissing),
      whyItMatteredReason: moment.whyItMatteredReason.trim(),
      likelyImpact: moment.likelyImpact.trim(),
      observedConsequence: moment.observedConsequence.trim(),
      nextBestMove: trimToNull(moment.nextBestMove),
    })),
  };
}

function containsForbiddenTimePhrases(value: string | null | undefined) {
  if (!value) return false;

  return /\b\d+:\d{2}\b|\b(early on|later|by the end|at the turning point|around)\b/i.test(value);
}

function containsEducatorJargon(value: string | null | undefined) {
  if (!value) return false;

  return /\bpractical blocker\b|\bcontained reply\b|\bclinical task\b|\bland more\b|\blanding\b|\blanded\b/i.test(value);
}

function containsGenericHeadline(value: string | null | undefined) {
  if (!value) return false;

  return /^(this helped the message land|this left the main need unresolved|part of this reply helped the message land)\.?$/i.test(
    value.trim()
  );
}

function normaliseText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatTranscriptForPrompt(turns: TranscriptTurn[]) {
  return turns
    .filter((turn) => turn.content?.trim())
    .slice(0, 32)
    .map((turn) => `${turn.turn_index}. ${turn.speaker === "trainee" ? "You" : turn.speaker === "ai" ? "Patient/relative" : "Clinician"}: ${truncatePromptText(turn.content, 260)}`)
    .join("\n");
}

function buildPrompt(input: ReviewMomentSelectionInput) {
  return [
    `Scenario: ${truncatePromptText(input.scenarioTitle, 140)}`,
    input.scenarioSetting ? `Setting: ${truncatePromptText(input.scenarioSetting, 140)}` : null,
    input.aiRole ? `Other person role: ${truncatePromptText(input.aiRole, 120)}` : null,
    `Scenario demand summary:`,
    input.scenarioDemandSummary.primary_need ? `- Primary need: ${truncatePromptText(input.scenarioDemandSummary.primary_need, 220)}` : null,
    input.scenarioDemandSummary.common_pitfall ? `- Common pitfall: ${truncatePromptText(input.scenarioDemandSummary.common_pitfall, 220)}` : null,
    input.scenarioDemandSummary.success_pattern ? `- Success pattern: ${truncatePromptText(input.scenarioDemandSummary.success_pattern, 220)}` : null,
    input.personAdaptationNote ? `Person adaptation: ${truncatePromptText(input.personAdaptationNote, 200)}` : null,
    input.objectiveLedger.outstanding_objectives.length > 0
      ? `Still not clear enough:\n- ${input.objectiveLedger.outstanding_objectives.map((item) => truncatePromptText(item, 180)).join("\n- ")}`
      : null,
    input.objectiveLedger.achieved_objectives.length > 0
      ? `What did come through:\n- ${input.objectiveLedger.achieved_objectives.map((item) => truncatePromptText(item, 180)).join("\n- ")}`
      : null,
    input.deliveryAggregate.supported && input.deliveryAggregate.summary
      ? `Session-level delivery evidence: ${truncatePromptText(input.deliveryAggregate.summary, 220)}`
      : null,
    `Transcript:\n${formatTranscriptForPrompt(input.turns)}`,
  ].filter(Boolean).join("\n");
}

async function rescueMomentSelection(
  client: NonNullable<ReturnType<typeof getOpenAIClient>>,
  input: ReviewMomentSelectionInput,
  rawDraft: string,
  maxOutputTokens: number
) {
  const response = await client.responses.parse({
    model: REVIEW_MOMENT_SELECTION_MODEL,
    instructions: `You are converting a draft list of teachable moments into strict structured output for a clinical communication review.

Return only the schema content.

Rules:
- Use British English.
- Select trainee turns only.
- Keep the output factual, specific, and grounded in the supplied transcript.
- Select between 2 and 4 moments when the transcript is long enough.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- whyItMatteredReason must explain why the moment mattered here, not instruct what to do next.
- nextBestMove should stay null for clearly helpful moments.
- Do not mention timecodes.
- Do not invent dialogue or clinical facts.`,
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
      format: zodTextFormat(reviewMomentSelectionSchema, "review_moment_selection_rescue"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, reviewMomentSelectionSchema);
  return {
    parsed,
    failure: describeStructuredOutputFailure(response),
  };
}

async function requestMomentSelection(
  input: ReviewMomentSelectionInput,
  maxOutputTokens: number
) {
  const client = getOpenAIClient();
  if (!client) {
    if (shouldFailLoudOnOpenAIError()) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    return null;
  }

  const request = {
    model: REVIEW_MOMENT_SELECTION_MODEL,
    instructions: `You are selecting the teachable moments for a post-session clinical communication review.

Choose the trainee turns that best explain how this conversation unfolded.

Rules:
- Use British English.
- Select between 2 and 4 trainee turns when the transcript is long enough. Select fewer only if the session is too short.
- Choose moments from trainee turns only.
- Prefer moments that are genuinely teachable: what was said, how it sounded, and how the other person responded.
- Include both helpful and difficult moments when both genuinely exist.
- Do not use scores or scoring language.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- headlineHint must be factual and specific, not a stock label.
- whyItMatteredReason must explain why that moment mattered here, not instruct what to do next.
- nextBestMove should be null for clearly helpful moments.
- Do not mention timecodes.
- Do not invent dialogue or clinical facts.`,
    input: buildPrompt(input),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(reviewMomentSelectionSchema, "review_moment_selection"),
      verbosity: "low",
    },
  } as const;

  let response: Response | null = null;

  try {
    response = await client.responses.parse(request);
  } catch (error) {
    const parseErrorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`[Review Moment Selection] parse call failed, retrying with raw response create: ${parseErrorMessage}`);
    response = await client.responses.create(request);
  }

  const parsed = parseStructuredOutputText(response, reviewMomentSelectionSchema);
  if (parsed) {
    return sanitizeMomentSelection(parsed);
  }

  const rawDraft = getResponseOutputText(response);
  if (rawDraft) {
    const rescued = await rescueMomentSelection(client, input, rawDraft, maxOutputTokens);
    if (rescued.parsed) {
      return sanitizeMomentSelection(rescued.parsed);
    }

    throw new SyntaxError(
      `Unable to parse structured review moment JSON (${describeStructuredOutputFailure(response)}; rescue=${rescued.failure})`
    );
  }

  throw new SyntaxError(
    `Unable to parse structured review moment JSON (${describeStructuredOutputFailure(response)})`
  );
}

function validateMomentSelection(
  render: z.infer<typeof reviewMomentSelectionSchema>,
  input: ReviewMomentSelectionInput
) {
  const issues = new Set<string>();
  const traineeTurnIndexes = new Set(
    input.turns.filter((turn) => turn.speaker === "trainee").map((turn) => turn.turn_index)
  );
  const turnIndexes = render.moments.map((moment) => moment.turnIndex);

  if (render.moments.length === 0) {
    issues.add("no_selected_moments");
  }

  if (new Set(turnIndexes).size !== turnIndexes.length) {
    issues.add("duplicate_turn_indexes");
  }

  for (const moment of render.moments) {
    if (!traineeTurnIndexes.has(moment.turnIndex)) {
      issues.add("non_trainee_turn");
    }

    if (
      containsForbiddenTimePhrases(moment.headlineHint) ||
      containsForbiddenTimePhrases(moment.whyItMatteredReason) ||
      containsForbiddenTimePhrases(moment.likelyImpact) ||
      containsForbiddenTimePhrases(moment.observedConsequence) ||
      containsForbiddenTimePhrases(moment.nextBestMove)
    ) {
      issues.add("time_phrase");
    }

    if (
      containsEducatorJargon(moment.dimension) ||
      containsEducatorJargon(moment.evidenceType) ||
      containsEducatorJargon(moment.headlineHint) ||
      containsEducatorJargon(moment.activeNeedOrBarrier) ||
      containsEducatorJargon(moment.whatPartlyLanded) ||
      containsEducatorJargon(moment.whatWasMissing) ||
      containsEducatorJargon(moment.whyItMatteredReason) ||
      containsEducatorJargon(moment.likelyImpact) ||
      containsEducatorJargon(moment.observedConsequence) ||
      containsEducatorJargon(moment.nextBestMove)
    ) {
      issues.add("educator_jargon");
    }

    if (containsGenericHeadline(moment.headlineHint)) {
      issues.add("generic_headline");
    }

    if (/^(start|name|lead|answer|lower|slow|keep|use|say|pause|state|acknowledge|bring|decide|practise|practice)\b/i.test(
      moment.whyItMatteredReason.trim()
    )) {
      issues.add("instructional_why");
    }

    if (moment.positive && moment.nextBestMove) {
      issues.add("positive_moment_has_next_move");
    }
  }

  const whys = render.moments.map((moment) => normaliseText(moment.whyItMatteredReason)).filter(Boolean);
  if (new Set(whys).size !== whys.length) {
    issues.add("duplicate_why");
  }

  return [...issues];
}

async function repairMomentSelection(
  input: ReviewMomentSelectionInput,
  current: z.infer<typeof reviewMomentSelectionSchema>,
  issues: string[]
) {
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }

  const response = await client.responses.parse({
    model: REVIEW_MOMENT_SELECTION_MODEL,
    instructions: `You are repairing the selected teachable moments for a post-session clinical communication review.

Only fix the listed problems.

Rules:
- Use British English.
- Keep the same overall purpose: select trainee turns that best explain the conversation.
- Do not use scores or scoring language.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- whyItMatteredReason must explain, not instruct.
- Do not invent dialogue or clinical facts.`,
    input: [
      `Problems to fix: ${issues.join(", ")}`,
      buildPrompt(input),
      "Current draft:",
      JSON.stringify(current),
    ].join("\n\n"),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: REVIEW_MOMENT_SELECTION_REPAIR_MAX_OUTPUT_TOKENS,
    text: {
      format: zodTextFormat(reviewMomentSelectionSchema, "review_moment_selection_repair"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, reviewMomentSelectionSchema);
  if (!parsed) {
    throw new SyntaxError(
      `Unable to parse structured review moment repair JSON (${describeStructuredOutputFailure(response)})`
    );
  }

  return sanitizeMomentSelection(parsed);
}

function buildMeta(
  failureClass: ReviewMomentSelectionMeta["failure_class"],
  retryCount: number,
  validatorFailures: string[]
): ReviewMomentSelectionMeta {
  return {
    prompt_version: REVIEW_MOMENT_SELECTION_PROMPT_VERSION,
    schema_version: REVIEW_MOMENT_SELECTION_SCHEMA_VERSION,
    model: REVIEW_MOMENT_SELECTION_MODEL,
    reasoning_effort: "medium",
    retry_count: retryCount,
    fallback_used: false,
    failure_class: failureClass,
    validator_failures: validatorFailures,
    field_provenance: {},
  };
}

export async function generateReviewMoments(
  input: ReviewMomentSelectionInput
): Promise<{ moments: SelectedReviewMoment[]; meta: ReviewMomentSelectionMeta }> {
  let retryCount = 0;
  let validatorFailures: string[] = [];

  const traineeTurns = input.turns.filter((turn) => turn.speaker === "trainee" && turn.content?.trim());
  if (traineeTurns.length === 0) {
    return {
      moments: [],
      meta: buildMeta("semantic", retryCount, ["no_trainee_turns"]),
    };
  }

  try {
    const initial = await requestMomentSelection(input, REVIEW_MOMENT_SELECTION_MAX_OUTPUT_TOKENS);
    if (!initial) {
      return {
        moments: [],
        meta: buildMeta("schema", retryCount, ["openai_unavailable"]),
      };
    }

    let current = initial;
    validatorFailures = validateMomentSelection(current, input);

    if (validatorFailures.length > 0) {
      retryCount += 1;
      const repaired = await repairMomentSelection(input, current, validatorFailures);
      if (repaired) {
        current = repaired;
        validatorFailures = validateMomentSelection(current, input);
      }
    }

    if (validatorFailures.length > 0) {
      const failureClass = validatorFailures.some((issue) => issue.startsWith("duplicate"))
        ? "duplication"
        : "semantic";
      return {
        moments: [],
        meta: buildMeta(failureClass, retryCount, validatorFailures),
      };
    }

    return {
      moments: current.moments,
      meta: buildMeta(null, retryCount, []),
    };
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : null;
    return {
      moments: [],
      meta: buildMeta(
        error instanceof SyntaxError ? "parse" : "schema",
        retryCount,
        failureMessage ? [failureMessage] : validatorFailures
      ),
    };
  }
}
