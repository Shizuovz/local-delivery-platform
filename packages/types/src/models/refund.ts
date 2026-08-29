import { RefundStatus } from '../enums/refund-status';

export interface Refund {
  id: string;
  paymentId: string;
  amountMinor: number;
  status: RefundStatus;
  reason: string;
  idempotencyKey?: string;
  providerRefundRef?: string;
  requestedBy?: string;
  processedAt?: string;
}
