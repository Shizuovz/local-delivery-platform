'use client';

import { useState } from 'react';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEFAULT_BUSINESS_PHONE = '+910000000010';

type ApiRecord = Record<string, any>;

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
    await api('/business/deliveries', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    await loadDeliveries();
  }

  async function loadDeliveries() {
    const result = await api(`/business/deliveries${businessId ? `?businessId=${businessId}` : ''}`);
    setDeliveries(Array.isArray(result) ? result : []);
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
      </section>

      <section style={styles.toolbar}>
        <button disabled={busy || !businessUserId} onClick={() => runStep('Load profile', loadProfile)} style={styles.button}>Load Profile</button>
        <button disabled={busy || !businessUserId || !businessId} onClick={() => runStep('Create delivery', createDelivery)} style={styles.button}>Create Delivery</button>
        <button disabled={busy || !businessUserId} onClick={() => runStep('Load deliveries', loadDeliveries)} style={styles.button}>Load Deliveries</button>
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
          <pre style={styles.output}>{JSON.stringify(deliveries, null, 2)}</pre>
        </div>
        <div>
          <h2 style={styles.sectionTitle}>Latest API Response</h2>
          <pre style={styles.output}>{output || 'No response yet.'}</pre>
        </div>
      </section>
    </main>
  );
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
