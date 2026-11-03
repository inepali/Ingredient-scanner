import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 (S3-compatible) storage. Server-only. Images (label photos,
// product photos) and videos live in separate private buckets; read access is
// via short-lived signed URLs. scan_media.storage_path / videos.video_path hold
// the object key.
export type MediaBucket = "images" | "videos";

const BUCKET_VARS: Record<MediaBucket, string> = {
  images: "R2_IMAGES_BUCKET",
  videos: "R2_VIDEOS_BUCKET",
};

function client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set");
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function bucketName(bucket: MediaBucket) {
  const name = process.env[BUCKET_VARS[bucket]];
  if (!name) throw new Error(`${BUCKET_VARS[bucket]} must be set`);
  return name;
}

export async function putMedia(
  bucket: MediaBucket,
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
) {
  await client().send(
    new PutObjectCommand({ Bucket: bucketName(bucket), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function mediaUrl(
  bucket: MediaBucket,
  key: string,
  expiresInSeconds = 3600,
  downloadName?: string,
) {
  const command = new GetObjectCommand({
    Bucket: bucketName(bucket),
    Key: key,
    ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName}"` } : {}),
  });
  return getSignedUrl(client(), command, {
    expiresIn: expiresInSeconds,
  });
}

export async function getMedia(bucket: MediaBucket, key: string): Promise<Buffer> {
  const res = await client().send(new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }));
  if (!res.Body) throw new Error(`Empty object: ${key}`);
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function deleteMedia(bucket: MediaBucket, key: string) {
  await client().send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key }));
}

/** Signed URLs for many objects at once, keyed by object key. */
export async function mediaUrls(
  items: { bucket: MediaBucket; key: string }[],
  expiresInSeconds = 3600,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    items.map(async ({ bucket, key }) => {
      if (!map.has(key)) map.set(key, await mediaUrl(bucket, key, expiresInSeconds));
    }),
  );
  return map;
}

/** A one-hour link the browser can PUT a file to directly (videos are too big to relay through the server). */
export async function presignUpload(bucket: MediaBucket, key: string, contentType: string, expiresInSeconds = 3600) {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucketName(bucket), Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  );
}

/** Size in bytes of a stored object, or null if it isn't there. */
export async function objectSize(bucket: MediaBucket, key: string): Promise<number | null> {
  try {
    const res = await client().send(new HeadObjectCommand({ Bucket: bucketName(bucket), Key: key }));
    return res.ContentLength ?? 0;
  } catch {
    return null;
  }
}
