import { AwsClient } from "aws4fetch";

const MAX_PRESIGN_SIZE = 500 * 1024 * 1024; // 500 MB
const PRESIGN_EXPIRES = 3600; // 1 hour

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "video/*",
];

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.some((allowed) => {
    if (allowed.endsWith("/*")) {
      return mimeType.startsWith(allowed.replace("/*", "/"));
    }
    return mimeType === allowed;
  });
}

export interface PresignResult {
  upload_url: string;
  r2_key: string;
  filename: string;
  expires_in: number;
}

export async function generatePresignedUploadUrl(
  r2AccessKeyId: string,
  r2SecretAccessKey: string,
  cfAccountId: string,
  bucketName: string,
  r2Key: string,
  contentType: string
): Promise<string> {
  const client = new AwsClient({
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
    service: "s3",
    region: "auto",
  });

  const url = new URL(
    `https://${cfAccountId}.r2.cloudflarestorage.com/${bucketName}/${r2Key}`
  );
  url.searchParams.set("X-Amz-Expires", PRESIGN_EXPIRES.toString());

  const signed = await client.sign(
    new Request(url.toString(), {
      method: "PUT",
      headers: { "Content-Type": contentType },
    }),
    { aws: { signQuery: true } }
  );

  return signed.url;
}

export { MAX_PRESIGN_SIZE, PRESIGN_EXPIRES };

export async function uploadToR2(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer | ReadableStream,
  contentType: string
): Promise<R2Object> {
  return bucket.put(key, data, {
    httpMetadata: { contentType },
  });
}

export async function downloadFromR2(
  bucket: R2Bucket,
  key: string
): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteFromR2(
  bucket: R2Bucket,
  key: string
): Promise<void> {
  await bucket.delete(key);
}

// R2 accepts up to 1000 keys per delete call. Batching keeps large cleanups
// (perpetual forms accumulate submissions for years) inside the Workers
// per-invocation subrequest limit.
export async function deleteManyFromR2(
  bucket: R2Bucket,
  keys: string[]
): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}

export function buildR2Key(
  token: string,
  filename: string,
  category: string
): string {
  return `intake/${token}/${category}/${filename}`;
}
