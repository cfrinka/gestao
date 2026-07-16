export interface SyncResult {
  synced: number;
  fixed: number;
  message: string;
}

export interface CommissionMonth {
  month: string;
  totalSales: number;
  commission: number;
}

export interface UserCommission {
  userId: string;
  userName: string;
  role: string;
  months: CommissionMonth[];
  totalSalesOverall: number;
  totalCommission: number;
}

export interface CommissionReport {
  isAdmin: boolean;
  currentUserId: string;
  data: UserCommission[];
}
