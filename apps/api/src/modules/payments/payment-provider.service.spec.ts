import { createHmac } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentProviderService } from './payment-provider.service';

describe('PaymentProviderService', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('creates Razorpay orders with amount subunits and server receipt', async () => {
    process.env.PAYMENT_PROVIDER = 'razorpay';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'secret';
    process.env.RAZORPAY_API_BASE_URL = 'https://razorpay.test/v1';
    global.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual(expect.objectContaining({
        amount: 8500,
        currency: 'INR',
        receipt: 'quote_123',
        partial_payment: false,
      }));
      expect(init?.headers).toEqual(expect.objectContaining({
        authorization: `Basic ${Buffer.from('rzp_test_key:secret').toString('base64')}`,
      }));
      return {
        ok: true,
        json: async () => ({ id: 'order_razorpay_123', amount: 8500, currency: 'INR' }),
      } as Response;
    });

    const result = await new PaymentProviderService().createOrder({
      amountMinor: 8500,
      currency: 'INR',
      receipt: 'quote_123',
    });

    expect(result.provider).toBe('razorpay');
    expect(result.providerRef).toBe('order_razorpay_123');
  });

  it('verifies Razorpay webhook signatures against the raw body', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_secret';
    const rawBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_123' } } } });
    const signature = createHmac('sha256', 'webhook_secret').update(rawBody).digest('hex');
    const provider = new PaymentProviderService();

    expect(() => provider.verifyRazorpayWebhook(signature, rawBody)).not.toThrow();
    expect(() => provider.verifyRazorpayWebhook('bad-signature', rawBody)).toThrow('Invalid payment webhook signature');
  });

  it('creates Razorpay refunds with provider idempotency key', async () => {
    process.env.PAYMENT_PROVIDER = 'razorpay';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'secret';
    process.env.RAZORPAY_API_BASE_URL = 'https://razorpay.test/v1';
    global.fetch = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://razorpay.test/v1/payments/pay_123/refund');
      expect(init?.headers).toEqual(expect.objectContaining({
        'X-Razorpay-Idempotency-Key': 'refund-key-123',
      }));
      expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
        amount: 8500,
        speed: 'normal',
      }));
      return {
        ok: true,
        json: async () => ({ id: 'rfnd_123', amount: 8500, status: 'processed' }),
      } as Response;
    });

    const result = await new PaymentProviderService().createRefund({
      provider: 'razorpay',
      providerPaymentRef: 'pay_123',
      paymentId: 'local-payment-id',
      amountMinor: 8500,
      currency: 'INR',
      idempotencyKey: 'refund-key-123',
    });

    expect(result).toEqual(expect.objectContaining({
      providerRefundRef: 'rfnd_123',
      status: 'SUCCEEDED',
    }));
  });
});
