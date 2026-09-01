export interface AdminOperationsReport {
  generatedAt: string;
  cache: {
    key: string;
    ttlSeconds: number;
    hit: boolean;
  };
  deliveryCounts: {
    active: number;
    searchingRider: number;
    assigned: number;
    deliveredToday: number;
    cancelledToday: number;
    failedOrDisputed: number;
  };
  paymentCounts: {
    refundPending: number;
    paid: number;
    failed: number;
  };
  supportCounts: {
    open: number;
    inProgress: number;
    closedToday: number;
  };
  dispatchCounts: {
    adminAttention: number;
    unassignedSearching: number;
    staleSearching: number;
  };
}
