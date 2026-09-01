import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function signProofFileUrl(proofId: string, ttlMs = DEFAULT_TTL_MS) {
  const expires = Date.now() + ttlMs;
  const token = proofFileToken(proofId, expires);
  return `/api/v1/proofs/${proofId}/file?expires=${expires}&token=${token}`;
}

export function verifyProofFileToken(proofId: string, expires: number, token: string | undefined) {
  if (!token) return false;
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = proofFileToken(proofId, expires);
  const left = Buffer.from(expected);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function proofFileToken(proofId: string, expires: number) {
  const secret = process.env.OBJECT_STORAGE_SIGNING_SECRET ?? process.env.PROOF_FILE_SIGNING_SECRET ?? 'dev-private-file-secret';
  return createHmac('sha256', secret).update(`read:/api/v1/proofs/${proofId}/file:${proofId}:${expires}`).digest('hex');
}
