import { NextResponse } from "next/server";
import { createAdminClientIfAvailable, createClient } from "@/lib/supabase/server";

const SIGNED_URL_EXPIRY_SECONDS = 3600;

async function getOwnedSession(
  sessionId: string,
  userId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data, error } = await supabase
    .from("simulation_sessions")
    .select("id, trainee_id, recording_path, recording_started_at")
    .eq("id", sessionId)
    .eq("trainee_id", userId)
    .maybeSingle();

  if (error) {
    return { error: NextResponse.json({ error: error.message }, { status: 500 }), session: null };
  }

  if (!data) {
    return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }), session: null };
  }

  return { error: null, session: data };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error: ownershipError, session } = await getOwnedSession(id, user.id, authSupabase);
  if (ownershipError) return ownershipError;

  if (!session?.recording_path) {
    return NextResponse.json({ url: null, recordingStartedAt: null });
  }

  const storageSupabase = createAdminClientIfAvailable() ?? authSupabase;
  const { data, error } = await storageSupabase.storage
    .from("simulation-audio")
    .createSignedUrl(session.recording_path, SIGNED_URL_EXPIRY_SECONDS);

  if (error) {
    console.error("[Audio] Failed to create signed URL", error);
    return NextResponse.json({ url: null, recordingStartedAt: null });
  }

  return NextResponse.json({
    url: data.signedUrl,
    recordingStartedAt: session.recording_started_at,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error: ownershipError } = await getOwnedSession(id, user.id, authSupabase);
  if (ownershipError) return ownershipError;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const recordingStartedAt = formData.get("recording_started_at") as string | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const extension = file.type.includes("mp4") ? "mp4" : "webm";
  const storagePath = `${id}/recording.${extension}`;
  const storageSupabase = createAdminClientIfAvailable() ?? authSupabase;

  const { error: uploadError } = await storageSupabase.storage
    .from("simulation-audio")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadError) {
    console.error("[Audio Upload] Storage upload failed", uploadError);
    return NextResponse.json(
      { error: uploadError.message },
      { status: 500 }
    );
  }

  // Persist the path and recording start time on the session record
  const updatePayload: Record<string, unknown> = { recording_path: storagePath };
  if (recordingStartedAt) {
    updatePayload.recording_started_at = recordingStartedAt;
  }
  const { error: updateError } = await storageSupabase
    .from("simulation_sessions")
    .update(updatePayload)
    .eq("id", id)
    .eq("trainee_id", user.id);

  if (updateError) {
    console.error("[Audio Upload] Failed to save recording_path", updateError);
    return NextResponse.json(
      { error: "Audio uploaded but failed to save path: " + updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ path: storagePath }, { status: 201 });
}
