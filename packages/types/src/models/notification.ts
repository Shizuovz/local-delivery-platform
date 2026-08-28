export interface NotificationLog {
  id: string;
  userId: string;
  channel: 'PUSH' | 'SMS' | 'WHATSAPP' | 'EMAIL';
  template: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  sentAt?: string;
}
