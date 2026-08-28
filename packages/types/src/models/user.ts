export type UserRole = 'CUSTOMER' | 'RIDER' | 'BUSINESS' | 'OPS_ADMIN' | 'FINANCE_ADMIN' | 'SUPER_ADMIN';

export interface User {
  id: string;
  phone: string;
  email?: string;
  name?: string;
  status: 'ACTIVE' | 'SUSPENDED';
  roles: UserRole[];
  createdAt: string;
}
