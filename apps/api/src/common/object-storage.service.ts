import { Injectable } from '@nestjs/common';
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

const DEFAULT_UPLOAD_TTL_SECONDS = 5 * 60;
const DEFAULT_READ_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ObjectStorageService {
  createSignedUpload(input: SignedUploadRequest): SignedUpload {
    const ttlSeconds = input.ttlSeconds ?? DEFAULT_UPLOAD_TTL_SECONDS;
    const expires = Date.now() + ttlSeconds * 1000;
    const objectKey = this.privateObjectKey(input.scope, input.ownerId, input.fileName);
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
    return process.env.OBJECT_STORAGE_BUCKET ?? 'local-delivery-private';
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
