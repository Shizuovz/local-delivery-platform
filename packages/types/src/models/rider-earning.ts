export interface RiderEarning {
  id: string;
  deliveryId: string;
  riderId: string;
  amountMinor: number;
  currency: string;
  status: 'PENDING' | 'READY' | 'PAID' | 'ADJUSTED';
}
