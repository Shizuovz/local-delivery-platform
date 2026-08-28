export interface Business {
  id: string;
  ownerUserId: string;
  name: string;
  status: 'PENDING' | 'APPROVED' | 'SUSPENDED';
  billingMode: 'PREPAID' | 'POSTPAID';
}
