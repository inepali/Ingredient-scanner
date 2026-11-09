// Row shapes for the tables the video pipeline touches. Supabase's client is
// untyped here, so routes cast query results to these.

export type MediaKind = "label" | "product_image" | "product_video" | "clip";

export type MediaRow = {
  id: string;
  scan_id: string;
  kind: MediaKind;
  storage_path: string;
  sort_order: number;
  source_media_id: string | null;
};

export type VideoRow = {
  id: string;
  scan_id: string;
  script: string | null;
  voice_id: string | null;
  audio_path: string | null;
  voiceover_id: string | null;
  video_path: string | null;
  duration_s: number | null;
  words: { text: string; start: number; end: number }[] | null;
  version: number;
};

export type JobRow = {
  id: string;
  scan_id: string;
  step: string;
  status: "queued" | "running" | "done" | "failed";
  cost_usd: number;
  error: string | null;
  external_id: string | null;
  status_url: string | null;
  response_url: string | null;
  input: { media_id?: string; prompt?: string; resolution?: string; index?: number } | null;
  output: Record<string, unknown> | null;
  created_at: string;
};

export type CopyRow = {
  platform: "tiktok" | "instagram" | "youtube";
  title: string | null;
  description: string | null;
  hashtags: string[] | null;
};

export type VoiceoverRow = {
  id: string;
  scan_id: string;
  video_id: string;
  voice_id: string | null;
  voice_name: string | null;
  delivery: string | null;
  audio_path: string;
  duration_s: number | null;
  characters: number | null;
  mock: boolean;
  created_at: string;
};
