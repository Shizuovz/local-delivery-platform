export interface DeliveryItem {
  id: string;
  deliveryId: string;
  description: string;
  packageClass: 'SMALL' | 'MEDIUM' | 'LARGE';
  approximateWeightGrams?: number;
  quantity: number;
  declaredValueMinor?: number;
  notes?: string;
}
