'use client';

import { useState } from 'react';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEFAULT_BUSINESS_PHONE = '+910000000010';

type ApiRecord = Record<string, any>;
type CheckoutState = {
  payment: ApiRecord;
  checkout: ApiRecord & {
    mode: string;
    keyId?: string;
    orderId?: string;
    providerRef?: string;
    amountMinor?: number;
    currency?: string;
    name?: string;
    description?: string;
  };
};

const initialDelivery = {
  pickupAddress: {
    line1: 'Business Pickup',
    city: 'Bengaluru',
    lat: 12.9716,
    lng: 77.5946,
  },
  dropAddress: {
    line1: 'Customer Drop',
    city: 'Bengaluru',
    lat: 12.98,
    lng: 77.61,
  },
  item: {
    description: 'Business package',
    packageClass: 'SMALL',
    quantity: 1,
  },
};

export default function BusinessDeliveryPage() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [phone, setPhone] = useState(DEFAULT_BUSINESS_PHONE);
  const [businessUserId, setBusinessUserId] = useState('');
  const [businesses, setBusinesses] = useState<ApiRecord[]>([]);
  const [businessId, setBusinessId] = useState('');
  const [deliveries, setDeliveries] = useState<ApiRecord[]>([]);
  const [deliveryId, setDeliveryId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [checkout, setCheckout] = useState<CheckoutState | null>(null);
  const [deliveryDetail, setDeliveryDetail] = useState<ApiRecord | null>(null);
  const [deliveryPayload, setDeliveryPayload] = useState(JSON.stringify(initialDelivery, null, 2));
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');

  async function api(path: string, init?: RequestInit, authUserId = businessUserId) {
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
      const message = body?.error?.message ?? body?.message ?? 'Request failed';
      throw new Error(String(message));
    }
    return body;
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
    const result = await api('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code: '123456', roleHint: 'BUSINESS' }),
    }, '');
    setBusinessUserId(result.user.id);
    const profile = await api('/business/profile', undefined, result.user.id);
    setBusinesses(Array.isArray(profile) ? profile : []);
    if (Array.isArray(profile) && profile[0]?.id) {
      setBusinessId(profile[0].id);
      await loadDeliveries(profile[0].id, result.user.id);
    }
  }

  async function loadProfile() {
    const result = await api('/business/profile');
    setBusinesses(Array.isArray(result) ? result : []);
    if (Array.isArray(result) && result[0]?.id) {
      setBusinessId(result[0].id);
    }
  }

  async function createDelivery() {
    const body = {
      businessId,
      idempotencyKey: `business-${Date.now()}`,
      ...JSON.parse(deliveryPayload),
    };
    const result = await api('/business/deliveries', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (result?.delivery?.id) setDeliveryId(result.delivery.id);
    if (result?.payment?.id) {
      setPaymentId(result.payment.id);
      await loadCheckout(result.payment.id);
    } else {
      setCheckout(null);
    }
    await loadDeliveries();
  }

  async function loadDeliveries(targetBusinessId = businessId, authUserId = businessUserId) {
    const result = await api(`/business/deliveries${targetBusinessId ? `?businessId=${targetBusinessId}` : ''}`, undefined, authUserId);
    setDeliveries(Array.isArray(result) ? result : []);
    if (Array.isArray(result) && result[0]?.id) {
      setDeliveryId(result[0].id);
      if (result[0]?.payment?.id) setPaymentId(result[0].payment.id);
    }
  }

  async function loadDeliveryDetail() {
    const result = await api(`/business/deliveries/${deliveryId}`);
    setDeliveryDetail(result);
    if (result?.payment?.id) {
      setPaymentId(result.payment.id);
      await loadCheckout(result.payment.id);
    }
  }

  async function loadCheckout(targetPaymentId = paymentId) {
    if (!targetPaymentId) throw new Error('Choose a prepaid payment first');
    const result = await api(`/payments/${targetPaymentId}/checkout`);
    setCheckout(result);
    setPaymentId(result.payment.id);
  }

  async function startCheckout() {
    const current = checkout ?? await api(`/payments/${paymentId}/checkout`);
    setCheckout(current);
    if (current.checkout.mode === 'mock') {
      setStatus('Mock checkout ready; use backend mock webhook for local paid state');
      return;
    }
    if (current.checkout.mode !== 'razorpay') throw new Error(`Unsupported checkout provider: ${current.checkout.mode}`);
    await openRazorpayWebCheckout(current);
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Business Delivery Spine</h1>
          <p style={styles.subtle}>{busy ? 'Working...' : status}</p>
        </div>
        <button disabled={busy} onClick={() => runStep('Business login', login)} style={styles.primaryButton}>Login</button>
      </header>

      <section style={styles.grid}>
        <label style={styles.label}>
          API URL
          <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Business Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Business User ID
          <input value={businessUserId} onChange={(event) => setBusinessUserId(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Business ID
          <input value={businessId} onChange={(event) => setBusinessId(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Delivery ID
          <input value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Payment ID
          <input value={paymentId} onChange={(event) => setPaymentId(event.target.value)} style={styles.input} />
        </label>
      </section>

      <section style={styles.toolbar}>
        <button disabled={busy || !businessUserId} onClick={() => runStep('Load profile', loadProfile)} style={styles.button}>Load Profile</button>
        <button disabled={busy || !businessUserId || !businessId} onClick={() => runStep('Create delivery', createDelivery)} style={styles.button}>Create Delivery</button>
        <button disabled={busy || !businessUserId} onClick={() => runStep('Load deliveries', loadDeliveries)} style={styles.button}>Load Deliveries</button>
        <button disabled={busy || !businessUserId || !deliveryId} onClick={() => runStep('Load delivery detail', loadDeliveryDetail)} style={styles.button}>Load Detail</button>
        <button disabled={busy || !businessUserId || !paymentId} onClick={() => runStep('Load checkout', () => loadCheckout().then(() => undefined))} style={styles.button}>Load Checkout</button>
        <button disabled={busy || !businessUserId || !paymentId} onClick={() => runStep('Start checkout', startCheckout)} style={styles.primaryButton}>Start Checkout</button>
      </section>

      <section style={styles.summaryBand}>
        <Metric label="Business" value={businessId ? shortId(businessId) : 'Not loaded'} />
        <Metric label="Delivery" value={deliveryId ? shortId(deliveryId) : 'Not selected'} />
        <Metric label="Payment" value={checkout ? `${String(checkout.payment.status ?? 'UNKNOWN')} ${formatMoney(Number(checkout.checkout.amountMinor ?? 0), String(checkout.checkout.currency ?? 'INR'))}` : 'No checkout'} />
        <Metric label="Checkout" value={checkout ? `${checkout.checkout.mode} ${String(checkout.checkout.orderId ?? checkout.checkout.providerRef ?? '')}` : 'Not loaded'} />
      </section>

      <section style={styles.columns}>
        <div>
          <h2 style={styles.sectionTitle}>Delivery Payload</h2>
          <textarea value={deliveryPayload} onChange={(event) => setDeliveryPayload(event.target.value)} style={styles.textarea} />
        </div>
        <div>
          <h2 style={styles.sectionTitle}>Businesses</h2>
          <pre style={styles.output}>{JSON.stringify(businesses, null, 2)}</pre>
        </div>
      </section>

      <section style={styles.columns}>
        <div>
          <h2 style={styles.sectionTitle}>Deliveries</h2>
          <div style={styles.list}>
            {deliveries.length === 0 ? (
              <p style={styles.subtle}>No deliveries loaded.</p>
            ) : deliveries.map((delivery) => (
              <button
                key={String(delivery.id)}
                disabled={busy}
                onClick={() => setDeliveryId(String(delivery.id ?? ''))}
                style={{
                  ...styles.rowButton,
                  ...(delivery.id === deliveryId ? styles.selectedRow : {}),
                }}
              >
                <strong>{shortId(String(delivery.id ?? ''))}</strong>
                <span>{String(delivery.type ?? 'delivery')} - {String(delivery.status ?? 'UNKNOWN')}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h2 style={styles.sectionTitle}>Delivery Detail</h2>
          <pre style={styles.output}>{JSON.stringify(deliveryDetail, null, 2)}</pre>
        </div>
      </section>

      <section>
        <h2 style={styles.sectionTitle}>Latest API Response</h2>
        <pre style={styles.output}>{output || 'No response yet.'}</pre>
      </section>
    </main>
  );
}

async function openRazorpayWebCheckout(checkout: CheckoutState) {
  await loadRazorpayScript();
  const RazorpayCheckout = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } }).Razorpay;
  if (!RazorpayCheckout) throw new Error('Razorpay Checkout failed to load');
  new RazorpayCheckout({
    key: checkout.checkout.keyId,
    amount: checkout.checkout.amountMinor,
    currency: checkout.checkout.currency,
    name: checkout.checkout.name ?? 'Local Delivery',
    description: checkout.checkout.description,
    order_id: checkout.checkout.orderId,
    handler: (response: unknown) => {
      console.log('Razorpay checkout completed; backend webhook remains source of truth', response);
    },
  }).open();
}

async function loadRazorpayScript() {
  const existing = document.querySelector('script[data-razorpay-checkout]');
  if (existing) return;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Unable to load Razorpay Checkout'));
    document.body.appendChild(script);
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <span style={styles.metricLabel}>{label}</span>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}

function formatMoney(amountMinor?: number, currency = 'INR') {
  if (typeof amountMinor !== 'number') return currency;
  return `${currency} ${(amountMinor / 100).toFixed(2)}`;
}

function shortId(value: string) {
  return value.length > 10 ? `${value.slice(0, 8)}...` : value || '-';
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    color: '#172033',
    display: 'grid',
    fontFamily: 'system-ui, sans-serif',
    gap: 18,
    margin: '32px auto',
    maxWidth: 1180,
    padding: '0 24px 48px',
  },
  header: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
  },
  title: {
    fontSize: 28,
    margin: 0,
  },
  subtle: {
    color: '#53657d',
    margin: '6px 0 0',
  },
  grid: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  },
  label: {
    color: '#42526a',
    display: 'grid',
    fontSize: 12,
    fontWeight: 700,
    gap: 6,
  },
  input: {
    border: '1px solid #b8c4d6',
    borderRadius: 6,
    color: '#172033',
    font: 'inherit',
    padding: '10px 12px',
  },
  textarea: {
    border: '1px solid #b8c4d6',
    borderRadius: 6,
    color: '#172033',
    font: '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    minHeight: 260,
    padding: 12,
    width: '100%',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryBand: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  },
  metric: {
    background: '#f5f7fb',
    border: '1px solid #d7deea',
    borderRadius: 6,
    display: 'grid',
    gap: 6,
    minHeight: 72,
    padding: 12,
  },
  metricLabel: {
    color: '#53657d',
    fontSize: 11,
    fontWeight: 800,
  },
  metricValue: {
    color: '#172033',
    fontSize: 14,
    lineHeight: 1.35,
    overflowWrap: 'anywhere',
  },
  list: {
    display: 'grid',
    gap: 8,
  },
  rowButton: {
    background: '#ffffff',
    border: '1px solid #d7deea',
    borderRadius: 6,
    color: '#172033',
    cursor: 'pointer',
    display: 'grid',
    gap: 4,
    minHeight: 56,
    padding: 10,
    textAlign: 'left',
  },
  selectedRow: {
    borderColor: '#00687a',
  },
  button: {
    border: '1px solid #9aabc2',
    borderRadius: 6,
    background: '#ffffff',
    color: '#172033',
    cursor: 'pointer',
    font: 'inherit',
    padding: '10px 12px',
  },
  primaryButton: {
    border: '1px solid #172033',
    borderRadius: 6,
    background: '#172033',
    color: '#ffffff',
    cursor: 'pointer',
    font: 'inherit',
    padding: '10px 14px',
  },
  columns: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  },
  sectionTitle: {
    fontSize: 16,
    margin: '0 0 8px',
  },
  output: {
    background: '#f5f7fb',
    border: '1px solid #d7deea',
    borderRadius: 6,
    minHeight: 220,
    overflow: 'auto',
    padding: 12,
    whiteSpace: 'pre-wrap',
  },
};
