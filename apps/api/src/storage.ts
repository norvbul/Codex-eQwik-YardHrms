import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { check } from './core.js';
const endpoint = process.env.S3_ENDPOINT;
if (process.env.NODE_ENV === 'production' && endpoint)
  check(
    endpoint.startsWith('https://'),
    500,
    'STORAGE_TLS',
    'Production object storage must use verified HTTPS',
  );
export const storage = new S3Client({
  endpoint,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: Boolean(endpoint),
  ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? {
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY,
        },
      }
    : {}),
});
export const bucket = process.env.S3_BUCKET || 'yardhrms-private';
let ready: Promise<void> | undefined;
export function ensureStorage() {
  return (
    ready ||
    (ready = (async () => {
      try {
        await storage.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404
        )
          throw error;
        await storage.send(
          new CreateBucketCommand({
            Bucket: bucket,
            ...(process.env.S3_REGION && process.env.S3_REGION !== 'us-east-1'
              ? {
                  CreateBucketConfiguration: {
                    LocationConstraint: process.env
                      .S3_REGION as import('@aws-sdk/client-s3').BucketLocationConstraint,
                  },
                }
              : {}),
          }),
        );
      }
    })().catch((error) => {
      ready = undefined;
      throw error;
    }))
  );
}
export async function storePrivate(key: string, body: Buffer, contentType: string) {
  await ensureStorage();
  await storage.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
    }),
  );
}
export async function hasPrivate(key: string) {
  try {
    await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
      return false;
    throw error;
  }
}
export async function readPrivate(key: string) {
  const result = await storage.send(
    new GetObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }),
  );
  check(result.Body, 404, 'FILE_NOT_FOUND', 'Protected file not found');
  return Buffer.from(await result.Body.transformToByteArray());
}
