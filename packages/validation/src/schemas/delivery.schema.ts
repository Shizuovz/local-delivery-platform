import { z } from 'zod';

export const addressInputSchema = z.object({
  label: z.string().optional(),
  line1: z.string().min(3),
  city: z.string().min(2),
  lat: z.number(),
  lng: z.number(),
});

export const quoteDeliverySchema = z.object({
  type: z.literal('SEND'),
  pickupAddress: addressInputSchema,
  dropAddress: addressInputSchema,
  item: z.object({
    description: z.string().min(2),
    packageClass: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
    approximateWeightGrams: z.number().int().positive().optional(),
    quantity: z.number().int().positive().default(1),
    declaredValueMinor: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
  }),
});

export const createDeliverySchema = z.object({
  quoteId: z.string().uuid(),
  idempotencyKey: z.string().min(8),
});

export const cancelDeliverySchema = z.object({
  reason: z.string().min(3),
});
