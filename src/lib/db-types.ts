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
  video_path: string | null;
  duration_s: number | null;
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
};

export type CopyRow = {
  platform: "tiktok" | "instagram";
  title: string | null;
  description: string | null;
  hashtags: string[] | null;
};
