import { Injectable } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

export type PrivateObjectScope = 'proofs' | 'rider-documents';

export interface SignedUploadRequest {
  scope: PrivateObjectScope;
  ownerId: string;
  fileName: string;
  contentType: string;
  ttlSeconds?: number;
}

export interface SignedUpload {
  storageProvider: string;
  bucket: string;
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  expiresAt: string;
  headers: Record<string, string>;
}

export interface SignedRead {
  storageProvider: string;
  bucket: string;
  objectKey: string;
  readUrl: string;
  method: 'GET';
  expiresAt: string;
}

const DEFAULT_UPLOAD_TTL_SECONDS = 5 * 60;
const DEFAULT_READ_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ObjectStorageService {
  private readonly s3Client = this.createS3Client();

  async createSignedUpload(input: SignedUploadRequest): Promise<SignedUpload> {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_UPLOAD_TTL_SECONDS;
    const expires = Date.now() + ttlSeconds * 1000;
    const objectKey = this.privateObjectKey(input.scope, input.ownerId, input.fileName);

    if (this.s3Client) {
      const command = new PutObjectCommand({
        Bucket: this.bucket(),
        Key: objectKey,
        ContentType: input.contentType,
      });
      return {
        storageProvider: this.provider(),
        bucket: this.bucket(),
        objectKey,
        uploadUrl: await getSignedUrl(this.s3Client, command, { expiresIn: ttlSeconds }),
        method: 'PUT',
        expiresAt: new Date(expires).toISOString(),
        headers: {
          'content-type': input.contentType,
        },
      };
    }

    const token = this.sign(`upload:${objectKey}:${input.contentType}:${expires}`);

    return {
      storageProvider: this.provider(),
      bucket: this.bucket(),
      objectKey,
      uploadUrl: `/api/v1/storage/mock-upload?key=${encodeURIComponent(objectKey)}&contentType=${encodeURIComponent(input.contentType)}&expires=${expires}&token=${token}`,
      method: 'PUT',
      expiresAt: new Date(expires).toISOString(),
      headers: {
        'content-type': input.contentType,
        'x-private-object-key': objectKey,
      },
    };
  }

  signReadUrl(path: string, id: string, ttlMs = DEFAULT_READ_TTL_MS) {
    const expires = Date.now() + ttlMs;
    const token = this.signReadToken(path, id, expires);
    return `${path}?expires=${expires}&token=${token}`;
  }

  async createSignedRead(objectKey: string, ttlMs = DEFAULT_READ_TTL_MS): Promise<SignedRead | null> {
    if (!this.s3Client) return null;
    const expiresIn = Math.max(1, Math.floor(ttlMs / 1000));
    const expires = Date.now() + expiresIn * 1000;
    const command = new GetObjectCommand({
      Bucket: this.bucket(),
      Key: objectKey,
    });
    return {
      storageProvider: this.provider(),
      bucket: this.bucket(),
      objectKey,
      readUrl: await getSignedUrl(this.s3Client, command, { expiresIn }),
      method: 'GET',
      expiresAt: new Date(expires).toISOString(),
    };
  }

  verifyReadUrl(path: string, id: string, expires: number, token: string | undefined) {
    if (!token) return false;
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    return this.timingSafeEquals(this.signReadToken(path, id, expires), token);
  }

  verifyUploadUrl(objectKey: string, contentType: string, expires: number, token: string | undefined) {
    if (!token) return false;
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    return this.timingSafeEquals(this.sign(`upload:${objectKey}:${contentType}:${expires}`), token);
  }

  isPrivateObjectKey(value: string | undefined) {
    return Boolean(value?.startsWith('private/proofs/') || value?.startsWith('private/rider-documents/'));
  }

  health() {
    const provider = this.provider();
    const s3Mode = provider === 's3' || provider === 's3-compatible';
    return {
      provider,
      bucket: this.bucket(),
      configured: s3Mode ? Boolean(this.s3Client) : true,
      mode: s3Mode ? 'provider-presigned' : 'mock-presigned',
    };
  }

  privateObjectKey(scope: PrivateObjectScope, ownerId: string, fileName: string) {
    const safeName = fileName
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'file';
    return `private/${scope}/${ownerId}/${randomUUID()}-${safeName}`;
  }

  private provider() {
    return process.env.OBJECT_STORAGE_PROVIDER ?? 'mock-s3-compatible';
  }

  private bucket() {
    return process.env.OBJECT_STORAGE_BUCKET ?? process.env.S3_BUCKET ?? 'local-delivery-private';
  }

  private createS3Client() {
    const provider = this.provider();
    const endpoint = process.env.OBJECT_STORAGE_ENDPOINT ?? process.env.S3_ENDPOINT;
    const accessKeyId = process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY;
    const region = process.env.OBJECT_STORAGE_REGION ?? process.env.S3_REGION ?? 'us-east-1';
    if (provider !== 's3' && provider !== 's3-compatible') return null;
    if (!endpoint || !accessKeyId || !secretAccessKey || !this.bucket()) return null;

    return new S3Client({
      region,
      endpoint,
      forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  private signReadToken(path: string, id: string, expires: number) {
    return this.sign(`read:${path}:${id}:${expires}`);
  }

  private sign(payload: string) {
    const secret = process.env.OBJECT_STORAGE_SIGNING_SECRET ?? process.env.PROOF_FILE_SIGNING_SECRET ?? 'dev-private-file-secret';
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  private timingSafeEquals(left: string, right: string) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
