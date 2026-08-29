import { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEFAULT_PHONE = '+910000000002';

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [userId, setUserId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [output, setOutput] = useState('');

  async function api(path: string, init?: RequestInit, authUserId = userId) {
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
      body: JSON.stringify({ phone, code: '123456', roleHint: 'RIDER' }),
    }, '');
    setUserId(result.user.id);
  }

  async function goOnline() {
    await api('/rider/availability', {
      method: 'PATCH',
      body: JSON.stringify({ online: true }),
    });
  }

  async function sendLocation() {
    await api('/rider/location', {
      method: 'POST',
      body: JSON.stringify({ lat: 12.9716, lng: 77.5946 }),
    });
  }

  async function loadOffers() {
    const result = await api('/rider/jobs/offers');
    if (Array.isArray(result) && result[0]?.id) {
      setAssignmentId(result[0].id);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Rider Job Spine</Text>
      <Text style={styles.status}>{busy ? 'Working...' : status}</Text>
      {busy ? <ActivityIndicator /> : null}

      <Field label="API URL" value={apiUrl} onChangeText={setApiUrl} />
      <Field label="Phone" value={phone} onChangeText={setPhone} />
      <Field label="Rider User ID" value={userId} onChangeText={setUserId} />
      <Field label="Assignment ID" value={assignmentId} onChangeText={setAssignmentId} />

      <View style={styles.actions}>
        <Button title="1. Login" disabled={busy} onPress={() => runStep('Login', login)} />
        <Button title="2. Go Online" disabled={busy || !userId} onPress={() => runStep('Go online', goOnline)} />
        <Button title="3. Send Location" disabled={busy || !userId} onPress={() => runStep('Send location', sendLocation)} />
        <Button title="4. Load Offers" disabled={busy || !userId} onPress={() => runStep('Load offers', loadOffers)} />
        <Button title="5. Accept" disabled={busy || !assignmentId} onPress={() => runStep('Accept job', () => api(`/rider/jobs/${assignmentId}/accept`, { method: 'POST' }).then(() => undefined))} />
        <Button title="Reject Offer" disabled={busy || !assignmentId} onPress={() => runStep('Reject offer', () => api(`/rider/jobs/${assignmentId}/reject`, { method: 'POST' }).then(() => undefined))} />
        <Button title="6. Arrived Pickup" disabled={busy || !assignmentId} onPress={() => runStep('Arrived pickup', () => api(`/rider/jobs/${assignmentId}/arrived-pickup`, { method: 'POST' }).then(() => undefined))} />
        <Button title="7. Picked Up" disabled={busy || !assignmentId} onPress={() => runStep('Picked up', () => api(`/rider/jobs/${assignmentId}/picked-up`, { method: 'POST', body: JSON.stringify({ pickupReference: 'PKUP-123' }) }).then(() => undefined))} />
        <Button title="8. Arrived Drop" disabled={busy || !assignmentId} onPress={() => runStep('Arrived drop', () => api(`/rider/jobs/${assignmentId}/arrived-drop`, { method: 'POST' }).then(() => undefined))} />
        <Button title="9. Delivered" disabled={busy || !assignmentId} onPress={() => runStep('Delivered', () => api(`/rider/jobs/${assignmentId}/delivered`, { method: 'POST', body: JSON.stringify({ otp: '123456' }) }).then(() => undefined))} />
        <Button title="10. Earnings" disabled={busy || !userId} onPress={() => runStep('Load earnings', () => api('/rider/earnings').then(() => undefined))} />
      </View>

      <Text style={styles.sectionTitle}>Latest API Response</Text>
      <Text selectable style={styles.output}>{output || 'No response yet.'}</Text>
    </ScrollView>
  );
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    padding: 24,
    paddingTop: 48,
  },
  title: {
    color: '#172033',
    fontSize: 24,
    fontWeight: '700',
  },
  status: {
    color: '#37506f',
    fontSize: 14,
  },
  field: {
    gap: 4,
  },
  label: {
    color: '#42526a',
    fontSize: 12,
    fontWeight: '600',
  },
  input: {
    borderColor: '#b8c4d6',
    borderRadius: 6,
    borderWidth: 1,
    color: '#172033',
    padding: 10,
  },
  actions: {
    gap: 8,
    marginTop: 4,
  },
  sectionTitle: {
    color: '#172033',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  output: {
    backgroundColor: '#f4f6fa',
    borderRadius: 6,
    color: '#172033',
    fontFamily: 'monospace',
    fontSize: 12,
    padding: 12,
  },
});
