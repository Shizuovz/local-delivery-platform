export interface BusinessSettlement {
  id: string;
  businessId: string;
  deliveryId: string;
  amountMinor: number;
  currency: string;
  status: 'OPEN' | 'INVOICED' | 'PAID' | 'ADJUSTED';
}
