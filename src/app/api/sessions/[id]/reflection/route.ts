import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const VALID_TAGS = ["frustrated", "anxious", "confident", "drained", "fine"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const tags: string[] = Array.isArray(body.tags)
    ? body.tags.filter((t: string) => VALID_TAGS.includes(t))
    : [];
  const freeText: string | null = typeof body.free_text === "string" && body.free_text.trim()
    ? body.free_text.trim()
    : null;

  const { data, error } = await supabase
    .from("session_reflections")
    .upsert(
      {
        session_id: sessionId,
        user_id: user.id,
        tags,
        free_text: freeText,
      },
      { onConflict: "session_id" }
    )
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id }, { status: 201 });
}
