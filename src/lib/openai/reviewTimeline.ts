import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import {
  describeStructuredOutputFailure,
  getResponseOutputText,
  parseStructuredOutputText,
} from "@/lib/openai/structuredOutput";
import type {
  ReviewEvidenceLedger,
  ReviewSurfaceMeta,
} from "@/lib/review/artifacts";
import {
  REVIEW_TIMELINE_PROMPT_VERSION,
  REVIEW_TIMELINE_SCHEMA_VERSION,
} from "@/lib/review/artifacts";
import {
  formatReviewTimecode,
  REVIEW_SUMMARY_VERSION,
  type GeneratedTimelineNarrative,
} from "@/lib/review/feedback";
import type { TranscriptTurn } from "@/types/simulation";

const REVIEW_TIMELINE_MODEL = process.env.OPENAI_REVIEW_TIMELINE_MODEL || "gpt-5.4";
const REVIEW_TIMELINE_MAX_OUTPUT_TOKENS = 3200;
const REVIEW_TIMELINE_REPAIR_MAX_OUTPUT_TOKENS = 1600;

const timelineCardSchema = z.object({
  momentId: z.string(),
  headline: z.string(),
  likelyImpact: z.string(),
  whatHappenedNext: z.string(),
  whyItMattered: z.string(),
  nextBestMove: z.string().nullable().default(null),
});

const timelineBatchSchema = z.object({
  cards: z.array(timelineCardSchema).max(4).default([]),
});

interface ReviewTimelineRenderInput {
  ledger: ReviewEvidenceLedger;
  turns: TranscriptTurn[];
  sessionStartedAt: string | null | undefined;
}

type RenderFailureClass = NonNullable<ReviewSurfaceMeta["failure_class"]>;

function trimToNull(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeTimelineBatch(render: z.infer<typeof timelineBatchSchema>) {
  return {
    cards: render.cards.map((card) => ({
      momentId: card.momentId.trim(),
      headline: card.headline.trim(),
      likelyImpact: card.likelyImpact.trim(),
      whatHappenedNext: card.whatHappenedNext.trim(),
      whyItMattered: card.whyItMattered.trim(),
      nextBestMove: trimToNull(card.nextBestMove),
    })),
  };
}

function truncatePromptText(value: string | null | undefined, maxLength = 240) {
  if (!value) return null;

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function containsForbiddenTimePhrases(value: string | null | undefined) {
  if (!value) return false;

  return /\b\d+:\d{2}\b|\b(early on|later|by the end|at the turning point|around)\b/i.test(value);
}

function looksInstructional(value: string | null | undefined) {
  if (!value) return false;

  return /^(start|name|lead|answer|lower|slow|keep|use|say|pause|state|acknowledge|bring|decide|practise|practice)\b/i.test(
    value.trim()
  );
}

function containsOverGenericCoaching(value: string | null | undefined) {
  if (!value) return false;

  return /\b(useful behaviour to carry into similar conversations|carry into similar conversations|show more empathy|be calmer next time)\b/i.test(
    value
  );
}

function containsGenericHeadline(value: string | null | undefined) {
  if (!value) return false;

  return /^(this helped the message land|this left the main need unresolved|part of this reply helped the message land)\.?$/i.test(
    value.trim()
  );
}

function containsEducatorJargon(value: string | null | undefined) {
  if (!value) return false;

  return /\bpractical blocker\b|\bcontained reply\b|\bclinical task\b|\bland more\b|\blanding\b|\blanded\b/i.test(
    value
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
    .slice(0, 28)
    .map((turn) => `${turn.turn_index}. ${turn.speaker === "trainee" ? "You" : turn.speaker === "ai" ? "Patient/relative" : "Clinician"}: ${truncatePromptText(turn.content, 240)}`)
    .join("\n");
}

function buildPrompt(input: ReviewTimelineRenderInput) {
  const candidateMoments = input.ledger.moments
    .map((moment) => [
      `Moment ${moment.id}`,
      `- Turn index: ${moment.turn_index}`,
      `- Polarity: ${moment.positive ? "more helpful" : "moment to revisit"}`,
      `- Evidence label: ${truncatePromptText(moment.evidence_type, 120)}`,
      moment.active_need_or_barrier ? `- Main issue in play: ${truncatePromptText(moment.active_need_or_barrier, 180)}` : null,
      moment.previous_turn?.content ? `- Before: ${truncatePromptText(moment.previous_turn.content, 180)}` : null,
      moment.focus_turn?.content ? `- You said: ${truncatePromptText(moment.focus_turn.content, 220)}` : null,
      moment.next_turn?.content ? `- After: ${truncatePromptText(moment.next_turn.content, 180)}` : null,
    ].filter(Boolean).join("\n"))
    .join("\n\n");

  return [
    `Scenario: ${truncatePromptText(input.ledger.scenario_title, 160)}`,
    input.ledger.scenario_setting ? `Setting: ${truncatePromptText(input.ledger.scenario_setting, 160)}` : null,
    input.ledger.ai_role ? `Other person role: ${truncatePromptText(input.ledger.ai_role, 120)}` : null,
    `Scenario demand summary:`,
    `- Primary need: ${truncatePromptText(input.ledger.scenario_demand_summary.primary_need, 200)}`,
    `- Common pitfall: ${truncatePromptText(input.ledger.scenario_demand_summary.common_pitfall, 200)}`,
    `- Success pattern: ${truncatePromptText(input.ledger.scenario_demand_summary.success_pattern, 200)}`,
    input.ledger.scenario_demand_summary.adaptation_note
      ? `- Adaptation note: ${truncatePromptText(input.ledger.scenario_demand_summary.adaptation_note, 180)}`
      : null,
    input.ledger.delivery_aggregate.supported && input.ledger.delivery_aggregate.summary
      ? `Session-level delivery evidence: ${truncatePromptText(input.ledger.delivery_aggregate.summary, 220)}`
      : null,
    input.ledger.objective_ledger.outstanding_objectives.length > 0
      ? `Outstanding objectives:\n- ${input.ledger.objective_ledger.outstanding_objectives.map((item) => truncatePromptText(item, 180)).join("\n- ")}`
      : null,
    `Generate one coaching card for each supplied moment id. Do not omit any moment and do not invent new ones.`,
    `Candidate moments:\n${candidateMoments}`,
    `Full transcript:\n${formatTranscriptForPrompt(input.turns)}`,
  ].filter(Boolean).join("\n");
}

async function rescueTimelineBatch(
  client: NonNullable<ReturnType<typeof getOpenAIClient>>,
  input: ReviewTimelineRenderInput,
  rawDraft: string,
  maxOutputTokens: number
) {
  const response = await client.responses.parse({
    model: REVIEW_TIMELINE_MODEL,
    instructions: `You are converting a draft set of coaching cards into strict structured output for a clinical communication review.

Return only the schema content.

Rules:
- Use British English.
- Use plain English that a trainee can understand quickly.
- Keep one card per supplied moment id.
- Do not mention timecodes.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- If the draft is incomplete, correct it from the supplied transcript evidence.`,
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
      format: zodTextFormat(timelineBatchSchema, "review_timeline_batch_rescue"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, timelineBatchSchema);
  return {
    parsed,
    failure: describeStructuredOutputFailure(response),
  };
}

async function requestTimelineBatch(input: ReviewTimelineRenderInput, maxOutputTokens: number) {
  const client = getOpenAIClient();
  if (!client) {
    if (shouldFailLoudOnOpenAIError()) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    return null;
  }

  const response = await client.responses.parse({
    model: REVIEW_TIMELINE_MODEL,
    instructions: `You are writing the key-moment coaching cards for a clinical communication simulation review.

Use the transcript and the candidate moments to explain how the conversation unfolded.

Rules:
- Use British English.
- Write in plain English that a trainee can understand quickly after the session.
- Return one card for every supplied moment id.
- Keep each card specific to what was actually said and how the other person reacted.
- headline must name what actually happened in that moment, not a generic label.
- likelyImpact should explain how that specific reply probably affected the conversation.
- whatHappenedNext should describe the immediate reaction after that moment.
- whyItMattered must explain why the moment mattered here; it must not be instructional.
- nextBestMove should be a concrete behavioural move for this case, not a canned script.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- Do not mention timecodes.
- Vary the teaching angle across cards. Do not reuse the same whyItMattered sentence.
- Do not invent dialogue or clinical facts.`,
    input: buildPrompt(input),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(timelineBatchSchema, "review_timeline_batch"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, timelineBatchSchema);
  if (parsed) {
    return sanitizeTimelineBatch(parsed);
  }

  const rawDraft = getResponseOutputText(response);
  if (rawDraft) {
    const rescued = await rescueTimelineBatch(client, input, rawDraft, maxOutputTokens);
    if (rescued.parsed) {
      return sanitizeTimelineBatch(rescued.parsed);
    }

    throw new SyntaxError(
      `Unable to parse structured timeline JSON (${describeStructuredOutputFailure(response)}; rescue=${rescued.failure})`
    );
  }

  throw new SyntaxError(
    `Unable to parse structured timeline JSON (${describeStructuredOutputFailure(response)})`
  );
}

function validateTimelineBatch(
  render: z.infer<typeof timelineBatchSchema>,
  input: ReviewTimelineRenderInput
) {
  const issues = new Set<string>();
  const expectedIds = new Set(input.ledger.moments.map((moment) => moment.id));
  const returnedIds = new Set(render.cards.map((card) => card.momentId));

  if (render.cards.length !== input.ledger.moments.length) {
    issues.add("missing_moment_cards");
  }

  for (const expectedId of expectedIds) {
    if (!returnedIds.has(expectedId)) {
      issues.add("missing_moment_cards");
    }
  }

  for (const card of render.cards) {
    if (!card.momentId.trim()) {
      issues.add("blank_moment_id");
    }
    if (!card.headline.trim()) {
      issues.add("blank_headline");
    }
    if (!card.likelyImpact.trim()) {
      issues.add("blank_likely_impact");
    }
    if (!card.whatHappenedNext.trim()) {
      issues.add("blank_what_happened_next");
    }
    if (!card.whyItMattered.trim()) {
      issues.add("blank_why_it_mattered");
    }

    if (!expectedIds.has(card.momentId)) {
      issues.add("unknown_moment_id");
    }

    if (
      containsForbiddenTimePhrases(card.headline) ||
      containsForbiddenTimePhrases(card.likelyImpact) ||
      containsForbiddenTimePhrases(card.whatHappenedNext) ||
      containsForbiddenTimePhrases(card.whyItMattered) ||
      containsForbiddenTimePhrases(card.nextBestMove)
    ) {
      issues.add("time_phrase");
    }

    if (looksInstructional(card.whyItMattered)) {
      issues.add("instructional_why");
    }

    if (containsOverGenericCoaching(card.nextBestMove)) {
      issues.add("generic_move");
    }

    if (containsGenericHeadline(card.headline)) {
      issues.add("generic_headline");
    }

    if (
      containsEducatorJargon(card.headline) ||
      containsEducatorJargon(card.likelyImpact) ||
      containsEducatorJargon(card.whatHappenedNext) ||
      containsEducatorJargon(card.whyItMattered) ||
      containsEducatorJargon(card.nextBestMove)
    ) {
      issues.add("educator_jargon");
    }
  }

  const whys = render.cards.map((card) => normaliseText(card.whyItMattered)).filter(Boolean);
  if (new Set(whys).size !== whys.length) {
    issues.add("duplicate_why");
  }

  const headlines = render.cards.map((card) => normaliseText(card.headline)).filter(Boolean);
  if (new Set(headlines).size !== headlines.length) {
    issues.add("duplicate_headline");
  }

  return [...issues];
}

async function repairTimelineBatch(
  input: ReviewTimelineRenderInput,
  current: z.infer<typeof timelineBatchSchema>,
  issues: string[]
) {
  const client = getOpenAIClient();
  if (!client) {
    return null;
  }

  const response = await client.responses.parse({
    model: REVIEW_TIMELINE_MODEL,
    instructions: `You are repairing a batch of coaching cards for a clinical communication review.

Only fix the problems listed.

Rules:
- Use British English.
- Use plain English that a trainee can understand quickly.
- Keep one card per supplied moment id.
- whyItMattered must explain, not instruct.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- Do not invent dialogue or clinical facts.`,
    input: [
      `Problems to fix: ${issues.join(", ")}`,
      buildPrompt(input),
      "Current draft:",
      JSON.stringify(current),
    ].join("\n\n"),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: REVIEW_TIMELINE_REPAIR_MAX_OUTPUT_TOKENS,
    text: {
      format: zodTextFormat(timelineBatchSchema, "review_timeline_batch_repair"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, timelineBatchSchema);
  if (!parsed) {
    throw new SyntaxError(
      `Unable to parse structured timeline repair JSON (${describeStructuredOutputFailure(response)})`
    );
  }

  return sanitizeTimelineBatch(parsed);
}

function buildMeta(
  failureClass: RenderFailureClass | null,
  retryCount: number,
  validatorFailures: string[]
): ReviewSurfaceMeta {
  return {
    prompt_version: REVIEW_TIMELINE_PROMPT_VERSION,
    schema_version: REVIEW_TIMELINE_SCHEMA_VERSION,
    model: REVIEW_TIMELINE_MODEL,
    reasoning_effort: "medium",
    retry_count: retryCount,
    fallback_used: false,
    failure_class: failureClass,
    validator_failures: validatorFailures,
    field_provenance: {},
  };
}

function buildNarratives(
  render: z.infer<typeof timelineBatchSchema>,
  input: ReviewTimelineRenderInput
): GeneratedTimelineNarrative[] {
  const turnByIndex = new Map(input.turns.map((turn) => [turn.turn_index, turn]));

  return render.cards.flatMap((card) => {
    const moment = input.ledger.moments.find((item) => item.id === card.momentId);
    if (!moment) return [];

    return [{
      turnIndex: moment.turn_index,
      timecode: formatReviewTimecode(turnByIndex.get(moment.turn_index)?.started_at, input.sessionStartedAt, moment.turn_index),
      lens: moment.dimension,
      headline: card.headline,
      likelyImpact: card.likelyImpact,
      whatHappenedNext: card.whatHappenedNext,
      whyItMattered: card.whyItMattered,
      tryInstead: moment.positive ? null : card.nextBestMove,
      positive: moment.positive,
    }];
  }).sort((a, b) => a.turnIndex - b.turnIndex);
}

export async function generateTimelineNarratives(
  input: ReviewTimelineRenderInput
): Promise<{ timeline: { version: number; narratives: GeneratedTimelineNarrative[] } | null; meta: ReviewSurfaceMeta }> {
  let retryCount = 0;
  let failureClass: RenderFailureClass | null = null;
  let validatorFailures: string[] = [];

  if (input.ledger.moments.length === 0) {
    return {
      timeline: null,
      meta: buildMeta("semantic", retryCount, ["no_candidate_moments"]),
    };
  }

  try {
    const initial = await requestTimelineBatch(input, REVIEW_TIMELINE_MAX_OUTPUT_TOKENS);
    if (!initial) {
      return {
        timeline: null,
        meta: buildMeta("schema", retryCount, ["openai_unavailable"]),
      };
    }

    let current = initial;
    let issues = validateTimelineBatch(current, input);

    if (issues.length > 0) {
      retryCount += 1;
      const repaired = await repairTimelineBatch(input, current, issues);
      if (repaired) {
        current = repaired;
        issues = validateTimelineBatch(current, input);
      }
    }

    if (issues.length > 0) {
      failureClass = issues.some((issue) => issue.startsWith("duplicate"))
        ? "duplication"
        : "semantic";
      validatorFailures = issues;
      return {
        timeline: null,
        meta: buildMeta(failureClass, retryCount, validatorFailures),
      };
    }

    return {
      timeline: {
        version: REVIEW_SUMMARY_VERSION,
        narratives: buildNarratives(current, input),
      },
      meta: buildMeta(null, retryCount, []),
    };
  } catch (error) {
    failureClass = error instanceof SyntaxError ? "parse" : "schema";
    validatorFailures = error instanceof Error ? [error.message] : validatorFailures;
    return {
      timeline: null,
      meta: buildMeta(failureClass, retryCount, validatorFailures),
    };
  }
}
