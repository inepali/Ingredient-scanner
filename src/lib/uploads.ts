// Rules for videos you upload yourself (client-safe).
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
export const MAX_UPLOADS = 6;

/** Picks the type from the browser's MIME type, falling back to the file extension (phones often send nothing). */
export function videoTypeFor(name: string, mime: string): { type: string; ext: string } | null {
  if (VIDEO_TYPES[mime]) return { type: mime, ext: VIDEO_TYPES[mime] };
  const ext = /\.(mp4|mov|webm|m4v)$/i.exec(name)?.[1]?.toLowerCase();
  if (!ext) return null;
  if (ext === "mov") return { type: "video/quicktime", ext };
  if (ext === "webm") return { type: "video/webm", ext };
  return { type: "video/mp4", ext: ext === "m4v" ? "mp4" : ext };
}
