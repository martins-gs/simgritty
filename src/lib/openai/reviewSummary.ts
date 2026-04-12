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
  REVIEW_SUMMARY_PROMPT_VERSION,
  REVIEW_SUMMARY_SCHEMA_VERSION,
} from "@/lib/review/artifacts";
import {
  REVIEW_SUMMARY_VERSION,
  type ReviewSummaryData,
} from "@/lib/review/feedback";
import type { TranscriptTurn } from "@/types/simulation";

const REVIEW_SUMMARY_MODEL = process.env.OPENAI_REVIEW_SUMMARY_MODEL || "gpt-5.4";
const REVIEW_SUMMARY_MAX_OUTPUT_TOKENS = 2200;
const REVIEW_SUMMARY_REPAIR_MAX_OUTPUT_TOKENS = 1000;

const summaryRenderSchema = z.object({
  overview: z.string(),
  overallDelivery: z.string().nullable().default(null),
  positiveMoment: z.string().nullable().default(null),
  whyItMattered: z.string().nullable().default(null),
  coachingFocus: z.string().nullable().default(null),
  nextBestMove: z.string().nullable().default(null),
  objectiveFocus: z.string().nullable().default(null),
  personFocus: z.string().nullable().default(null),
});

const summaryRepairSchema = summaryRenderSchema.partial();

const CASE_ANCHOR_STOPWORDS = new Set([
  "about",
  "answer",
  "concrete",
  "clear",
  "clearly",
  "concern",
  "current",
  "direct",
  "explanation",
  "main",
  "person",
  "practical",
  "question",
  "reason",
  "reply",
  "still",
  "their",
  "there",
  "they",
  "what",
]);

interface ReviewSummaryRenderInput {
  ledger: ReviewEvidenceLedger;
  turns: TranscriptTurn[];
}

type RenderFailureClass = NonNullable<ReviewSurfaceMeta["failure_class"]>;

function trimToNull(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function trimRequired(value: string) {
  return value.trim();
}

function sanitizeSummaryRender(render: z.infer<typeof summaryRenderSchema>) {
  return {
    overview: trimRequired(render.overview),
    overallDelivery: trimToNull(render.overallDelivery),
    positiveMoment: trimToNull(render.positiveMoment),
    whyItMattered: trimToNull(render.whyItMattered),
    coachingFocus: trimToNull(render.coachingFocus),
    nextBestMove: trimToNull(render.nextBestMove),
    objectiveFocus: trimToNull(render.objectiveFocus),
    personFocus: trimToNull(render.personFocus),
  };
}

function truncatePromptText(value: string | null | undefined, maxLength = 260) {
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

function containsEducatorJargon(value: string | null | undefined) {
  if (!value) return false;

  return /\bpractical blocker\b|\bcontained reply\b|\bclinical task visible\b|\bland more\b|\blanding\b|\blanded\b/i.test(
    value
  );
}

function normaliseText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getCaseAnchorTokens(value: string | null | undefined) {
  return normaliseText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !CASE_ANCHOR_STOPWORDS.has(token));
}

function hasCaseAnchor(value: string | null | undefined, anchors: string[]) {
  if (anchors.length === 0) return true;
  const words = new Set(normaliseText(value).split(" ").filter(Boolean));
  return anchors.some((anchor) => words.has(anchor));
}

function formatTranscriptForPrompt(turns: TranscriptTurn[]) {
  return turns
    .filter((turn) => turn.content?.trim())
    .slice(0, 24)
    .map((turn) => `${turn.turn_index}. ${turn.speaker === "trainee" ? "You" : turn.speaker === "ai" ? "Patient/relative" : "Clinician"}: ${truncatePromptText(turn.content, 260)}`)
    .join("\n");
}

function buildPrompt(input: ReviewSummaryRenderInput) {
  const candidateMoments = input.ledger.moments
    .slice(0, 6)
    .map((moment) => [
      `Moment ${moment.id} (turn ${moment.turn_index}, ${moment.positive ? "more helpful" : "more difficult"})`,
      `- Evidence label: ${truncatePromptText(moment.evidence_type, 100)}`,
      `- Conversation need: ${truncatePromptText(moment.active_need_or_barrier, 180)}`,
      moment.previous_turn?.content ? `- Before: ${truncatePromptText(moment.previous_turn.content, 180)}` : null,
      moment.focus_turn?.content ? `- You said: ${truncatePromptText(moment.focus_turn.content, 220)}` : null,
      moment.next_turn?.content ? `- After: ${truncatePromptText(moment.next_turn.content, 180)}` : null,
    ].filter(Boolean).join("\n"))
    .join("\n\n");

  return [
    `Scenario: ${truncatePromptText(input.ledger.scenario_title, 140)}`,
    input.ledger.scenario_setting ? `Setting: ${truncatePromptText(input.ledger.scenario_setting, 140)}` : null,
    input.ledger.ai_role ? `Other person role: ${truncatePromptText(input.ledger.ai_role, 120)}` : null,
    `Scenario demand summary:`,
    `- Primary need: ${truncatePromptText(input.ledger.scenario_demand_summary.primary_need, 200)}`,
    `- Common pitfall: ${truncatePromptText(input.ledger.scenario_demand_summary.common_pitfall, 200)}`,
    `- Success pattern: ${truncatePromptText(input.ledger.scenario_demand_summary.success_pattern, 200)}`,
    input.ledger.scenario_demand_summary.adaptation_note
      ? `- Adaptation note: ${truncatePromptText(input.ledger.scenario_demand_summary.adaptation_note, 200)}`
      : null,
    `Outcome state:`,
    `- Session valid: ${input.ledger.outcome_state.session_valid ? "yes" : "no"}`,
    input.ledger.outcome_state.final_escalation_level != null
      ? `- Final escalation level: ${input.ledger.outcome_state.final_escalation_level}`
      : null,
    input.ledger.outcome_state.exit_type ? `- Exit type: ${input.ledger.outcome_state.exit_type}` : null,
    input.ledger.objective_ledger.outstanding_objectives.length > 0
      ? `Outstanding objectives:\n- ${input.ledger.objective_ledger.outstanding_objectives.map((item) => truncatePromptText(item, 180)).join("\n- ")}`
      : null,
    input.ledger.objective_ledger.achieved_objectives.length > 0
      ? `Achieved objectives:\n- ${input.ledger.objective_ledger.achieved_objectives.map((item) => truncatePromptText(item, 180)).join("\n- ")}`
      : null,
    input.ledger.person_adaptation_note ? `Person adaptation: ${truncatePromptText(input.ledger.person_adaptation_note, 180)}` : null,
    input.ledger.delivery_aggregate.supported && input.ledger.delivery_aggregate.summary
      ? `Session-level delivery evidence: ${truncatePromptText(input.ledger.delivery_aggregate.summary, 220)}`
      : `Session-level delivery evidence: none strong enough to mention.`,
    candidateMoments ? `Candidate moments:\n${candidateMoments}` : null,
    `Full transcript:\n${formatTranscriptForPrompt(input.turns)}`,
  ].filter(Boolean).join("\n");
}

async function rescueSummaryParse(
  client: NonNullable<ReturnType<typeof getOpenAIClient>>,
  input: ReviewSummaryRenderInput,
  rawDraft: string,
  maxOutputTokens: number
) {
  const response = await client.responses.parse({
    model: REVIEW_SUMMARY_MODEL,
    instructions: `You are converting a draft coaching summary into a strict structured output for a clinical communication review.

Return only the schema content.

Rules:
- Use British English.
- Use plain English a trainee can understand quickly.
- Keep every populated field brief and case-specific.
- Do not mention timecodes.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- If the draft is weak or incomplete, correct it using the supplied transcript evidence and scenario context.`,
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
      format: zodTextFormat(summaryRenderSchema, "review_summary_render_rescue"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, summaryRenderSchema);
  return {
    parsed,
    failure: describeStructuredOutputFailure(response),
  };
}

async function requestSummaryRender(
  input: ReviewSummaryRenderInput,
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
    model: REVIEW_SUMMARY_MODEL,
    instructions: `You are writing the post-session coaching summary for a clinical communication simulation review screen.

Analyse the actual dialogue and produce learner-facing coaching for this specific session.

Rules:
- Use British English.
- Be behaviour-focused, specific, and psychologically safe.
- Write in plain English that a trainee can understand quickly after a short scenario.
- Base the coaching on the transcript, the scenario context, and the session-level delivery evidence if it is present.
- Name the concrete barrier, question, or issue from this case. Avoid vague stand-ins like "the concern" or "the message" unless they sit beside the concrete case anchor.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- Do not mention timecodes or timing phrases like "early on", "later", or "by the end".
- Do not invent new dialogue, motives, or clinical facts.
- State observed content directly. Hedge only inferred impact or inferred mental state.
- overallDelivery must stay null unless the session-level delivery evidence is clearly supported.
- whyItMattered must be explanatory, not instructional.
- nextBestMove should be a behavioural move for this case, not a canned script.
- Prefer null over filler. Do not pad fields that do not add anything useful.
- Keep overview to at most two short sentences.
- Keep every other populated field to one short sentence.`,
    input: buildPrompt(input),
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(summaryRenderSchema, "review_summary_render"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, summaryRenderSchema);
  if (parsed) {
    return sanitizeSummaryRender(parsed);
  }

  const rawDraft = getResponseOutputText(response);
  if (rawDraft) {
    const rescued = await rescueSummaryParse(client, input, rawDraft, maxOutputTokens);
    if (rescued.parsed) {
      return sanitizeSummaryRender(rescued.parsed);
    }

    throw new SyntaxError(
      `Unable to parse structured review summary JSON (${describeStructuredOutputFailure(response)}; rescue=${rescued.failure})`
    );
  }

  throw new SyntaxError(
    `Unable to parse structured review summary JSON (${describeStructuredOutputFailure(response)})`
  );
}

function validateSummaryRender(
  render: z.infer<typeof summaryRenderSchema>,
  input: ReviewSummaryRenderInput
) {
  const issues = new Set<string>();
  const caseAnchorTokens = getCaseAnchorTokens(
    input.ledger.scenario_demand_summary.primary_need
  );

  if (!render.overview.trim()) {
    issues.add("blank_overview");
  }

  if (
    containsForbiddenTimePhrases(render.overview) ||
    containsForbiddenTimePhrases(render.overallDelivery) ||
    containsForbiddenTimePhrases(render.positiveMoment) ||
    containsForbiddenTimePhrases(render.whyItMattered) ||
    containsForbiddenTimePhrases(render.coachingFocus) ||
    containsForbiddenTimePhrases(render.nextBestMove)
  ) {
    issues.add("time_phrase");
  }

  if (looksInstructional(render.whyItMattered)) {
    issues.add("instructional_why");
  }

  if (
    containsOverGenericCoaching(render.positiveMoment) ||
    containsOverGenericCoaching(render.coachingFocus) ||
    containsOverGenericCoaching(render.nextBestMove)
  ) {
    issues.add("generic_coaching");
  }

  if (
    containsEducatorJargon(render.overview) ||
    containsEducatorJargon(render.positiveMoment) ||
    containsEducatorJargon(render.whyItMattered) ||
    containsEducatorJargon(render.coachingFocus) ||
    containsEducatorJargon(render.nextBestMove)
  ) {
    issues.add("educator_jargon");
  }

  if (render.overallDelivery && !input.ledger.delivery_aggregate.supported) {
    issues.add("unsupported_delivery");
  }

  if (
    !hasCaseAnchor(render.overview, caseAnchorTokens) &&
    !hasCaseAnchor(render.whyItMattered, caseAnchorTokens) &&
    !hasCaseAnchor(render.nextBestMove, caseAnchorTokens)
  ) {
    issues.add("missing_case_anchor");
  }

  return [...issues];
}

async function repairSummaryFields(
  input: ReviewSummaryRenderInput,
  current: z.infer<typeof summaryRenderSchema>,
  fields: Array<keyof z.infer<typeof summaryRenderSchema>>
) {
  const client = getOpenAIClient();
  if (!client || fields.length === 0) {
    return null;
  }

  const response = await client.responses.parse({
    model: REVIEW_SUMMARY_MODEL,
    instructions: `You are repairing specific fields in a clinical coaching summary.

Only rewrite the named fields. Omit every field that does not need rewriting.

Rules:
- Use British English.
- Keep the coaching aligned with the supplied transcript evidence and scenario context.
- Use plain English that a trainee can understand quickly.
- whyItMattered must explain, not instruct.
- nextBestMove must stay case-specific and behaviour-focused.
- Do not mention timecodes or fallback wording.
- Avoid educator-jargon like "practical blocker", "land", "contained reply", or "clinical task".
- Do not invent any new facts.`,
    input: [
      `Fields to rewrite: ${fields.join(", ")}`,
      buildPrompt(input),
      "Current draft:",
      JSON.stringify(current),
    ].join("\n\n"),
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: REVIEW_SUMMARY_REPAIR_MAX_OUTPUT_TOKENS,
    text: {
      format: zodTextFormat(summaryRepairSchema, "review_summary_repair"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, summaryRepairSchema);
  if (!parsed) {
    throw new SyntaxError(
      `Unable to parse structured review summary repair JSON (${describeStructuredOutputFailure(response)})`
    );
  }

  return parsed;
}

function buildFieldProvenance(summary: ReviewSummaryData | null): ReviewSurfaceMeta["field_provenance"] {
  if (!summary) return {};
  return {
    overview: { source: "llm_render", evidenceIds: [], note: "Rendered from transcript evidence." },
    overallDelivery: { source: "audio_aggregate", evidenceIds: [], note: null },
    positiveMoment: { source: "llm_render", evidenceIds: [], note: "Generated from transcript evidence." },
    whyItMattered: { source: "llm_render", evidenceIds: [], note: "Generated from transcript evidence." },
    coachingFocus: { source: "llm_render", evidenceIds: [], note: "Generated from transcript evidence." },
    nextBestMove: { source: "llm_render", evidenceIds: [], note: "Generated from transcript evidence." },
    objectiveFocus: { source: "deterministic_evidence", evidenceIds: [], note: null },
    personFocus: { source: "deterministic_evidence", evidenceIds: [], note: null },
  };
}

function toPublicSummary(render: z.infer<typeof summaryRenderSchema>): ReviewSummaryData {
  return {
    version: REVIEW_SUMMARY_VERSION,
    source: "generated",
    overview: render.overview,
    overallDelivery: render.overallDelivery,
    positiveMoment: render.positiveMoment,
    whyItMattered: render.whyItMattered,
    coachingFocus: render.coachingFocus,
    whatToSayInstead: render.nextBestMove,
    objectiveFocus: render.objectiveFocus,
    personFocus: render.personFocus,
    achievedObjectives: [],
    outstandingObjectives: [],
  };
}

function buildMeta(
  summary: ReviewSummaryData | null,
  options: {
    retryCount: number;
    failureClass: RenderFailureClass | null;
    validatorFailures: string[];
  }
): ReviewSurfaceMeta {
  return {
    prompt_version: REVIEW_SUMMARY_PROMPT_VERSION,
    schema_version: REVIEW_SUMMARY_SCHEMA_VERSION,
    model: REVIEW_SUMMARY_MODEL,
    reasoning_effort: "medium",
    retry_count: options.retryCount,
    fallback_used: false,
    failure_class: options.failureClass,
    validator_failures: options.validatorFailures,
    field_provenance: buildFieldProvenance(summary),
  };
}

export async function generateReviewSummary(
  input: ReviewSummaryRenderInput
): Promise<{ summary: ReviewSummaryData | null; meta: ReviewSurfaceMeta }> {
  let retryCount = 0;
  let failureClass: RenderFailureClass | null = null;
  let validatorFailures: string[] = [];

  if (input.turns.filter((turn) => turn.speaker === "trainee").length === 0) {
    return {
      summary: null,
      meta: buildMeta(null, {
        retryCount,
        failureClass: "semantic",
        validatorFailures: ["no_trainee_turns"],
      }),
    };
  }

  try {
    const initial = await requestSummaryRender(input, REVIEW_SUMMARY_MAX_OUTPUT_TOKENS);
    if (!initial) {
      return {
        summary: null,
        meta: buildMeta(null, {
          retryCount,
          failureClass: "schema",
          validatorFailures: ["openai_unavailable"],
        }),
      };
    }

    let current = initial;
    validatorFailures = validateSummaryRender(current, input);

    if (validatorFailures.includes("unsupported_delivery")) {
      current = { ...current, overallDelivery: null };
      validatorFailures = validateSummaryRender(current, input);
    }

    if (validatorFailures.length > 0) {
      retryCount += 1;
      const repairFields = new Set<keyof z.infer<typeof summaryRenderSchema>>();
      if (validatorFailures.includes("instructional_why")) repairFields.add("whyItMattered");
      if (validatorFailures.includes("generic_coaching")) {
        repairFields.add("positiveMoment");
        repairFields.add("coachingFocus");
        repairFields.add("nextBestMove");
      }
      if (validatorFailures.includes("educator_jargon")) {
        repairFields.add("overview");
        repairFields.add("positiveMoment");
        repairFields.add("whyItMattered");
        repairFields.add("coachingFocus");
        repairFields.add("nextBestMove");
      }
      if (validatorFailures.includes("missing_case_anchor")) {
        repairFields.add("overview");
        repairFields.add("whyItMattered");
        repairFields.add("nextBestMove");
      }
      if (validatorFailures.includes("time_phrase")) {
        repairFields.add("overview");
        repairFields.add("whyItMattered");
        repairFields.add("coachingFocus");
        repairFields.add("nextBestMove");
      }

      if (repairFields.size > 0) {
        const repaired = await repairSummaryFields(input, current, [...repairFields]);
        if (repaired) {
          current = { ...current, ...repaired };
          validatorFailures = validateSummaryRender(current, input);
        }
      }
    }

    if (validatorFailures.length > 0) {
      failureClass = validatorFailures.some((issue) => issue.startsWith("provenance"))
        ? "provenance"
        : "semantic";
      return {
        summary: null,
        meta: buildMeta(null, {
          retryCount,
          failureClass,
          validatorFailures,
        }),
      };
    }

    const summary = {
      ...toPublicSummary(current),
      achievedObjectives: input.ledger.objective_ledger.achieved_objectives,
      outstandingObjectives: input.ledger.objective_ledger.outstanding_objectives,
    };

    return {
      summary,
      meta: buildMeta(summary, {
        retryCount,
        failureClass: null,
        validatorFailures: [],
      }),
    };
  } catch (error) {
    failureClass = error instanceof SyntaxError ? "parse" : "schema";
    validatorFailures = error instanceof Error ? [error.message] : validatorFailures;
    return {
      summary: null,
      meta: buildMeta(null, {
        retryCount,
        failureClass,
        validatorFailures,
      }),
    };
  }
}
