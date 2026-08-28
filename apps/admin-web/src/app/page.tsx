'use client';

import { useState } from 'react';

const DEFAULT_API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEFAULT_ADMIN_PHONE = '+910000000001';

type ApiRecord = Record<string, any>;

export default function AdminOperationsPage() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [phone, setPhone] = useState(DEFAULT_ADMIN_PHONE);
  const [adminUserId, setAdminUserId] = useState('');
  const [deliveries, setDeliveries] = useState<ApiRecord[]>([]);
  const [timeline, setTimeline] = useState<ApiRecord | null>(null);
  const [deliveryId, setDeliveryId] = useState('');
  const [riderId, setRiderId] = useState('');
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');

  async function api(path: string, init?: RequestInit, authUserId = adminUserId) {
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
      body: JSON.stringify({ phone, code: '123456', roleHint: 'OPS_ADMIN' }),
    }, '');
    setAdminUserId(result.user.id);
  }

  async function loadDeliveries() {
    const result = await api('/admin/deliveries');
    setDeliveries(Array.isArray(result) ? result : []);
  }

  async function loadTimeline() {
    setTimeline(await api(`/admin/deliveries/${deliveryId}/timeline`));
  }

  async function assign(reassign = false) {
    const result = await api(`/admin/deliveries/${deliveryId}/${reassign ? 'reassign' : 'assign'}`, {
      method: 'POST',
      body: JSON.stringify({
        riderId,
        reason: reassign ? 'Manual reassignment from admin UI' : 'Manual assignment from admin UI',
      }),
    });
    setOutput(JSON.stringify(result, null, 2));
    await loadDeliveries();
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Admin Operations Spine</h1>
          <p style={styles.subtle}>{busy ? 'Working...' : status}</p>
        </div>
        <button disabled={busy} onClick={() => runStep('Admin login', login)} style={styles.primaryButton}>Login</button>
      </header>

      <section style={styles.grid}>
        <label style={styles.label}>
          API URL
          <input value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Admin Phone
          <input value={phone} onChange={(event) => setPhone(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Admin User ID
          <input value={adminUserId} onChange={(event) => setAdminUserId(event.target.value)} style={styles.input} />
        </label>
      </section>

      <section style={styles.toolbar}>
        <button disabled={busy || !adminUserId} onClick={() => runStep('Load deliveries', loadDeliveries)} style={styles.button}>Load Deliveries</button>
        <button disabled={busy || !deliveryId} onClick={() => runStep('Load timeline', loadTimeline)} style={styles.button}>Load Timeline</button>
        <button disabled={busy || !deliveryId || !riderId} onClick={() => runStep('Assign rider', () => assign(false))} style={styles.button}>Assign</button>
        <button disabled={busy || !deliveryId || !riderId} onClick={() => runStep('Reassign rider', () => assign(true))} style={styles.button}>Reassign</button>
      </section>

      <section style={styles.grid}>
        <label style={styles.label}>
          Delivery ID
          <input value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)} style={styles.input} />
        </label>
        <label style={styles.label}>
          Rider ID
          <input value={riderId} onChange={(event) => setRiderId(event.target.value)} style={styles.input} />
        </label>
      </section>

      <section style={styles.columns}>
        <div>
          <h2 style={styles.sectionTitle}>Deliveries</h2>
          <pre style={styles.output}>{JSON.stringify(deliveries, null, 2)}</pre>
        </div>
        <div>
          <h2 style={styles.sectionTitle}>Timeline</h2>
          <pre style={styles.output}>{JSON.stringify(timeline, null, 2)}</pre>
        </div>
      </section>

      <section>
        <h2 style={styles.sectionTitle}>Latest API Response</h2>
        <pre style={styles.output}>{output || 'No response yet.'}</pre>
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
    background: '#f4f6fa',
    border: '1px solid #d8e0ec',
    borderRadius: 6,
    fontSize: 12,
    margin: 0,
    maxHeight: 420,
    overflow: 'auto',
    padding: 12,
    whiteSpace: 'pre-wrap',
  },
};
