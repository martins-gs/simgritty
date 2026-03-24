import type { ClassifierResult } from "@/types/simulation";

export interface ClassifierContext {
  recentTurns: { speaker: string; content: string }[];
  scenarioContext: string;
  currentEscalation: number;
}

export type ClassifierMode = "trainee_utterance" | "patient_response";

const TRAINEE_CLASSIFIER_SYSTEM_PROMPT = `You are an expert communication skills assessor for clinical training scenarios.

Analyse the trainee clinician's latest utterance and classify the communication technique used.

IMPORTANT: You are assessing the TRAINEE's communication quality, not the simulated patient's behaviour.

Respond in JSON format only:
{
  "technique": "string - name of the communication technique detected",
  "effectiveness": "number from -1.0 to 1.0 where negative means escalating/poor, positive means de-escalating/good",
  "tags": ["array of short descriptor tags"],
  "confidence": "number from 0 to 1",
  "reasoning": "brief one-sentence explanation"
}

Escalating behaviours (negative effectiveness):
- dismissive language (-0.5 to -1.0)
- telling someone to "calm down" badly (-0.3 to -0.7)
- contradiction or uncertainty (-0.2 to -0.5)
- ignoring emotions (-0.3 to -0.7)
- excessive jargon (-0.2 to -0.4)
- patronising tone (-0.4 to -0.8)
- perceived blame (-0.5 to -0.9)
- failure to answer a direct question (-0.3 to -0.6)

De-escalating behaviours (positive effectiveness):
- acknowledgement of distress (+0.3 to +0.7)
- clear explanation (+0.2 to +0.5)
- concrete next step (+0.3 to +0.6)
- appropriate apology (+0.2 to +0.5)
- reflective listening (+0.4 to +0.8)
- respectful tone (+0.2 to +0.4)
- calm boundary setting (+0.3 to +0.6)
- naming the emotion (+0.4 to +0.7)`;

const PATIENT_RESPONSE_CLASSIFIER_SYSTEM_PROMPT = `You are monitoring a simulated patient or relative in a live clinical de-escalation scenario.

Analyse the patient's latest utterance and classify what it indicates about their current state.

IMPORTANT: You are assessing the PATIENT OR RELATIVE'S state shift, not the clinician's communication quality.

Respond in JSON format only:
{
  "technique": "string - short label for the patient's current stance or shift",
  "effectiveness": "number from -1.0 to 1.0 where negative means more escalated / less trusting / less willing to listen, and positive means calmer / more trusting / more willing to listen",
  "tags": ["array of short descriptor tags"],
  "confidence": "number from 0 to 1",
  "reasoning": "brief one-sentence explanation"
}

Negative effectiveness indicators:
- increased hostility, blame, threats, or contempt
- refusal to listen or direct rejection of help
- more distrustful, accusatory, or absolutist language
- more chaotic, repetitive, or emotionally flooded speech

Positive effectiveness indicators:
- more reflective or direct engagement with the clinician
- acceptance of a next step, boundary, or explanation
- calmer questions, clearer thinking, or reduced hostility
- signs of trust, listening, or emotional settling

Neutral effectiveness:
- still distressed, but no clear movement toward either escalation or de-escalation`;

async function requestClassification(
  context: ClassifierContext,
  apiKey: string,
  systemPrompt: string,
  userPrompt: string
): Promise<ClassifierResult> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    return {
      technique: "unknown",
      effectiveness: 0,
      tags: [],
      confidence: 0,
      reasoning: "Classification failed",
    };
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  try {
    const parsed = JSON.parse(content);
    return {
      technique: parsed.technique || "unknown",
      effectiveness: Math.max(-1, Math.min(1, parsed.effectiveness || 0)),
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
      reasoning: parsed.reasoning || "",
    };
  } catch {
    return {
      technique: "unknown",
      effectiveness: 0,
      tags: [],
      confidence: 0,
      reasoning: "Failed to parse classification",
    };
  }
}

export async function classifyUtterance(
  utterance: string,
  context: ClassifierContext,
  apiKey: string
): Promise<ClassifierResult> {
  const recentContext = context.recentTurns
    .slice(-3)
    .map((t) => `${t.speaker}: ${t.content}`)
    .join("\n");

  const userPrompt = `Scenario: ${context.scenarioContext}
Current escalation level: ${context.currentEscalation}/10

Recent conversation:
${recentContext}

TRAINEE's latest utterance to classify:
"${utterance}"`;

  return requestClassification(
    context,
    apiKey,
    TRAINEE_CLASSIFIER_SYSTEM_PROMPT,
    userPrompt
  );
}

export async function classifyPatientResponse(
  utterance: string,
  context: ClassifierContext,
  apiKey: string
): Promise<ClassifierResult> {
  const recentContext = context.recentTurns
    .slice(-4)
    .map((turn) => `${turn.speaker}: ${turn.content}`)
    .join("\n");

  const userPrompt = `Scenario: ${context.scenarioContext}
Current escalation level: ${context.currentEscalation}/10

Recent conversation:
${recentContext}

PATIENT OR RELATIVE's latest utterance to classify for state movement:
"${utterance}"

Assess whether this shows the person becoming more escalated and closed-off, more settled and open, or roughly unchanged.`;

  return requestClassification(
    context,
    apiKey,
    PATIENT_RESPONSE_CLASSIFIER_SYSTEM_PROMPT,
    userPrompt
  );
}
