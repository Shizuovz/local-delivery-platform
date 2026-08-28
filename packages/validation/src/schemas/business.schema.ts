import { z } from 'zod';
import { addressInputSchema } from './delivery.schema';

export const createBusinessDeliverySchema = z.object({
  businessId: z.string().uuid(),
  idempotencyKey: z.string().min(8),
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
