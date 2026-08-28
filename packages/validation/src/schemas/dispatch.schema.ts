import { z } from 'zod';

export const dispatchNowSchema = z.object({
  deliveryId: z.string().uuid(),
});
