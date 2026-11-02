import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

export async function mediaUrl(bucket: MediaBucket, key: string, expiresInSeconds = 3600) {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }), {
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
