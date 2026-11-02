// Phone photos are big; shrink so each upload stays small and quick.
export async function downscale(file: File, maxSide = 2000): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not process the photo."))),
      "image/jpeg",
      0.85,
    ),
  );
}

/** Reads a JSON error body, tolerating non-JSON responses (e.g. a platform error page). */
export async function readJson<T extends { error?: string }>(res: Response): Promise<T> {
  const raw = await res.text();
  let json = {} as T;
  try {
    json = raw ? (JSON.parse(raw) as T) : json;
  } catch {
    // fall through to the status message
  }
  if (!res.ok) {
    throw new Error(
      json.error ??
        (res.status === 413 ? "The photo is too large for the server." : `Server error (HTTP ${res.status}).`),
    );
  }
  return json;
}
