import { z } from 'zod';

export const mockPaymentConfirmSchema = z.object({
  paymentId: z.string().uuid(),
  providerEventId: z.string().min(6),
}).strict();

export const mockPaymentWebhookSchema = z.object({
  providerEventId: z.string().min(6),
  providerRef: z.string().min(6),
  status: z.enum(['PAID', 'FAILED']),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default('INR'),
}).strict();
