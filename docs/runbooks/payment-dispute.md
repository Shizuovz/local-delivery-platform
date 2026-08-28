# Payment Dispute Runbook

Status: v1 draft for local build and operations testing.

## Purpose

Use this runbook when payment, refund, provider webhook, or business settlement state does not match delivery operations.

## Common Triggers

- Customer says paid but payment is not `PAID`
- Duplicate payment webhook received
- Payment provider event failed signature verification
- Refund requested but provider status is unknown
- Delivery cancelled after payment
- Business postpaid ledger does not match delivery count
- Admin sees payment status inconsistent with delivery status

## First Checks

1. Open delivery timeline.
2. Check `payments`, `payment_transactions`, `refunds`, and audit logs.
3. Confirm whether the delivery is terminal.
4. Confirm provider reference and provider event ID.
5. Check whether the operation was retried with the same idempotency key.

## Duplicate Webhook

Expected behavior:

- Provider event ID is unique.
- Duplicate event does not create duplicate capture/refund.
- Existing payment state is returned or ignored safely.

If duplicate handling fails, stop manual retries and escalate to engineering.

## Paid But Not Dispatched

1. Confirm payment is `PAID`.
2. Confirm delivery is `CONFIRMED` or `SEARCHING_RIDER`.
3. Trigger dispatch recovery through admin/internal dispatch endpoint.
4. Audit the manual action.

## Cancelled After Payment

1. Confirm cancellation stage from cancellation/refund policy.
2. If refund is eligible, create refund request when backend refund flow exists.
3. Do not change payment to `REFUNDED` without provider confirmation.
4. Record reason and audit log.

## Provider Signature Failure

1. Do not process the webhook.
2. Log only safe metadata: provider, event ID if available, timestamp.
3. Alert engineering/finance.
4. Reconcile through provider dashboard.

## Required Records

Every dispute must preserve:

- Delivery ID
- Payment ID
- Provider reference
- Provider event ID
- Raw event metadata where safe and policy-compliant
- Admin actor and reason
- Final resolution
