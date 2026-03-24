import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyUtterance } from "@/lib/engine/classifierPipeline";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
  }

  const { utterance, context } = await request.json();

  const result = await classifyUtterance(utterance, context, apiKey);

  return NextResponse.json(result);
}
