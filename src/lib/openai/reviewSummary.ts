import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import { describeStructuredOutputFailure, parseStructuredOutputText } from "@/lib/openai/structuredOutput";
import {
  type ReviewSummaryMomentInput,
  type ReviewSummaryRequest,
  type ReviewSummaryResponse,
  reviewSummaryResponseSchema,
} from "@/lib/review/feedback";

const REVIEW_SUMMARY_MODEL = process.env.OPENAI_REVIEW_SUMMARY_MODEL || "gpt-5.4";
const REVIEW_SUMMARY_MAX_OUTPUT_TOKENS = 900;
const REVIEW_SUMMARY_RETRY_MAX_OUTPUT_TOKENS = 1300;
const REVIEW_SUMMARY_COMPACT_MAX_OUTPUT_TOKENS = 900;

function truncatePromptText(value: string | null | undefined, maxLength = 260) {
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

function formatScenarioTraits(input: ReviewSummaryRequest) {
  if (!input.traits) return null;

  const traits = input.traits;
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

function formatMilestones(input: ReviewSummaryRequest) {
  if (input.milestones.length === 0) return null;

  return input.milestones
    .sort((a, b) => a.order - b.order)
    .map((milestone) => (
      `- ${truncatePromptText(milestone.description, 140)}${milestone.classifier_hint ? ` | hint: ${truncatePromptText(milestone.classifier_hint, 180)}` : ""}`
    ))
    .join("\n");
}

function isStructuredOutputParseError(error: unknown) {
  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /unterminated string in json|unexpected end of json|json|structured output/i.test(message);
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

function reusesFallbackWording(summary: ReviewSummaryResponse, input: ReviewSummaryRequest) {
  const comparisons: Array<[string | null | undefined, string | null | undefined]> = [
    [summary.overview, input.fallback.overview],
    [summary.overallDelivery, input.fallback.overallDelivery],
    [summary.positiveMoment, input.fallback.positiveMoment],
    [summary.whyItMattered, input.fallback.whyItMattered],
    [summary.coachingFocus, input.fallback.coachingFocus],
    [summary.whatToSayInstead, input.fallback.whatToSayInstead],
    [summary.objectiveFocus, input.fallback.objectiveFocus],
    [summary.personFocus, input.fallback.personFocus],
  ];

  let exactMatches = 0;
  for (const [generated, fallback] of comparisons) {
    if (generated && fallback && normaliseText(generated) === normaliseText(fallback)) {
      exactMatches += 1;
    }
  }

  return exactMatches >= 2 || normaliseText(summary.overview) === normaliseText(input.fallback.overview);
}

function isReviewSummaryUsable(summary: ReviewSummaryResponse, input: ReviewSummaryRequest) {
  if (
    containsForbiddenTimePhrases(summary.overview) ||
    containsForbiddenTimePhrases(summary.overallDelivery) ||
    containsForbiddenTimePhrases(summary.positiveMoment) ||
    containsForbiddenTimePhrases(summary.whyItMattered) ||
    containsForbiddenTimePhrases(summary.coachingFocus)
  ) {
    return false;
  }

  if (looksInstructional(summary.whyItMattered)) {
    return false;
  }

  if (
    containsOverGenericCoaching(summary.positiveMoment) ||
    containsOverGenericCoaching(summary.coachingFocus) ||
    containsOverGenericCoaching(summary.whatToSayInstead)
  ) {
    return false;
  }

  if (reusesFallbackWording(summary, input)) {
    return false;
  }

  return true;
}

function buildMomentPrompt(moment: ReviewSummaryMomentInput, index: number) {
  return [
    `${index + 1}. Internal moment reference ${moment.turnIndex}`,
    `Dimension: ${moment.dimension}`,
    `Evidence type: ${moment.evidenceType}`,
    `Positive moment: ${moment.positive ? "yes" : "no"}`,
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
    `Likely impact: ${truncatePromptText(moment.likelyImpact, 200)}`,
    `What happened next: ${truncatePromptText(moment.whatHappenedNext, 200)}`,
  ].filter(Boolean).join("\n");
}

function buildReviewSummaryPrompt(
  input: ReviewSummaryRequest,
  options?: {
    compact?: boolean;
    retryNote?: string | null;
  }
) {
  const compact = options?.compact ?? false;
  const selectedMoments = compact
    ? input.moments.slice(0, 2)
    : input.moments.slice(0, 3);

  const authoredContext = compact
    ? [
        input.aiRole ? `Other person role: ${input.aiRole}` : null,
        input.personSummary ? `Person-specific context hypothesis: ${truncatePromptText(input.personSummary, 240)}` : null,
      ].filter(Boolean).join("\n")
    : [
        input.scenarioSetting ? `Setting: ${truncatePromptText(input.scenarioSetting, 140)}` : null,
        input.traineeRole ? `Trainee role: ${truncatePromptText(input.traineeRole, 120)}` : null,
        input.aiRole ? `Other person role: ${truncatePromptText(input.aiRole, 120)}` : null,
        input.learningObjectives
          ? `Learning objectives:\n${truncatePromptText(input.learningObjectives, 360)}`
          : null,
        input.backstory
          ? `Authored background for interpretation only — do not quote or paraphrase this back to the learner:\n${truncatePromptText(input.backstory, 420)}`
          : null,
        input.emotionalDriver
          ? `Authored emotional driver for interpretation only: ${truncatePromptText(input.emotionalDriver, 220)}`
          : null,
        formatScenarioTraits(input)
          ? `Authored scenario traits:\n${formatScenarioTraits(input)}`
          : null,
        formatMilestones(input)
          ? `Authored clinical milestones:\n${formatMilestones(input)}`
          : null,
      ].filter(Boolean).join("\n");

  return [
    `Scenario: ${truncatePromptText(input.scenarioTitle, 140)}`,
    authoredContext || null,
    input.finalEscalationLevel != null
      ? `Final escalation level: ${input.finalEscalationLevel}`
      : null,
    input.exitType ? `Exit type: ${input.exitType}` : null,
    input.achievedObjectives.length > 0
      ? `Objectives clearly seen:\n- ${input.achievedObjectives.map((item) => truncatePromptText(item, 140)).join("\n- ")}`
      : "Objectives clearly seen:\n- None clearly evidenced",
    input.outstandingObjectives.length > 0
      ? `Objectives still missing or unclear:\n- ${input.outstandingObjectives.map((item) => truncatePromptText(item, 140)).join("\n- ")}`
      : null,
    options?.retryNote ? `Retry note: ${options.retryNote}` : null,
    "",
    "Key moments:",
    ...selectedMoments.map((moment, index) => buildMomentPrompt(moment, index)),
  ].filter(Boolean).join("\n");
}

async function requestParsedReviewSummary(
  client: NonNullable<ReturnType<typeof getOpenAIClient>>,
  input: ReviewSummaryRequest,
  prompt: string,
  maxOutputTokens: number,
  options?: {
    jsonMode?: boolean;
  }
): Promise<ReviewSummaryResponse | null> {
  const response = await client.responses.create({
    model: REVIEW_SUMMARY_MODEL,
    instructions: `You are writing the post-session coaching summary for a clinical communication simulation review screen.

Your job is to sound like a skilled educator or debrief coach: specific, fair, behaviour-focused, and tailored to this exact case.

This panel sits above a separate timeline that already gives moment-by-moment detail. Use this panel for synthesis, pattern recognition, and one high-value next step.

Best-practice coaching approach:
- Use British English.
- Write in plain language that is psychologically safe and non-shaming.
- Describe observable communication patterns, not personality traits.
- Start from the trainee's apparent intention and whether any part of the move landed.
- Reinforce a useful move when the evidence supports it.
- When something did not land, coach the timing, order, specificity, or containment of the move.
- Give the smallest high-value adjustment most likely to improve the next attempt.
- Tie coaching to the actual concern, barrier, next step, safety issue, or relationship dynamic in this case.
- If the trainee was partly effective, say what they did achieve before coaching what was still missing.
- Prefer natural communication guidance over stock scripts.
- If you give a model line, adapt it to the specific case. Do not default to generic empathy wording.

Tailoring rules:
- Ground every point in the supplied turns, outcomes, objectives, and authored scenario context.
- Use authored scenario context only to interpret what the person likely needed; do not restate the scenario brief, backstory, or emotional-driver wording as feedback.
- Do not invent dialogue, timings, motives, or clinical facts that are not supported by the prompt.
- Treat any fallback or draft text as rough hypotheses only.
- Do not copy wording from the fallback or from the examples below. Write fresh sentences for this case.
- Use concrete case language when available. Name the actual concern or barrier rather than speaking abstractly.
- Judge the function of the trainee's response, not whether it matched a stock phrase.
- Do not treat explicit emotion-labelling as mandatory if the trainee acknowledged the concern naturally in another way.
- If a helpful move arrived late or got buried in a longer reply, describe that precisely instead of calling it absent.

Illustrative style examples only — do not reuse wording:
- Weak coaching: "The trainee needed to show more empathy."
- Better coaching: "You recognised the frustration, but you moved to reassurance before explaining the delay, so the main worry still felt unanswered."
- Weak replacement: "I can hear how upsetting this is."
- Better replacement: "Start with the frustration about the wait, then explain what is holding things up and what update you can give today."

Output rules:
- Return valid JSON only.
- Prefer language like "likely", "seemed to", "appeared to", and "may have".
- Do not mention percentages, confidence scores, numerical effectiveness values, hidden model states, or score labels.
- The overview must read like the overall arc of the conversation, not a verdict or a play-by-play.
- Do not use timecodes or time-oriented phrasing such as "around 0:12", "early on", "later", "by the end", or "at the turning point".
- Describe the conversation-level pattern, not the order of cards on the page.
- Do not quote the transcript, restate surrounding turns in detail, or repeat the timeline card wording.
- Highlight at least one positive moment if the evidence supports it.
- positiveMoment must name the specific move that helped in this case and what it helped with, not a generic professional-quality statement.
- overallDelivery should usually be null. Only populate it if delivery showed a noticeable overall pattern or a clear shift under pressure supported by more than one moment.
- overallDelivery should summarise how the trainee sounded overall, not describe one isolated turn.
- whyItMattered must explain why the difficult moment mattered in this case.
- whyItMattered must be explanatory, not instructional. Do not use an imperative sentence there.
- coachingFocus must contain one main teaching point only, explained as the key interaction lesson from this case.
- objectiveFocus should usually be null. Only populate it if one concise scenario-goal point is essential and not already clear in coachingFocus.
- personFocus should usually be null. Only populate it if one concise person-specific adaptation is essential and not already clear in coachingFocus.
- whatToSayInstead should usually be a short behavioural move rather than a full script.
- Only give a full replacement line when the original turn genuinely missed the core move and the line is tightly tied to the exact concern in this case.
- Avoid generic phrases such as "useful behaviour to carry into similar conversations".
- Keep overview to at most two short sentences.
- Keep every other populated string to one short sentence.
- Target word counts:
  - overview: 18 to 40 words total.
  - overallDelivery: 10 to 24 words, or null.
  - positiveMoment: 10 to 22 words.
  - whyItMattered: 10 to 24 words.
  - coachingFocus: 12 to 28 words.
  - whatToSayInstead: 8 to 24 words.
  - objectiveFocus: 8 to 20 words, or null.
  - personFocus: 8 to 20 words, or null.
- Leave achievedObjectives and outstandingObjectives as empty arrays unless there is a strong reason to populate them.`,
    input: prompt,
    store: false,
    reasoning: { effort: "medium" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: options?.jsonMode
        ? { type: "json_object" }
        : zodTextFormat(reviewSummaryResponseSchema, "review_summary"),
      verbosity: "low",
    },
  });

  const parsed = parseStructuredOutputText(response, reviewSummaryResponseSchema);
  if (!parsed) {
    throw new SyntaxError(
      `Unable to parse structured review summary JSON (${describeStructuredOutputFailure(response)})`
    );
  }

  const generated: ReviewSummaryResponse = {
    ...parsed,
    source: "generated",
  };
  if (!isReviewSummaryUsable(generated, input)) {
    throw new SyntaxError("Generated review summary failed quality checks");
  }

  return generated;
}

export async function generateReviewSummary(
  input: ReviewSummaryRequest
) {
  const client = getOpenAIClient();
  if (!client) {
    if (shouldFailLoudOnOpenAIError()) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    return null;
  }

  const prompt = buildReviewSummaryPrompt(input);

  try {
    return await requestParsedReviewSummary(
      client,
      input,
      prompt,
      REVIEW_SUMMARY_MAX_OUTPUT_TOKENS
    );
  } catch (error) {
    if (!isStructuredOutputParseError(error)) {
      throw error;
    }
  }

  try {
    return await requestParsedReviewSummary(
      client,
      input,
      buildReviewSummaryPrompt(input, {
        retryNote: "Previous draft either failed JSON parsing or leaned too close to draft wording. Rewrite from the evidence, keep the JSON valid, and avoid any time-oriented phrasing.",
      }),
      REVIEW_SUMMARY_RETRY_MAX_OUTPUT_TOKENS
    );
  } catch (error) {
    if (!isStructuredOutputParseError(error)) {
      throw error;
    }
  }

  try {
    return await requestParsedReviewSummary(
      client,
      input,
      buildReviewSummaryPrompt(input, {
        compact: true,
        retryNote: "Use the hypotheses only as background, keep the summary synthesis-first, and write fresh case-specific coaching in strict JSON.",
      }),
      REVIEW_SUMMARY_COMPACT_MAX_OUTPUT_TOKENS
    );
  } catch (error) {
    if (!isStructuredOutputParseError(error)) {
      throw error;
    }
  }

  return requestParsedReviewSummary(
    client,
    input,
    buildReviewSummaryPrompt(input, {
      compact: true,
      retryNote: "Structured schema retries failed. Return valid JSON only, keep the keys exact, and write fresh case-specific coaching rather than repeating prompt language.",
    }),
    REVIEW_SUMMARY_COMPACT_MAX_OUTPUT_TOKENS,
    { jsonMode: true }
  );
}
