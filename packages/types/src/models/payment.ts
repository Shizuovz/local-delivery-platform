import { PaymentStatus } from '../enums/payment-status';

export interface Payment {
  id: string;
  deliveryId: string;
  provider: 'mock' | 'razorpay';
  providerRef: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
}
