import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import { describeStructuredOutputFailure, parseStructuredOutputText } from "@/lib/openai/structuredOutput";
import {
  REVIEW_SUMMARY_VERSION,
  reviewTimelineResponseSchema,
  type GeneratedTimelineNarrative,
  type ReviewSummaryMomentInput,
  type ReviewTimelineResponse,
} from "@/lib/review/feedback";
import type { ScenarioMilestone, ScenarioTraits } from "@/types/scenario";

const REVIEW_TIMELINE_MODEL = process.env.OPENAI_REVIEW_TIMELINE_MODEL || "gpt-5.4";
const REVIEW_TIMELINE_MAX_OUTPUT_TOKENS = 1200;
const REVIEW_TIMELINE_RETRY_MAX_OUTPUT_TOKENS = 1700;
const REVIEW_TIMELINE_BATCH_SIZE = 3;

interface ReviewTimelineRequest {
  scenarioTitle: string;
  scenarioSetting?: string | null;
  traineeRole?: string | null;
  aiRole?: string | null;
  learningObjectives?: string | null;
  backstory?: string | null;
  emotionalDriver?: string | null;
  traits?: ScenarioTraits | null;
  milestones?: ScenarioMilestone[];
  finalEscalationLevel?: number | null;
  exitType?: string | null;
  moments: ReviewSummaryMomentInput[];
}

class DuplicateNarrativeError extends Error {}

function truncatePromptText(value: string | null | undefined, maxLength = 240) {
  if (!value) return null;

  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function normaliseText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

function formatMilestones(milestones?: ScenarioMilestone[]) {
  if (!milestones || milestones.length === 0) return null;

  return milestones
    .sort((a, b) => a.order - b.order)
    .map((milestone) => (
      `- ${truncatePromptText(milestone.description, 140)}${milestone.classifier_hint ? ` | hint: ${truncatePromptText(milestone.classifier_hint, 180)}` : ""}`
    ))
    .join("\n");
}

function isStructuredOutputParseError(error: unknown) {
  if (error instanceof SyntaxError || error instanceof DuplicateNarrativeError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /unterminated string in json|unexpected end of json|json|duplicate narrative/i.test(message);
}

function hasDuplicateText(values: Array<string | null>) {
  const seen = new Set<string>();
  for (const value of values) {
    const normalised = normaliseText(value);
    if (!normalised) continue;
    if (seen.has(normalised)) {
      return true;
    }
    seen.add(normalised);
  }

  return false;
}

function validateTimelineNarratives(
  response: ReviewTimelineResponse,
  moments: ReviewSummaryMomentInput[]
) {
  if (response.narratives.length !== moments.length) {
    return false;
  }

  for (let index = 0; index < moments.length; index += 1) {
    const narrative = response.narratives[index];
    const moment = moments[index];
    if (
      narrative.turnIndex !== moment.turnIndex ||
      narrative.timecode !== moment.timecode ||
      narrative.positive !== moment.positive
    ) {
      return false;
    }
  }

  return true;
}

function ensureDistinctNarrativeWording(narratives: GeneratedTimelineNarrative[]) {
  if (
    hasDuplicateText(narratives.map((narrative) => narrative.whyItMattered)) ||
    hasDuplicateText(narratives.map((narrative) => narrative.tryInstead ?? null))
  ) {
    throw new DuplicateNarrativeError("Duplicate narrative wording detected");
  }
}

async function requestParsedTimeline(
  prompt: string,
  moments: ReviewSummaryMomentInput[],
  maxOutputTokens: number
): Promise<ReviewTimelineResponse | null> {
  const client = getOpenAIClient();
  if (!client) {
    if (shouldFailLoudOnOpenAIError()) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    return null;
  }

  const response = await client.responses.create({
    model: REVIEW_TIMELINE_MODEL,
    instructions: `You are writing the key-moment coaching cards for a clinical communication simulation review.

These cards appear after the simulation has ended. Latency is acceptable; specificity matters more than speed.

Your job is to write concise, educator-style feedback for each supplied moment.

Best-practice coaching approach:
- Use British English.
- Be behaviour-focused, precise, and psychologically safe.
- Coach the smallest useful change for the next attempt, not every possible issue.
- Start from what the other person still needed at this exact point.
- If the trainee partly did the right thing, say what landed and then coach the timing, order, specificity, or containment.
- If a stronger replacement line is not needed, make tryInstead a behavioural prompt instead.
- Use concrete case language when available: the actual concern, delay, barrier, question, safety issue, or boundary problem.
- Do not invent clinical facts that are not supported by the prompt.
- Do not quote the transcript verbatim unless a very short phrase is necessary for clarity.

Tailoring rules:
- Ground each card in the supplied turn, the surrounding turns, and the immediate conversational consequence.
- Use authored scenario context only to interpret what the person likely needed. Do not restate the scenario brief, learning objective text, backstory, or emotional-driver wording as the answer.
- whyItMattered must explain what need, barrier, question, or risk was active in this moment and why this reply helped or hindered it.
- tryInstead must be tailored to what was missing in this exact turn, not a generic communication slogan.

Distinctness rules:
- Multiple cards may address the same underlying coaching theme.
- However, each card must still sound freshly written for its own turn.
- Do not reuse identical or near-identical wording across cards in this batch.
- Vary the framing, emphasis, and phrasing when two cards touch the same issue.

Illustrative style examples only — do not reuse wording:
- Weak why-it-mattered: "Empathy is important in difficult conversations."
- Better why-it-mattered: "At this point the daughter was still trying to hear why discharge had stalled, so reassurance without the reason left the pressure in place."
- Weak tryInstead: "Show more empathy."
- Better tryInstead: "Start with the frustration about going home late, then explain what is still outstanding and what update you can give today."

Output rules:
- Return valid JSON only.
- Return one narrative for each supplied moment, in the same order.
- Preserve the same turnIndex, timecode, and positive value for each moment.
- headline: short and specific.
- likelyImpact: one short sentence.
- whatHappenedNext: one short sentence.
- whyItMattered: one short sentence that explains why this moment mattered here, in this case.
- tryInstead: one short sentence or null.
- Prefer language like "likely", "seemed to", "appeared to", and "may have".
- Do not mention hidden model states, scores, or confidence values.`,
    input: prompt,
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(reviewTimelineResponseSchema, "review_timeline"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, reviewTimelineResponseSchema);
  if (!parsed || !validateTimelineNarratives(parsed, moments)) {
    throw new SyntaxError(
      `Unable to parse structured timeline JSON (${describeStructuredOutputFailure(response)})`
    );
  }

  ensureDistinctNarrativeWording(parsed.narratives);
  return parsed;
}

function buildTimelinePrompt(
  input: ReviewTimelineRequest,
  moments: ReviewSummaryMomentInput[],
  options?: {
    batchLabel?: string;
    retryNote?: string | null;
  }
) {
  return [
    `Scenario: ${truncatePromptText(input.scenarioTitle, 140)}`,
    input.scenarioSetting ? `Setting: ${truncatePromptText(input.scenarioSetting, 140)}` : null,
    input.traineeRole ? `Trainee role: ${truncatePromptText(input.traineeRole, 120)}` : null,
    input.aiRole ? `Other person role: ${truncatePromptText(input.aiRole, 120)}` : null,
    input.emotionalDriver
      ? `Person pressure point for interpretation only: ${truncatePromptText(input.emotionalDriver, 220)}`
      : null,
    formatScenarioTraits(input.traits)
      ? `Authored scenario traits:\n${formatScenarioTraits(input.traits)}`
      : null,
    formatMilestones(input.milestones)
      ? `Relevant authored clinical milestones:\n${formatMilestones(input.milestones)}`
      : null,
    input.finalEscalationLevel != null ? `Final escalation level: ${input.finalEscalationLevel}` : null,
    input.exitType ? `Exit type: ${input.exitType}` : null,
    options?.batchLabel ? `Batch label: ${options.batchLabel}` : null,
    options?.retryNote ? `Retry note: ${options.retryNote}` : null,
    "",
    "Moments to write:",
    ...moments.map((moment, index) => [
      `${index + 1}. turnIndex=${moment.turnIndex}`,
      `Timecode: ${moment.timecode}`,
      `Positive: ${moment.positive ? "yes" : "no"}`,
      `Dimension: ${moment.dimension}`,
      `Evidence type: ${moment.evidenceType}`,
      moment.evidenceSignals.length > 0
        ? `Evidence signals:\n- ${moment.evidenceSignals.map((signal) => truncatePromptText(signal, 140)).join("\n- ")}`
        : null,
      moment.previousTurn
        ? `Turn before (${moment.previousTurn.speaker}): ${truncatePromptText(moment.previousTurn.content, 220)}`
        : null,
      moment.whatTraineeSaid
        ? `Highlighted trainee turn: ${truncatePromptText(moment.whatTraineeSaid, 220)}`
        : "Highlighted trainee turn: unavailable",
      moment.nextTurn
        ? `Turn after (${moment.nextTurn.speaker}): ${truncatePromptText(moment.nextTurn.content, 220)}`
        : null,
      `Local impact hypothesis: ${truncatePromptText(moment.likelyImpact, 200)}`,
      `Observed next step: ${truncatePromptText(moment.whatHappenedNext, 200)}`,
    ].filter(Boolean).join("\n")),
  ].filter(Boolean).join("\n");
}

async function generateTimelineNarrativesBatch(
  input: ReviewTimelineRequest,
  moments: ReviewSummaryMomentInput[],
  batchLabel?: string
): Promise<ReviewTimelineResponse | null> {
  const prompt = buildTimelinePrompt(input, moments, { batchLabel });

  try {
    return await requestParsedTimeline(prompt, moments, REVIEW_TIMELINE_MAX_OUTPUT_TOKENS);
  } catch (error) {
    if (!isStructuredOutputParseError(error)) {
      throw error;
    }
  }

  try {
    return await requestParsedTimeline(
      buildTimelinePrompt(input, moments, {
        batchLabel,
        retryNote: "Previous draft either failed JSON or reused wording. Keep the JSON valid and make each card sound distinct for its own turn.",
      }),
      moments,
      REVIEW_TIMELINE_RETRY_MAX_OUTPUT_TOKENS
    );
  } catch (retryError) {
    if (!isStructuredOutputParseError(retryError) || moments.length <= 1) {
      throw retryError;
    }

    const midpoint = Math.ceil(moments.length / 2);
    const left = await generateTimelineNarrativesBatch(
      input,
      moments.slice(0, midpoint),
      batchLabel ? `${batchLabel}A` : "batch A"
    );
    const right = await generateTimelineNarrativesBatch(
      input,
      moments.slice(midpoint),
      batchLabel ? `${batchLabel}B` : "batch B"
    );

    return {
      version: left?.version ?? right?.version ?? REVIEW_SUMMARY_VERSION,
      narratives: [...(left?.narratives ?? []), ...(right?.narratives ?? [])],
    };
  }
}

export async function generateTimelineNarratives(
  input: ReviewTimelineRequest
): Promise<ReviewTimelineResponse | null> {
  if (input.moments.length <= REVIEW_TIMELINE_BATCH_SIZE) {
    return generateTimelineNarrativesBatch(input, input.moments);
  }

  const batches: ReviewSummaryMomentInput[][] = [];
  for (let index = 0; index < input.moments.length; index += REVIEW_TIMELINE_BATCH_SIZE) {
    batches.push(input.moments.slice(index, index + REVIEW_TIMELINE_BATCH_SIZE));
  }

  const responses = await Promise.all(
    batches.map((batch, index) => generateTimelineNarrativesBatch(
      input,
      batch,
      `batch ${index + 1} of ${batches.length}`
    ))
  );

  const narratives = responses.flatMap((response) => response?.narratives ?? []);
  if (narratives.length === 0) {
    return null;
  }

  ensureDistinctNarrativeWording(narratives);

  return {
    version: responses.find((response) => response)?.version ?? REVIEW_SUMMARY_VERSION,
    narratives,
  };
}
