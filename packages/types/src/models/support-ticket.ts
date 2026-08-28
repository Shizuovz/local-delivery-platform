export interface SupportTicket {
  id: string;
  deliveryId: string;
  userId: string;
  category: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  createdAt: string;
}
