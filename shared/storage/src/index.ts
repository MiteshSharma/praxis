import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

export class StorageNotConfiguredError extends Error {
  constructor() {
    super('Storage is not configured — set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY');
    this.name = 'StorageNotConfiguredError';
  }
}

export interface StorageClient {
  getObjectAsString(key: string): Promise<string>;
  putObject(key: string, body: string, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

function buildClient(): { client: S3Client; bucket: string } | null {
  const endpoint = process.env.STORAGE_ENDPOINT;
  const bucket = process.env.STORAGE_BUCKET ?? 'praxis';
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;
  const region = process.env.STORAGE_REGION ?? 'us-east-1';

  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // required for MinIO
  });

  return { client, bucket };
}

// Lazy singleton — built on first use so env vars are fully loaded.
let _instance: { client: S3Client; bucket: string } | null | undefined;

function getInstance(): { client: S3Client; bucket: string } {
  if (_instance === undefined) {
    _instance = buildClient();
  }
  if (!_instance) throw new StorageNotConfiguredError();
  return _instance;
}

export const storage: StorageClient = {
  async getObjectAsString(key: string): Promise<string> {
    const { client, bucket } = getInstance();
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`storage: empty body for key ${key}`);
    return res.Body.transformToString('utf-8');
  },

  async putObject(key: string, body: string, contentType: string): Promise<void> {
    const { client, bucket } = getInstance();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  },

  async deleteObject(key: string): Promise<void> {
    const { client, bucket } = getInstance();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  },
};
