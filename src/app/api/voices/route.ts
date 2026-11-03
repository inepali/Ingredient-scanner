import { VoicesPermissionError, listVoices } from "@/lib/elevenlabs";
import { supabase } from "@/lib/supabase";
import { handler, json } from "@/lib/http";

export const runtime = "nodejs";

// Voices in your ElevenLabs account plus the one currently chosen.
export const GET = handler(async () => {
  const { data: settings } = await supabase().from("settings").select("default_voice_id").eq("id", 1).maybeSingle();
  const preferred: string = settings?.default_voice_id || process.env.ELEVENLABS_VOICE_ID || "";
  let voices;
  try {
    voices = await listVoices();
  } catch (err) {
    // A key without voices_read can still speak; let the page take a voice ID by hand.
    if (err instanceof VoicesPermissionError) return json({ voices: [], selected: preferred, warning: err.message });
    throw err;
  }
  // Fall back to the first free voice if the saved one isn't in this account.
  const selected = voices.find((v) => v.id === preferred)?.id ?? voices.find((v) => v.free)?.id ?? voices[0]?.id ?? "";
  return json({ voices, selected });
});
