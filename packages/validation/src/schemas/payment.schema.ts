import { z } from 'zod';

export const mockPaymentConfirmSchema = z.object({
  paymentId: z.string().uuid(),
  providerEventId: z.string().min(6),
});
