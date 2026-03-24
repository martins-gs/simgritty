import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SYSTEM_PROMPT = `You are an expert NHS clinician demonstrating de-escalation technique.
You are taking over a live conversation from a trainee who is struggling.

Review the conversation so far and the patient's current emotional state, then generate your next spoken response.

RULES:
- Speak as a calm, confident, experienced British clinician
- Use natural spoken language, not written prose
- 1-3 sentences maximum
- Use established de-escalation techniques:
  - Name the emotion you observe ("I can see you're really frustrated")
  - Validate without agreeing ("That sounds like a really difficult situation")
  - Offer a concrete immediate action ("Here's what I'm going to do right now")
  - Set a boundary calmly if needed ("I want to help you, and I need us to talk this through together")
- Do NOT: apologise excessively, be patronising, use jargon, or promise things you can't deliver
- Respond to what the patient JUST said, not to the general situation
- Use British English throughout

Return JSON only: { "text": "your spoken response", "technique": "brief name of technique used" }`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });

  const { recentTurns, escalationLevel, scenarioContext } = await request.json();

  const conversationText = (recentTurns as { speaker: string; content: string }[])
    .map((t) => `${t.speaker === "trainee" ? "Trainee" : t.speaker === "ai" ? "Patient" : "AI Clinician"}: ${t.content}`)
    .join("\n");

  const userPrompt = `Scenario: ${scenarioContext}
Current escalation level: ${escalationLevel}/10

Conversation so far:
${conversationText}

Generate your next de-escalation response as the clinician taking over.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: 250,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Failed to generate response" }, { status: 500 });
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  try {
    const parsed = JSON.parse(content);
    return NextResponse.json({
      text: parsed.text || "I can see this is a difficult situation. Let me help.",
      technique: parsed.technique || "general de-escalation",
    });
  } catch {
    return NextResponse.json({
      text: "I can see this is a difficult situation. Let me help.",
      technique: "general de-escalation",
    });
  }
}
