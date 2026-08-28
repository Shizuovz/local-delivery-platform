# Failed Delivery Runbook

Status: v1 draft for local build and operations testing.

## Purpose

Use this runbook when a delivery cannot proceed normally because of rider, customer, address, payment, proof, package, or operational issues.

## Common Triggers

- No eligible rider found after dispatch attempts
- Rider cannot find pickup/drop location
- Pickup item violates delivery restrictions
- Recipient unavailable
- Proof cannot be collected
- Rider app/network failure
- Payment/refund mismatch
- Customer/business requests cancellation after pickup

## Initial Triage

1. Open admin delivery timeline.
2. Check latest delivery status, assigned rider, payment status, proof records, and audit logs.
3. Confirm whether the package has been picked up.
4. Contact rider/customer/business using approved support channel.
5. Add admin note or audit reason for any manual action.

## If No Rider Is Assigned

1. Confirm delivery is `SEARCHING_RIDER`.
2. Check rider availability, approval, suspension, fresh location, and active-job limit.
3. Manually assign an eligible rider if available.
4. If no rider is available, contact customer/business and cancel or reschedule according to policy.

## If Pickup Has Not Happened

Allowed recovery actions:

- Reassign rider.
- Cancel delivery with reason.
- Mark `FAILED` if delivery cannot proceed.
- Open support ticket if customer/business action is needed.

## If Pickup Has Happened

Allowed recovery actions:

- Move to `RETURN_REQUIRED`.
- Reassign only if operations can safely transfer custody.
- Mark `DISPUTED` if package custody or proof is unclear.
- Mark `RETURNED` after successful return proof.

Do not silently cancel after pickup; package custody must remain visible in state history.

## Proof Issues

- Delivery completion must remain blocked until required proof exists.
- If recipient OTP fails, use alternate configured proof only if policy allows.
- Admin override must create audit log and reason.

## Payment/Refund Issues

- Do not change payment state manually from the client.
- Use backend/admin refund flow once implemented.
- Preserve payment transaction and webhook event IDs.
- Escalate mismatched payment/refund records to payment dispute runbook.

## Required Records

Every recovery action must create:

- Delivery status history event
- Audit log for admin/manual/sensitive action
- Support ticket when customer/business follow-up is required
