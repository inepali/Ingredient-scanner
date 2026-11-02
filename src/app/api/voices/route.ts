import { listVoices } from "@/lib/elevenlabs";
import { supabase } from "@/lib/supabase";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";

// Voices in your ElevenLabs account plus the one currently chosen.
export const GET = handler(async () => {
  const voices = await listVoices();
  const { data: settings } = await supabase().from("settings").select("default_voice_id").eq("id", 1).maybeSingle();
  const preferred: string = settings?.default_voice_id || process.env.ELEVENLABS_VOICE_ID || "";
  // Fall back to the first free voice if the saved one isn't in this account.
  const selected = voices.find((v) => v.id === preferred)?.id ?? voices.find((v) => v.free)?.id ?? voices[0]?.id ?? "";
  return json({ voices, selected });
});
