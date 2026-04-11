import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, shouldFailLoudOnOpenAIError } from "@/lib/openai/client";
import {
  type ReviewSummaryRequest,
  type ReviewSummaryResponse,
  reviewSummaryResponseSchema,
} from "@/lib/review/feedback";

const REVIEW_SUMMARY_MODEL = process.env.OPENAI_REVIEW_SUMMARY_MODEL || "gpt-5.4-mini";
const REVIEW_SUMMARY_MAX_OUTPUT_TOKENS = 700;
const REVIEW_SUMMARY_RETRY_MAX_OUTPUT_TOKENS = 1100;

function isStructuredOutputParseError(error: unknown) {
  if (error instanceof SyntaxError) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /unterminated string in json|unexpected end of json|json/i.test(message);
}

async function requestParsedReviewSummary(
  client: NonNullable<ReturnType<typeof getOpenAIClient>>,
  prompt: string,
  maxOutputTokens: number
): Promise<ReviewSummaryResponse | null> {
  const response = await client.responses.parse({
    model: REVIEW_SUMMARY_MODEL,
    instructions: `You are writing coaching feedback for a clinical communication simulation review screen.

Write concise, plain-language feedback that sounds interpretive rather than authoritative.

This Session Summary panel sits above a separate timeline that already gives detailed moment-by-moment feedback, surrounding transcript, and what happened next.
Use this panel for synthesis, not detailed reconstruction.

Rules:
- Use British English.
- Do not mention percentages, confidence scores, numerical effectiveness values, hidden model states, or score labels.
- Prefer language like "likely", "seemed to", "appeared to", and "may have".
- Ground every point in the supplied turns and outcomes. Do not invent dialogue, timings, or motives.
- Treat any example phrases in these instructions or the fallback as illustrative only, not as required wording.
- Judge the function of the trainee's response, not whether it matched a stock phrase.
- If the trainee acknowledged emotion, explained the barrier, or gave a next step in substance, do not say the move was missing just because the wording differed.
- If a helpful move arrived late, after reassurance, or got buried in a longer reply, describe it that way instead of calling it absent.
- If the trainee was partly effective, coach the timing, order, or specificity of the move instead of replacing the whole response.
- Do not treat explicit emotion-labelling as mandatory if the trainee clearly acknowledged the concern in another natural way.
- The overview must read like the arc of the conversation, not a verdict.
- Use at most one concrete time anchor, and only when it genuinely helps orient the learner.
- Do not repeat the detailed timeline card content.
- Do not quote the transcript, restate the surrounding turns, or describe before/after exchanges in this panel.
- Highlight at least one positive moment if the evidence supports it.
- The session summary should help the learner answer:
  1. What was the overall pattern in this conversation?
  2. What is one thing to keep doing?
  3. What is the main thing to do differently next time?
- positiveMoment must name a reusable behaviour worth repeating, not just that the trainee was calmer.
- coachingFocus must contain one main teaching point only.
- coachingFocus may fold in the wider scenario aim and the person's needs, but do not list multiple missed milestones or multiple personality adaptations.
- objectiveFocus should usually be null. Only populate it if one short scenario-goal point is essential and not already clear in coachingFocus.
- personFocus should usually be null. Only populate it if one short person-specific adaptation is essential and not already clear in coachingFocus.
- If there is coaching text, make it something the trainee could realistically do or say next time.
- whatToSayInstead may be either a short communication move or a brief model line, depending on what best fits the case.
- Prefer the structure of the missing move over one canonical script when the trainee partly achieved the move already.
- Only give a full replacement line when the original turn genuinely missed the core move; otherwise, prefer a short behavioural prompt.
- Prefer concrete teaching language such as "You acknowledged the emotion, but did not yet explain the main barrier or next step."
- Avoid defaulting to stock phrasing such as "I can hear how upsetting this is" unless that sort of explicit acknowledgement was genuinely absent.
- Avoid vague phrases like "practical concern unanswered", "guarded or muddled", or "became steadier" unless you immediately say what that meant in practice.
- Keep overview to at most two short sentences.
- Keep every other populated string to one short sentence.
- Target word counts:
  - overview: 18 to 34 words total.
  - positiveMoment: 10 to 18 words.
  - coachingFocus: 12 to 24 words.
  - whatToSayInstead: 8 to 20 words.
  - objectiveFocus: 8 to 18 words, or null.
  - personFocus: 8 to 18 words, or null.
- Leave achievedObjectives and outstandingObjectives as empty arrays unless there is a strong reason to populate them.`,
    input: prompt,
    store: false,
    reasoning: { effort: "none" },
    max_output_tokens: maxOutputTokens,
    text: {
      format: zodTextFormat(reviewSummaryResponseSchema, "review_summary"),
      verbosity: "low",
    },
  });

  return response.output_parsed ?? null;
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

  const prompt = [
    `Scenario: ${input.scenarioTitle}`,
    input.learningObjectives
      ? `Learning objectives:\n${input.learningObjectives}`
      : null,
    input.backstory ? `Backstory: ${input.backstory}` : null,
    input.emotionalDriver ? `Emotional driver: ${input.emotionalDriver}` : null,
    input.personSummary ? `Person-specific guidance draft: ${input.personSummary}` : null,
    input.finalEscalationLevel != null
      ? `Final escalation level: ${input.finalEscalationLevel}`
      : null,
    input.exitType ? `Exit type: ${input.exitType}` : null,
    input.achievedObjectives.length > 0
      ? `Objectives clearly seen:\n- ${input.achievedObjectives.join("\n- ")}`
      : "Objectives clearly seen:\n- None clearly evidenced",
    input.outstandingObjectives.length > 0
      ? `Objectives still missing or unclear:\n- ${input.outstandingObjectives.join("\n- ")}`
      : null,
    "",
    "Draft fallback summary (rough draft only — correct or discard anything formulaic, overstated, or contradicted by the turns):",
    `- Overview: ${input.fallback.overview}`,
    `- Positive moment: ${input.fallback.positiveMoment ?? "None identified"}`,
    `- Coaching focus: ${input.fallback.coachingFocus ?? "None identified"}`,
    `- What to say instead: ${input.fallback.whatToSayInstead ?? "None suggested"}`,
    `- Objective focus: ${input.fallback.objectiveFocus ?? "None identified"}`,
    `- Person focus: ${input.fallback.personFocus ?? "None identified"}`,
    "",
    "Key moments:",
    ...input.moments.map((moment, index) => [
      `${index + 1}. Time ${moment.timecode}`,
      `Positive moment: ${moment.positive ? "yes" : "no"}`,
      moment.previousTurn
        ? `Turn before (${moment.previousTurn.speaker}): ${moment.previousTurn.content}`
        : null,
      moment.whatTraineeSaid
        ? `Highlighted trainee turn: ${moment.whatTraineeSaid}`
        : "Highlighted trainee turn: unavailable",
      moment.nextTurn
        ? `Turn after (${moment.nextTurn.speaker}): ${moment.nextTurn.content}`
        : null,
      `Likely impact: ${moment.likelyImpact}`,
      `What happened next: ${moment.whatHappenedNext}`,
      `Why it mattered: ${moment.whyItMattered}`,
      `What to say instead: ${moment.tryInstead ?? "No replacement line needed"}`,
    ].filter(Boolean).join("\n")),
  ].filter(Boolean).join("\n");

  try {
    return await requestParsedReviewSummary(
      client,
      prompt,
      REVIEW_SUMMARY_MAX_OUTPUT_TOKENS
    );
  } catch (error) {
    if (!isStructuredOutputParseError(error)) {
      throw error;
    }

    return await requestParsedReviewSummary(
      client,
      prompt,
      REVIEW_SUMMARY_RETRY_MAX_OUTPUT_TOKENS
    );
  }
}
