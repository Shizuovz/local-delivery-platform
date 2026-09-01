'use client';

import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEFAULT_ADMIN_PHONE = '+910000000001';
const DEFAULT_REASON = 'Operational update from admin UI';

type JsonRecord = Record<string, unknown>;

type DeliverySummary = JsonRecord & {
  id?: string;
  type?: string;
  status?: string;
  businessId?: string | null;
  assignedRiderId?: string | null;
  payment?: PaymentSummary;
  payments?: PaymentSummary[];
  assignments?: AssignmentSummary[];
  refunds?: RefundSummary[];
};

type PaymentSummary = JsonRecord & {
  id?: string;
  status?: string;
  amountMinor?: number;
  currency?: string;
  providerRef?: string;
  refunds?: RefundSummary[];
};

type RefundSummary = JsonRecord & {
  id?: string;
  status?: string;
  amountMinor?: number;
  reason?: string;
};

type AssignmentSummary = JsonRecord & {
  id?: string;
  riderId?: string;
  status?: string;
};

type SupportTicket = JsonRecord & {
  id?: string;
  deliveryId?: string;
  category?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
};

type Timeline = JsonRecord & {
  delivery?: DeliverySummary;
  history?: JsonRecord[];
  audits?: JsonRecord[];
  proofs?: JsonRecord[];
  refunds?: RefundSummary[];
  supportTickets?: SupportTicket[];
};

type AdminOperationsReport = {
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
};

export default function AdminOperationsPage() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [phone, setPhone] = useState(DEFAULT_ADMIN_PHONE);
  const [adminUserId, setAdminUserId] = useState('');
  const [deliveries, setDeliveries] = useState<DeliverySummary[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [operationsReport, setOperationsReport] = useState<AdminOperationsReport | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [deliveryId, setDeliveryId] = useState('');
  const [riderId, setRiderId] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [ticketStatus, setTicketStatus] = useState<SupportTicket['status']>('IN_PROGRESS');
  const [businessStatus, setBusinessStatus] = useState<'PENDING' | 'APPROVED' | 'SUSPENDED'>('APPROVED');
  const [riderApprovalStatus, setRiderApprovalStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('APPROVED');
  const [riderSuspended, setRiderSuspended] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('No response yet.');

  const selectedDelivery = useMemo(
    () => deliveries.find((delivery) => delivery.id === deliveryId) ?? timeline?.delivery,
    [deliveries, deliveryId, timeline],
  );
  const selectedPayments = paymentsForDelivery(selectedDelivery);
  const selectedRefunds = refundsForDelivery(selectedDelivery, timeline);

  async function api<T>(path: string, init?: RequestInit, authUserId = adminUserId): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(authUserId ? { 'x-user-id': authUserId } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    setOutput(JSON.stringify(body, null, 2));
    if (!response.ok) {
      throw new Error(getErrorMessage(body));
    }
    return body as T;
  }

  async function runStep(label: string, action: () => Promise<void>) {
    setBusy(true);
    setStatus(label);
    try {
      await action();
      setStatus(`${label} complete`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    await api('/auth/request-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }, '');
    const result = await api<{ user: { id: string } }>('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code: '123456', roleHint: 'OPS_ADMIN' }),
    }, '');
    setAdminUserId(result.user.id);
  }

  async function loadDeliveries() {
    const result = await api<DeliverySummary[]>('/admin/deliveries');
    setDeliveries(Array.isArray(result) ? result : []);
  }

  async function loadTimeline(targetDeliveryId = deliveryId) {
    if (!targetDeliveryId) throw new Error('Choose a delivery first');
    const result = await api<Timeline>(`/admin/deliveries/${targetDeliveryId}/timeline`);
    setTimeline(result);
    setDeliveryId(targetDeliveryId);
  }

  async function loadSupportTickets() {
    const result = await api<SupportTicket[]>('/admin/support/tickets');
    setSupportTickets(Array.isArray(result) ? result : []);
  }

  async function loadOperationsReport() {
    const result = await api<AdminOperationsReport>('/admin/reports/operations');
    setOperationsReport(result);
  }

  async function assign(reassign = false) {
    await api(`/admin/deliveries/${deliveryId}/${reassign ? 'reassign' : 'assign'}`, {
      method: 'POST',
      body: JSON.stringify({ riderId, reason }),
    });
    await loadDeliveries();
    await loadTimeline(deliveryId);
  }

  async function cancelDelivery() {
    await api(`/admin/deliveries/${deliveryId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await loadDeliveries();
    await loadTimeline(deliveryId);
  }

  async function markException() {
    await api(`/admin/deliveries/${deliveryId}/mark-exception`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    await loadTimeline(deliveryId);
    await loadSupportTickets();
  }

  async function approveRider() {
    await api(`/admin/riders/${riderId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  async function updateRiderStatus() {
    await api(`/admin/riders/${riderId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        approvalStatus: riderApprovalStatus,
        suspended: riderSuspended,
        reason,
      }),
    });
  }

  async function updateBusinessStatus() {
    await api(`/admin/businesses/${businessId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: businessStatus, reason }),
    });
    await loadDeliveries();
  }

  async function updateSupportTicket() {
    await api(`/admin/support/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: ticketStatus, reason }),
    });
    await loadSupportTickets();
    if (deliveryId) await loadTimeline(deliveryId);
  }

  function chooseDelivery(delivery: DeliverySummary) {
    setDeliveryId(String(delivery.id ?? ''));
    setRiderId(String(delivery.assignedRiderId ?? latestAssignment(delivery)?.riderId ?? riderId));
    setBusinessId(String(delivery.businessId ?? businessId));
  }

  function chooseTicket(ticket: SupportTicket) {
    setTicketId(String(ticket.id ?? ''));
    if (ticket.deliveryId) setDeliveryId(ticket.deliveryId);
    if (ticket.status) setTicketStatus(ticket.status);
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Admin Operations</h1>
          <p style={styles.subtle} aria-live="polite">{busy ? 'Working...' : status}</p>
        </div>
        <button disabled={busy} onClick={() => runStep('Admin login', login)} style={styles.primaryButton}>
          Login
        </button>
      </header>

      <section style={styles.panel} aria-labelledby="connection-heading">
        <div style={styles.panelHeader}>
          <h2 id="connection-heading" style={styles.sectionTitle}>Connection</h2>
          <button disabled={busy || !adminUserId} onClick={() => runStep('Load workspace', async () => {
            await loadOperationsReport();
            await loadDeliveries();
            await loadSupportTickets();
          })} style={styles.button}>
            Refresh
          </button>
        </div>
        <div style={styles.grid}>
          <Field label="API URL" value={apiUrl} onChange={setApiUrl} />
          <Field label="Admin Phone" value={phone} onChange={setPhone} />
          <Field label="Admin User ID" value={adminUserId} onChange={setAdminUserId} />
        </div>
      </section>

      <section style={styles.panel} aria-labelledby="operations-heading">
        <div style={styles.panelHeader}>
          <div>
            <h2 id="operations-heading" style={styles.sectionTitle}>Operations Report</h2>
            <p style={styles.subtle}>
              {operationsReport
                ? `Generated ${formatTime(operationsReport.generatedAt)} - cache ${operationsReport.cache.hit ? 'hit' : 'fresh'}`
                : 'Load workspace to refresh operational metrics.'}
            </p>
          </div>
          <button disabled={busy || !adminUserId} onClick={() => runStep('Load operations report', loadOperationsReport)} style={styles.button}>
            Load Report
          </button>
        </div>
        <div style={styles.metricGrid}>
          <Metric label="Active" value={operationsReport?.deliveryCounts.active} tone="neutral" />
          <Metric label="Searching" value={operationsReport?.deliveryCounts.searchingRider} tone="warn" />
          <Metric label="Assigned" value={operationsReport?.deliveryCounts.assigned} tone="neutral" />
          <Metric label="Delivered Today" value={operationsReport?.deliveryCounts.deliveredToday} tone="good" />
          <Metric label="Cancelled Today" value={operationsReport?.deliveryCounts.cancelledToday} tone="bad" />
          <Metric label="Refund Pending" value={operationsReport?.paymentCounts.refundPending} tone="warn" />
          <Metric label="Open Support" value={operationsReport?.supportCounts.open} tone="warn" />
          <Metric label="Admin Attention" value={operationsReport?.dispatchCounts.adminAttention} tone="bad" />
        </div>
      </section>

      <section style={styles.operatingGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.sectionTitle}>Deliveries</h2>
            <span style={styles.count}>{deliveries.length}</span>
          </div>
          <div style={styles.list}>
            {deliveries.length === 0 ? (
              <p style={styles.empty}>No deliveries loaded.</p>
            ) : deliveries.map((delivery) => (
              <button
                key={String(delivery.id)}
                onClick={() => chooseDelivery(delivery)}
                style={{
                  ...styles.deliveryRow,
                  ...(delivery.id === deliveryId ? styles.selectedRow : {}),
                }}
              >
                <span style={styles.rowTop}>
                  <strong>{shortId(delivery.id)}</strong>
                  <StatusBadge status={String(delivery.status ?? 'UNKNOWN')} />
                </span>
                <span style={styles.rowMeta}>
                  {String(delivery.type ?? 'delivery')} {delivery.assignedRiderId ? `- rider ${shortId(delivery.assignedRiderId)}` : '- unassigned'}
                </span>
                <span style={styles.rowMeta}>
                  {paymentLine(paymentsForDelivery(delivery))}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.sectionTitle}>Selected Delivery</h2>
            <button disabled={busy || !deliveryId} onClick={() => runStep('Load timeline', () => loadTimeline())} style={styles.button}>
              Timeline
            </button>
          </div>
          <div style={styles.grid}>
            <Field label="Delivery ID" value={deliveryId} onChange={setDeliveryId} />
            <Field label="Rider ID" value={riderId} onChange={setRiderId} />
            <Field label="Business ID" value={businessId} onChange={setBusinessId} />
            <label style={styles.label}>
              Reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} style={styles.textarea} />
            </label>
          </div>

          <div style={styles.actionGrid}>
            <button disabled={busy || !deliveryId || !riderId} onClick={() => runStep('Assign rider', () => assign(false))} style={styles.button}>
              Assign
            </button>
            <button disabled={busy || !deliveryId || !riderId} onClick={() => runStep('Reassign rider', () => assign(true))} style={styles.button}>
              Reassign
            </button>
            <button disabled={busy || !deliveryId} onClick={() => runStep('Mark exception', markException)} style={styles.warningButton}>
              Mark Exception
            </button>
            <button disabled={busy || !deliveryId} onClick={() => runStep('Cancel delivery', cancelDelivery)} style={styles.dangerButton}>
              Cancel
            </button>
          </div>

          <dl style={styles.summaryGrid}>
            <SummaryItem label="Status" value={String(selectedDelivery?.status ?? 'Not selected')} />
            <SummaryItem label="Type" value={String(selectedDelivery?.type ?? '-')} />
            <SummaryItem label="Assigned Rider" value={shortId(selectedDelivery?.assignedRiderId)} />
            <SummaryItem label="Payment" value={paymentLine(selectedPayments)} />
            <SummaryItem label="Refunds" value={selectedRefunds.length ? `${selectedRefunds.length} refund record(s)` : 'None'} />
          </dl>
        </div>
      </section>

      <section style={styles.operatingGrid}>
        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Rider Control</h2>
          <div style={styles.grid}>
            <label style={styles.label}>
              Approval Status
              <select value={riderApprovalStatus} onChange={(event) => setRiderApprovalStatus(event.target.value as typeof riderApprovalStatus)} style={styles.input}>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </label>
            <label style={styles.checkboxLabel}>
              <input checked={riderSuspended} onChange={(event) => setRiderSuspended(event.target.checked)} type="checkbox" />
              Suspended
            </label>
          </div>
          <div style={styles.actionGrid}>
            <button disabled={busy || !riderId} onClick={() => runStep('Approve rider', approveRider)} style={styles.button}>
              Approve Rider
            </button>
            <button disabled={busy || !riderId} onClick={() => runStep('Update rider status', updateRiderStatus)} style={styles.button}>
              Update Rider
            </button>
          </div>
        </div>

        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Business Control</h2>
          <label style={styles.label}>
            Business Status
            <select value={businessStatus} onChange={(event) => setBusinessStatus(event.target.value as typeof businessStatus)} style={styles.input}>
              <option value="PENDING">PENDING</option>
              <option value="APPROVED">APPROVED</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </label>
          <div style={styles.actionGrid}>
            <button disabled={busy || !businessId} onClick={() => runStep('Update business status', updateBusinessStatus)} style={styles.button}>
              Update Business
            </button>
          </div>
        </div>
      </section>

      <section style={styles.operatingGrid}>
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <h2 style={styles.sectionTitle}>Support Tickets</h2>
            <button disabled={busy || !adminUserId} onClick={() => runStep('Load support tickets', loadSupportTickets)} style={styles.button}>
              Load
            </button>
          </div>
          <div style={styles.list}>
            {supportTickets.length === 0 ? (
              <p style={styles.empty}>No support tickets loaded.</p>
            ) : supportTickets.map((ticket) => (
              <button
                key={String(ticket.id)}
                onClick={() => chooseTicket(ticket)}
                style={{
                  ...styles.deliveryRow,
                  ...(ticket.id === ticketId ? styles.selectedRow : {}),
                }}
              >
                <span style={styles.rowTop}>
                  <strong>{shortId(ticket.id)}</strong>
                  <StatusBadge status={String(ticket.status ?? 'UNKNOWN')} />
                </span>
                <span style={styles.rowMeta}>{String(ticket.category ?? 'support')} - delivery {shortId(ticket.deliveryId)}</span>
              </button>
            ))}
          </div>
          <div style={styles.grid}>
            <Field label="Ticket ID" value={ticketId} onChange={setTicketId} />
            <label style={styles.label}>
              Ticket Status
              <select value={ticketStatus} onChange={(event) => setTicketStatus(event.target.value as SupportTicket['status'])} style={styles.input}>
                <option value="OPEN">OPEN</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="RESOLVED">RESOLVED</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </label>
          </div>
          <button disabled={busy || !ticketId} onClick={() => runStep('Update support ticket', updateSupportTicket)} style={styles.button}>
            Update Ticket
          </button>
        </div>

        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Payments And Refunds</h2>
          <DataList items={selectedPayments} empty="No payment records for selected delivery." />
          <DataList items={selectedRefunds} empty="No refund records for selected delivery." />
        </div>
      </section>

      <section style={styles.operatingGrid}>
        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Timeline</h2>
          <DataList items={timeline?.history ?? []} empty="Load a delivery timeline to see state history." />
        </div>
        <div style={styles.panel}>
          <h2 style={styles.sectionTitle}>Latest API Response</h2>
          <pre style={styles.output}>{output}</pre>
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label style={styles.label}>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} style={styles.input} />
    </label>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.summaryItem}>
      <dt style={styles.summaryLabel}>{label}</dt>
      <dd style={styles.summaryValue}>{value}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span style={{ ...styles.badge, ...badgeTone(status) }}>{status}</span>;
}

function Metric({ label, value, tone }: { label: string; value?: number; tone: 'good' | 'bad' | 'warn' | 'neutral' }) {
  return (
    <div style={{ ...styles.metric, ...metricTone(tone) }}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.metricValue}>{typeof value === 'number' ? value : '-'}</strong>
    </div>
  );
}

function DataList({ items, empty }: { items: JsonRecord[]; empty: string }) {
  if (!items.length) return <p style={styles.empty}>{empty}</p>;
  return (
    <div style={styles.compactList}>
      {items.map((item, index) => (
        <pre key={`${String(item.id ?? index)}`} style={styles.compactOutput}>
          {JSON.stringify(item, null, 2)}
        </pre>
      ))}
    </div>
  );
}

function paymentsForDelivery(delivery?: DeliverySummary | null): PaymentSummary[] {
  if (!delivery) return [];
  if (Array.isArray(delivery.payments)) return delivery.payments;
  if (delivery.payment) return [delivery.payment];
  return [];
}

function refundsForDelivery(delivery?: DeliverySummary | null, timeline?: Timeline | null): RefundSummary[] {
  const fromTimeline = timeline?.refunds ?? [];
  const fromDelivery = [
    ...(delivery?.refunds ?? []),
    ...paymentsForDelivery(delivery).flatMap((payment) => payment.refunds ?? []),
  ];
  const byId = new Map<string, RefundSummary>();
  for (const refund of [...fromTimeline, ...fromDelivery]) {
    byId.set(String(refund.id ?? `${refund.status}-${refund.amountMinor}-${refund.reason}`), refund);
  }
  return [...byId.values()];
}

function latestAssignment(delivery: DeliverySummary): AssignmentSummary | undefined {
  return delivery.assignments?.[delivery.assignments.length - 1];
}

function paymentLine(payments: PaymentSummary[]) {
  if (!payments.length) return 'No payment';
  return payments
    .map((payment) => `${payment.status ?? 'UNKNOWN'} ${formatMoney(payment.amountMinor, payment.currency)}`)
    .join(', ');
}

function formatMoney(amountMinor?: number, currency = 'INR') {
  if (typeof amountMinor !== 'number') return currency;
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function shortId(value?: string | null) {
  if (!value) return '-';
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function getErrorMessage(body: unknown) {
  if (typeof body !== 'object' || body === null) return 'Request failed';
  const record = body as { error?: { message?: unknown }; message?: unknown };
  return String(record.error?.message ?? record.message ?? 'Request failed');
}

function badgeTone(status: string): CSSProperties {
  if (['DELIVERED', 'PAID', 'APPROVED', 'RESOLVED', 'SUCCEEDED'].includes(status)) return styles.badgeGood;
  if (['CANCELLED', 'FAILED', 'REJECTED', 'SUSPENDED', 'CLOSED'].includes(status)) return styles.badgeBad;
  if (['REFUND_PENDING', 'RETURN_REQUIRED', 'DISPUTED', 'IN_PROGRESS'].includes(status)) return styles.badgeWarn;
  return styles.badgeNeutral;
}

function metricTone(tone: 'good' | 'bad' | 'warn' | 'neutral'): CSSProperties {
  if (tone === 'good') return styles.metricGood;
  if (tone === 'bad') return styles.metricBad;
  if (tone === 'warn') return styles.metricWarn;
  return styles.metricNeutral;
}

const styles: Record<string, CSSProperties> = {
  page: {
    background: '#f7f8fb',
    color: '#172033',
    display: 'grid',
    fontFamily: 'system-ui, sans-serif',
    gap: 16,
    margin: '0 auto',
    maxWidth: 1280,
    minHeight: '100dvh',
    padding: '28px 24px 48px',
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 28,
    lineHeight: 1.2,
    margin: 0,
  },
  subtle: {
    color: '#53657d',
    margin: '6px 0 0',
  },
  panel: {
    background: '#ffffff',
    border: '1px solid #d8e0ec',
    borderRadius: 6,
    display: 'grid',
    gap: 12,
    padding: 16,
  },
  panelHeader: {
    alignItems: 'center',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 1.3,
    margin: 0,
  },
  grid: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  },
  operatingGrid: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  },
  metricGrid: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  },
  metric: {
    border: '1px solid #d8e0ec',
    borderRadius: 6,
    display: 'grid',
    gap: 8,
    minHeight: 84,
    padding: 12,
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  metricValue: {
    fontSize: 28,
    lineHeight: 1,
  },
  metricGood: {
    background: '#e7f6ee',
    borderColor: '#8acba4',
    color: '#006c4f',
  },
  metricBad: {
    background: '#fff2f2',
    borderColor: '#f2b8b5',
    color: '#8c1d18',
  },
  metricWarn: {
    background: '#fff8e1',
    borderColor: '#d7b568',
    color: '#694a00',
  },
  metricNeutral: {
    background: '#f7f8fb',
    borderColor: '#d8e0ec',
    color: '#172033',
  },
  label: {
    color: '#42526a',
    display: 'grid',
    fontSize: 12,
    fontWeight: 700,
    gap: 6,
  },
  checkboxLabel: {
    alignItems: 'center',
    color: '#42526a',
    display: 'flex',
    fontSize: 14,
    fontWeight: 700,
    gap: 8,
    minHeight: 44,
  },
  input: {
    background: '#ffffff',
    border: '1px solid #b8c4d6',
    borderRadius: 6,
    color: '#172033',
    font: 'inherit',
    minHeight: 44,
    padding: '10px 12px',
  },
  textarea: {
    background: '#ffffff',
    border: '1px solid #b8c4d6',
    borderRadius: 6,
    color: '#172033',
    font: 'inherit',
    minHeight: 72,
    padding: '10px 12px',
    resize: 'vertical',
  },
  actionGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    background: '#ffffff',
    border: '1px solid #9aabc2',
    borderRadius: 6,
    color: '#172033',
    cursor: 'pointer',
    font: 'inherit',
    minHeight: 44,
    padding: '10px 12px',
  },
  primaryButton: {
    background: '#172033',
    border: '1px solid #172033',
    borderRadius: 6,
    color: '#ffffff',
    cursor: 'pointer',
    font: 'inherit',
    minHeight: 44,
    padding: '10px 14px',
  },
  warningButton: {
    background: '#fff8e1',
    border: '1px solid #a06d00',
    borderRadius: 6,
    color: '#4d3400',
    cursor: 'pointer',
    font: 'inherit',
    minHeight: 44,
    padding: '10px 12px',
  },
  dangerButton: {
    background: '#fff2f2',
    border: '1px solid #b3261e',
    borderRadius: 6,
    color: '#8c1d18',
    cursor: 'pointer',
    font: 'inherit',
    minHeight: 44,
    padding: '10px 12px',
  },
  list: {
    display: 'grid',
    gap: 8,
    maxHeight: 520,
    overflow: 'auto',
  },
  deliveryRow: {
    background: '#fbfcff',
    border: '1px solid #d8e0ec',
    borderRadius: 6,
    color: '#172033',
    cursor: 'pointer',
    display: 'grid',
    gap: 6,
    minHeight: 72,
    padding: 12,
    textAlign: 'left',
  },
  selectedRow: {
    borderColor: '#00687a',
    boxShadow: '0 0 0 2px rgba(0, 104, 122, 0.12)',
  },
  rowTop: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
    justifyContent: 'space-between',
  },
  rowMeta: {
    color: '#53657d',
    fontSize: 12,
    lineHeight: 1.4,
  },
  count: {
    background: '#eef3f8',
    borderRadius: 999,
    color: '#42526a',
    fontSize: 12,
    fontWeight: 700,
    padding: '4px 8px',
  },
  badge: {
    borderRadius: 999,
    border: '1px solid transparent',
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1,
    padding: '5px 7px',
    whiteSpace: 'nowrap',
  },
  badgeGood: {
    background: '#e7f6ee',
    borderColor: '#8acba4',
    color: '#006c4f',
  },
  badgeBad: {
    background: '#fff2f2',
    borderColor: '#f2b8b5',
    color: '#8c1d18',
  },
  badgeWarn: {
    background: '#fff8e1',
    borderColor: '#d7b568',
    color: '#694a00',
  },
  badgeNeutral: {
    background: '#eef3f8',
    borderColor: '#ccd8e8',
    color: '#42526a',
  },
  summaryGrid: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    margin: 0,
  },
  summaryItem: {
    background: '#f7f8fb',
    border: '1px solid #e1e7f0',
    borderRadius: 6,
    padding: 10,
  },
  summaryLabel: {
    color: '#53657d',
    fontSize: 11,
    fontWeight: 800,
    margin: 0,
  },
  summaryValue: {
    color: '#172033',
    fontSize: 13,
    margin: '4px 0 0',
    overflowWrap: 'anywhere',
  },
  compactList: {
    display: 'grid',
    gap: 8,
    maxHeight: 340,
    overflow: 'auto',
  },
  output: {
    background: '#f4f6fa',
    border: '1px solid #d8e0ec',
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.5,
    margin: 0,
    maxHeight: 420,
    overflow: 'auto',
    padding: 12,
    whiteSpace: 'pre-wrap',
  },
  compactOutput: {
    background: '#f4f6fa',
    border: '1px solid #d8e0ec',
    borderRadius: 6,
    fontSize: 11,
    lineHeight: 1.45,
    margin: 0,
    overflow: 'auto',
    padding: 10,
    whiteSpace: 'pre-wrap',
  },
  empty: {
    color: '#53657d',
    fontSize: 13,
    margin: 0,
  },
};
