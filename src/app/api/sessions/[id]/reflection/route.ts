import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/validation/http";
import { reflectionRequestBodySchema } from "@/lib/validation/schemas";

const VALID_TAGS = ["frustrated", "anxious", "confident", "drained", "fine"];
const REFLECTION_MIGRATION_ERROR =
  "Reflection storage is not available until the latest database migration is applied.";

function isReflectionStorageSchemaError(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "42P10" || error.code === "42703") {
    return true;
  }
  return (
    error.message?.includes("session_reflections") === true ||
    error.message?.includes("ON CONFLICT specification") === true
  );
}

async function ensureOwnedSession(
  sessionId: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data, error } = await supabase
    .from("simulation_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("trainee_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownershipError = await ensureOwnedSession(sessionId, user.id, supabase);
  if (ownershipError) return ownershipError;

  const { data, error } = await supabase
    .from("session_reflections")
    .select("id, session_id, user_id, tags, free_text, created_at, updated_at")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (isReflectionStorageSchemaError(error)) {
    return NextResponse.json(
      { error: REFLECTION_MIGRATION_ERROR, needs_migration: true },
      { status: 503 }
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ownershipError = await ensureOwnedSession(sessionId, user.id, supabase);
  if (ownershipError) return ownershipError;

  const parsed = await parseRequestJson(request, reflectionRequestBodySchema);
  if (!parsed.success) return parsed.response;

  const body = parsed.data;
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
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,user_id" }
    )
    .select("id, session_id, user_id, tags, free_text, created_at, updated_at")
    .single();

  if (isReflectionStorageSchemaError(error)) {
    return NextResponse.json(
      { error: REFLECTION_MIGRATION_ERROR, needs_migration: true },
      { status: 503 }
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}
