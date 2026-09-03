import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConflictError, ForbiddenError } from '../../common/domain-errors';

type PaymentProviderName = 'mock' | 'razorpay';

interface CreateOrderInput {
  amountMinor: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

interface CreateOrderResult {
  provider: PaymentProviderName;
  providerRef: string;
  raw: Record<string, unknown>;
}

interface CreateRefundInput {
  provider: string;
  providerPaymentRef: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  notes?: Record<string, string>;
}

interface CreateRefundResult {
  providerRefundRef: string;
  status: 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  raw: Record<string, unknown>;
}

interface ReconcilePaymentResult {
  providerRef: string;
  amountPaidMinor: number;
  status: 'PENDING' | 'PAID' | 'FAILED';
  raw: Record<string, unknown>;
}

@Injectable()
export class PaymentProviderService {
  currentProvider(): PaymentProviderName {
    return process.env.PAYMENT_PROVIDER === 'razorpay' ? 'razorpay' : 'mock';
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (this.currentProvider() === 'mock') {
      return {
        provider: 'mock',
        providerRef: `mock_${input.receipt}`,
        raw: { provider: 'mock', receipt: input.receipt },
      };
    }

    const response = await this.razorpayFetch('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        notes: input.notes ?? {},
        partial_payment: false,
      }),
    });
    const providerRef = typeof response.id === 'string' ? response.id : undefined;
    if (!providerRef) throw new ConflictError('Payment provider did not return an order id');
    return { provider: 'razorpay', providerRef, raw: response };
  }

  async createRefund(input: CreateRefundInput): Promise<CreateRefundResult> {
    if (input.provider === 'mock') {
      return {
        providerRefundRef: `mock_refund_${input.paymentId}`,
        status: 'SUCCEEDED',
        raw: { provider: 'mock', idempotencyKey: input.idempotencyKey },
      };
    }
    if (input.provider !== 'razorpay') throw new ConflictError(`Unsupported payment provider: ${input.provider}`);
    if (!input.providerPaymentRef) throw new ConflictError('Provider payment reference is required for refund');

    const response = await this.razorpayFetch(`/payments/${encodeURIComponent(input.providerPaymentRef)}/refund`, {
      method: 'POST',
      headers: { 'X-Razorpay-Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({
        amount: input.amountMinor,
        speed: 'normal',
        notes: input.notes ?? {},
      }),
    });
    const providerRefundRef = typeof response.id === 'string' ? response.id : undefined;
    if (!providerRefundRef) throw new ConflictError('Payment provider did not return a refund id');
    return {
      providerRefundRef,
      status: this.razorpayRefundStatus(response.status),
      raw: response,
    };
  }

  async reconcilePayment(provider: string, providerRef: string): Promise<ReconcilePaymentResult> {
    if (provider === 'mock') {
      return {
        providerRef,
        amountPaidMinor: 0,
        status: 'PENDING',
        raw: { provider: 'mock', providerRef },
      };
    }
    if (provider !== 'razorpay') throw new ConflictError(`Unsupported payment provider: ${provider}`);
    const response = await this.razorpayFetch(`/orders/${encodeURIComponent(providerRef)}`, { method: 'GET' });
    const amountPaidMinor = typeof response.amount_paid === 'number' ? response.amount_paid : 0;
    return {
      providerRef,
      amountPaidMinor,
      status: this.razorpayOrderStatus(response.status, amountPaidMinor),
      raw: response,
    };
  }

  verifyRazorpayWebhook(signature: string | undefined, rawBody: Buffer | string) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new ForbiddenError('Razorpay webhook secret is not configured');
    if (!signature) throw new ForbiddenError('Invalid payment webhook signature');

    const received = Buffer.from(signature, 'hex');
    const expected = createHmac('sha256', secret).update(rawBody).digest();
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new ForbiddenError('Invalid payment webhook signature');
    }
  }

  checkoutKeyId(provider: string) {
    if (provider === 'mock') return undefined;
    if (provider !== 'razorpay') throw new ConflictError(`Unsupported payment provider: ${provider}`);
    const keyId = process.env.RAZORPAY_KEY_ID;
    if (!keyId) throw new ConflictError('Razorpay checkout key is not configured');
    return keyId;
  }

  private async razorpayFetch(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new ConflictError('Razorpay credentials are not configured');

    const baseUrl = process.env.RAZORPAY_API_BASE_URL ?? 'https://api.razorpay.com/v1';
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Basic ${auth}`,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new ConflictError(`Razorpay request failed: ${this.safeRazorpayError(body)}`);
    }
    return body;
  }

  private razorpayOrderStatus(status: unknown, _amountPaidMinor: number): 'PENDING' | 'PAID' | 'FAILED' {
    if (status === 'paid') return 'PAID';
    if (status === 'attempted') return 'FAILED';
    return 'PENDING';
  }

  private razorpayRefundStatus(status: unknown): 'PROCESSING' | 'SUCCEEDED' | 'FAILED' {
    if (status === 'processed') return 'SUCCEEDED';
    if (status === 'failed') return 'FAILED';
    return 'PROCESSING';
  }

  private safeRazorpayError(body: Record<string, unknown>) {
    const error = typeof body.error === 'object' && body.error !== null ? body.error as Record<string, unknown> : undefined;
    return String(error?.description ?? error?.reason ?? body.message ?? 'provider error');
  }
}
