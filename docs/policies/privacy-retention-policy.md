# Privacy And Retention Policy

Status: v1 draft for local build and operations testing.

## Purpose

This policy defines how sensitive platform data should be handled. It supports the architecture rule that precise location, customer addresses, rider documents, proof files, and payment records are sensitive.

## Sensitive Data Classes

- Customer phone, name, and saved addresses
- Business customer contact details
- Rider phone, identity documents, vehicle documents, and approval records
- Pickup/drop coordinates and raw rider locations
- Proof photos, signatures, OTP verification records, and pickup references
- Payment provider references, webhook IDs, refund records, and settlement records
- Support tickets, disputes, admin notes, and audit logs

## Access Rules

- Customers may access only their own deliveries, tracking, receipts, and proof.
- Riders may access only assigned offers/jobs and their own earnings.
- Businesses may access only their own business deliveries and reports.
- Admins may access operational data according to role.
- Sensitive admin actions must be audited with actor, entity, timestamp, reason where applicable, and metadata.

## Minimization Rules

- Clients should receive only the data needed for the current workflow.
- Do not expose full contact details when masked contact or mediated communication can work.
- Do not log OTP codes, auth tokens, private proof URLs, full payment payloads, or rider document URLs.
- Store money in integer minor units only.
- Do not store card data.

## Retention Defaults

Final retention periods must be approved before launch. Use these development defaults until then:

| Data | Draft Retention |
| --- | --- |
| OTP challenges | Delete or expire after 5 minutes; purge consumed/expired rows routinely. |
| Raw rider locations | Keep only while operationally useful; target 7-30 days before launch decision. |
| Delivery status history | Retain as operational/legal record. |
| Audit logs | Retain as operational/security record. |
| Proof files | Local default 90 days via `PROOF_RETENTION_DAYS`; final dispute-window retention must be approved before launch. Serve through signed URLs only. |
| Rider documents | Retain while rider is active and for required compliance period after offboarding. |
| Payment/refund records | Retain according to accounting/provider requirements. |
| Support tickets | Retain through dispute/accounting window, then minimize if possible. |

## Signed URL Requirement

Private files must not be public bucket URLs. Proof photos, signatures, rider documents, and sensitive attachments must be served through short-lived signed URLs after authorization checks.

## Location Rules

- Do not stream location every second.
- Use lower frequency while idle and higher frequency only during active delivery.
- Exclude riders with stale location from dispatch.
- Do not expose rider location to unauthorized users.

## Local Development Notes

- Local dev may use mock OTP and mock payment.
- Local dev may use mock private proof file references, but API responses must expose only sanitized proof metadata and signed access URLs.
- Local dev must not contain real customer data, rider documents, or payment secrets.
- `.env` files and provider keys must not be committed.
