import { z } from 'zod';

export const addressInputSchema = z.object({
  label: z.string().optional(),
  line1: z.string().min(3),
  city: z.string().min(2),
  lat: z.number(),
  lng: z.number(),
}).strict();

const deliveryItemSchema = z.object({
  description: z.string().min(2),
  packageClass: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
  approximateWeightGrams: z.number().int().positive().optional(),
  quantity: z.number().int().positive().default(1),
  declaredValueMinor: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
}).strict();

const sendQuoteSchema = z.object({
  type: z.literal('SEND'),
  pickupAddress: addressInputSchema,
  dropAddress: addressInputSchema,
  item: deliveryItemSchema,
}).strict();

const limitedFetchQuoteSchema = z.object({
  type: z.literal('LIMITED_FETCH'),
  pickupAddress: addressInputSchema,
  dropAddress: addressInputSchema,
  item: deliveryItemSchema,
  pickupReference: z.string().min(3),
  pickupInstructions: z.string().min(3),
  itemAlreadyPaid: z.literal(true),
}).strict();

export const quoteDeliverySchema = z.discriminatedUnion('type', [
  sendQuoteSchema,
  limitedFetchQuoteSchema,
]);

export const createDeliverySchema = z.object({
  quoteId: z.string().uuid(),
  idempotencyKey: z.string().min(8),
}).strict();

export const cancelDeliverySchema = z.object({
  reason: z.string().min(3),
}).strict();
