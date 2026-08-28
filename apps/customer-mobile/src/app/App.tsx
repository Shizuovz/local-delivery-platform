import { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEFAULT_PHONE = '+919999999999';

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [userId, setUserId] = useState('');
  const [quoteId, setQuoteId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [deliveryType, setDeliveryType] = useState<'SEND' | 'LIMITED_FETCH'>('SEND');
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
      body: JSON.stringify({ phone, code: '123456', roleHint: 'CUSTOMER' }),
    }, '');
    setUserId(result.user.id);
  }

  async function quote() {
    const result = await api('/deliveries/quote', {
      method: 'POST',
      body: JSON.stringify(deliveryType === 'SEND' ? sendQuotePayload : limitedFetchQuotePayload),
    });
    setQuoteId(result.id);
  }

  async function createDelivery() {
    const result = await api('/deliveries', {
      method: 'POST',
      body: JSON.stringify({ quoteId, idempotencyKey: `customer-mobile-send-${Date.now()}` }),
    });
    setDeliveryId(result.delivery.id);
    setPaymentId(result.payment.id);
  }

  async function pay() {
    await api('/payments/mock/confirm', {
      method: 'POST',
      body: JSON.stringify({ paymentId, providerEventId: `evt-customer-${Date.now()}` }),
    });
  }

  async function track() {
    await api(`/deliveries/${deliveryId}/tracking`);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Customer SEND Spine</Text>
      <Text style={styles.status}>{busy ? 'Working...' : status}</Text>
      {busy ? <ActivityIndicator /> : null}

      <Field label="API URL" value={apiUrl} onChangeText={setApiUrl} />
      <Field label="Phone" value={phone} onChangeText={setPhone} />
      <Field label="User ID" value={userId} onChangeText={setUserId} />
      <Field label="Quote ID" value={quoteId} onChangeText={setQuoteId} />
      <Field label="Payment ID" value={paymentId} onChangeText={setPaymentId} />
      <Field label="Delivery ID" value={deliveryId} onChangeText={setDeliveryId} />

      <View style={styles.modeRow}>
        <Button title="SEND" disabled={busy || deliveryType === 'SEND'} onPress={() => setDeliveryType('SEND')} />
        <Button title="LIMITED_FETCH" disabled={busy || deliveryType === 'LIMITED_FETCH'} onPress={() => setDeliveryType('LIMITED_FETCH')} />
      </View>

      <View style={styles.actions}>
        <Button title="1. Login" disabled={busy} onPress={() => runStep('Login', login)} />
        <Button title="2. Create Quote" disabled={busy || !userId} onPress={() => runStep('Create quote', quote)} />
        <Button title="3. Create Delivery" disabled={busy || !quoteId} onPress={() => runStep('Create delivery', createDelivery)} />
        <Button title="4. Confirm Payment" disabled={busy || !paymentId} onPress={() => runStep('Confirm payment', pay)} />
        <Button title="5. Track" disabled={busy || !deliveryId} onPress={() => runStep('Track delivery', track)} />
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
  modeRow: {
    flexDirection: 'row',
    gap: 8,
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

const sendQuotePayload = {
  type: 'SEND',
  pickupAddress: { line1: 'MG Road', city: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  dropAddress: { line1: 'Indiranagar', city: 'Bengaluru', lat: 12.9784, lng: 77.6408 },
  item: { description: 'Documents', packageClass: 'SMALL', quantity: 1 },
};

const limitedFetchQuotePayload = {
  type: 'LIMITED_FETCH',
  pickupAddress: { line1: 'Known Pickup Counter', city: 'Bengaluru', lat: 12.9716, lng: 77.5946 },
  dropAddress: { line1: 'Home Drop', city: 'Bengaluru', lat: 12.98, lng: 77.61 },
  item: { description: 'Already paid parcel', packageClass: 'SMALL', quantity: 1 },
  pickupReference: 'ORDER-123',
  pickupInstructions: 'Collect from prepaid pickup counter',
  itemAlreadyPaid: true,
};
