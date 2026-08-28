export interface CreateQuoteDto {
  type: 'SEND';
  pickupAddress: {
    label?: string;
    line1: string;
    city: string;
    lat: number;
    lng: number;
  };
  dropAddress: {
    label?: string;
    line1: string;
    city: string;
    lat: number;
    lng: number;
  };
  item: {
    description: string;
    packageClass: 'SMALL' | 'MEDIUM' | 'LARGE';
    approximateWeightGrams?: number;
    quantity: number;
    declaredValueMinor?: number;
    notes?: string;
  };
}

export interface CreateDeliveryDto {
  quoteId: string;
  idempotencyKey: string;
}
