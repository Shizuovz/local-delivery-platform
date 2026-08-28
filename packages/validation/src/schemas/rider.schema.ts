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
});
