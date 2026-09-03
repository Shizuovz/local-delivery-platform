import { useState } from 'react';
import { ActivityIndicator, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const DEFAULT_PHONE = '+910000000002';

export default function App() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [phone, setPhone] = useState(DEFAULT_PHONE);
  const [userId, setUserId] = useState('');
  const [assignmentId, setAssignmentId] = useState('');
  const [deliveryId, setDeliveryId] = useState('');
  const [proofObjectKey, setProofObjectKey] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [documentSignedUrl, setDocumentSignedUrl] = useState('');
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

  async function readyForOffers() {
    await goOnline();
    await sendLocation();
    await loadOffers();
  }

  async function loadOffers() {
    const result = await api('/rider/jobs/offers');
    if (Array.isArray(result) && result[0]?.id) {
      setAssignmentId(result[0].id);
      if (result[0]?.deliveryId) setDeliveryId(result[0].deliveryId);
      return result[0].id as string;
    }
    return '';
  }

  async function acceptJob() {
    const result = await api(`/rider/jobs/${assignmentId}/accept`, { method: 'POST' });
    if (result?.delivery?.id) setDeliveryId(result.delivery.id);
  }

  async function acceptFirstOffer() {
    const nextAssignmentId = assignmentId || await loadOffers();
    if (!nextAssignmentId) throw new Error('No offer loaded');
    const result = await api(`/rider/jobs/${nextAssignmentId}/accept`, { method: 'POST' });
    setAssignmentId(nextAssignmentId);
    if (result?.delivery?.id) setDeliveryId(result.delivery.id);
  }

  async function signedUpload(uploadUrl: string, contentType: string) {
    const response = await fetch(new URL(uploadUrl, apiUrl).toString(), {
      method: 'PUT',
      headers: { 'content-type': contentType },
    });
    const body = await response.json().catch(() => ({}));
    setOutput(JSON.stringify(body, null, 2));
    if (!response.ok) {
      throw new Error(String(body?.error?.message ?? body?.message ?? 'Signed upload failed'));
    }
  }

  async function createProofUpload() {
    if (!deliveryId) throw new Error('Accept or enter a delivery ID first');
    const result = await api('/proofs/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        deliveryId,
        type: 'PHOTO',
        fileName: 'drop-proof.jpg',
        contentType: 'image/jpeg',
      }),
    });
    setProofObjectKey(result.objectKey);
    await signedUpload(result.uploadUrl, 'image/jpeg');
    return result.objectKey as string;
  }

  async function deliverWithPhotoProof(objectKey = proofObjectKey) {
    await api(`/rider/jobs/${assignmentId}/delivered`, {
      method: 'POST',
      body: JSON.stringify({ photoObjectKey: objectKey }),
    });
  }

  async function completeWithPhotoProof() {
    if (!assignmentId) throw new Error('Accept or enter an assignment ID first');
    await api(`/rider/jobs/${assignmentId}/arrived-pickup`, { method: 'POST' });
    await api(`/rider/jobs/${assignmentId}/picked-up`, {
      method: 'POST',
      body: JSON.stringify({ pickupReference: 'PKUP-123' }),
    });
    await api(`/rider/jobs/${assignmentId}/arrived-drop`, { method: 'POST' });
    const objectKey = proofObjectKey || await createProofUpload();
    await deliverWithPhotoProof(objectKey);
  }

  async function createDocumentUpload() {
    const result = await api('/rider/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        type: 'DRIVING_LICENSE',
        fileName: 'license.pdf',
        contentType: 'application/pdf',
      }),
    });
    setDocumentId(result.document.id);
    setDocumentSignedUrl(result.document.signedUrl ?? '');
    await signedUpload(result.upload.uploadUrl, 'application/pdf');
  }

  async function loadDocuments() {
    const result = await api('/rider/documents');
    if (Array.isArray(result) && result[0]?.id) {
      setDocumentId(result[0].id);
      setDocumentSignedUrl(result[0].signedUrl ?? '');
    }
  }

  async function readDocument() {
    if (!documentSignedUrl) throw new Error('Load a signed document URL first');
    const response = await fetch(new URL(documentSignedUrl, apiUrl).toString());
    const body = await response.json().catch(() => ({}));
    setOutput(JSON.stringify(body, null, 2));
    if (!response.ok) {
      throw new Error(String(body?.error?.message ?? body?.message ?? 'Signed document request failed'));
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
      <Field label="Delivery ID" value={deliveryId} onChangeText={setDeliveryId} />
      <Field label="Proof Object Key" value={proofObjectKey} onChangeText={setProofObjectKey} />
      <Field label="Document ID" value={documentId} onChangeText={setDocumentId} />
      <Field label="Document Signed URL" value={documentSignedUrl} onChangeText={setDocumentSignedUrl} />

      <View style={styles.actions}>
        <Button title="1. Login" disabled={busy} onPress={() => runStep('Login', login)} />
        <Button title="Ready For Offers" disabled={busy || !userId} onPress={() => runStep('Ready for offers', readyForOffers)} />
        <Button title="Accept First Offer" disabled={busy || !userId} onPress={() => runStep('Accept first offer', acceptFirstOffer)} />
        <Button title="Complete With Photo Proof" disabled={busy || !assignmentId} onPress={() => runStep('Complete with photo proof', completeWithPhotoProof)} />
        <Button title="2. Go Online" disabled={busy || !userId} onPress={() => runStep('Go online', goOnline)} />
        <Button title="3. Send Location" disabled={busy || !userId} onPress={() => runStep('Send location', sendLocation)} />
        <Button title="4. Load Offers" disabled={busy || !userId} onPress={() => runStep('Load offers', () => loadOffers().then(() => undefined))} />
        <Button title="5. Accept" disabled={busy || !assignmentId} onPress={() => runStep('Accept job', acceptJob)} />
        <Button title="Reject Offer" disabled={busy || !assignmentId} onPress={() => runStep('Reject offer', () => api(`/rider/jobs/${assignmentId}/reject`, { method: 'POST' }).then(() => undefined))} />
        <Button title="6. Arrived Pickup" disabled={busy || !assignmentId} onPress={() => runStep('Arrived pickup', () => api(`/rider/jobs/${assignmentId}/arrived-pickup`, { method: 'POST' }).then(() => undefined))} />
        <Button title="7. Picked Up" disabled={busy || !assignmentId} onPress={() => runStep('Picked up', () => api(`/rider/jobs/${assignmentId}/picked-up`, { method: 'POST', body: JSON.stringify({ pickupReference: 'PKUP-123' }) }).then(() => undefined))} />
        <Button title="8. Arrived Drop" disabled={busy || !assignmentId} onPress={() => runStep('Arrived drop', () => api(`/rider/jobs/${assignmentId}/arrived-drop`, { method: 'POST' }).then(() => undefined))} />
        <Button title="9. Delivered" disabled={busy || !assignmentId} onPress={() => runStep('Delivered', () => api(`/rider/jobs/${assignmentId}/delivered`, { method: 'POST', body: JSON.stringify({ otp: '123456' }) }).then(() => undefined))} />
        <Button title="9b. Create Proof Upload" disabled={busy || !userId || !deliveryId} onPress={() => runStep('Create proof upload', () => createProofUpload().then(() => undefined))} />
        <Button title="9c. Delivered With Photo Proof" disabled={busy || !assignmentId || !proofObjectKey} onPress={() => runStep('Delivered with photo proof', deliverWithPhotoProof)} />
        <Button title="10. Earnings" disabled={busy || !userId} onPress={() => runStep('Load earnings', () => api('/rider/earnings').then(() => undefined))} />
        <Button title="11. Create Document Upload" disabled={busy || !userId} onPress={() => runStep('Create document upload', createDocumentUpload)} />
        <Button title="12. Load Documents" disabled={busy || !userId} onPress={() => runStep('Load documents', loadDocuments)} />
        <Button title="13. Read Signed Document" disabled={busy || !documentSignedUrl} onPress={() => runStep('Read signed document', readDocument)} />
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
