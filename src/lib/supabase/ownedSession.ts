import type { SupabaseClient } from "@supabase/supabase-js";

interface OwnedSessionResult<TSession> {
  session: TSession | null;
  error: string | null;
  status: number | null;
}

export async function loadOwnedSession<TSession extends Record<string, unknown> = Record<string, unknown>>(
  supabase: SupabaseClient,
  sessionId: string,
  userId: string,
  columns = "id"
): Promise<OwnedSessionResult<TSession>> {
  const { data, error } = await supabase
    .from("simulation_sessions")
    .select(columns)
    .eq("id", sessionId)
    .eq("trainee_id", userId)
    .maybeSingle();

  if (error) {
    return {
      session: null,
      error: error.message,
      status: 500,
    };
  }

  if (!data) {
    return {
      session: null,
      error: "Session not found",
      status: 404,
    };
  }

  return {
    session: data as unknown as TSession,
    error: null,
    status: null,
  };
}
