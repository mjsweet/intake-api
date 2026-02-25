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

export function buildR2Key(
  token: string,
  filename: string,
  category: string
): string {
  return `intake/${token}/${category}/${filename}`;
}
