import { z } from 'zod';

export const riderAvailabilitySchema = z.object({
  online: z.boolean(),
});

export const riderLocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

export const deliveryProofSchema = z.object({
  otp: z.string().length(6).optional(),
  photoUrl: z.string().url().optional(),
  signatureUrl: z.string().url().optional(),
  photoObjectKey: z.string().startsWith('private/proofs/').optional(),
  signatureObjectKey: z.string().startsWith('private/proofs/').optional(),
});

export const signedUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(160),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
});

export const proofUploadUrlSchema = signedUploadRequestSchema.extend({
  deliveryId: z.string().uuid(),
  type: z.enum(['PHOTO', 'SIGNATURE']),
});

export const riderDocumentUploadUrlSchema = signedUploadRequestSchema.extend({
  type: z.enum(['ID_PROOF', 'DRIVING_LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE', 'BACKGROUND_CHECK']),
  expiresAt: z.string().datetime().optional(),
});
