import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Delete child records first (cascade should handle it, but be explicit)
  await supabase.from("educator_notes").delete().eq("session_id", id);
  await supabase.from("simulation_state_events").delete().eq("session_id", id);
  await supabase.from("transcript_turns").delete().eq("session_id", id);
  const { error } = await supabase.from("simulation_sessions").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
