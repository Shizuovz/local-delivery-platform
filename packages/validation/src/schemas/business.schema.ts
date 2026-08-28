import { z } from 'zod';

export const createBusinessDeliverySchema = z.object({
  businessId: z.string().uuid(),
});
