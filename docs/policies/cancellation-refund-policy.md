# Cancellation And Refund Policy

Status: v1 draft for local build and operations testing.

## Purpose

This policy gives the API and admin console a safe default for cancellation/refund behavior before real provider integration. It must be finalized before public launch.

## Payment Model

- Customer `SEND` deliveries are prepaid by default.
- Approved businesses may be prepaid or invoiced/postpaid.
- No wallet or stored-value system in v1.
- Refunds are backend/admin initiated only.
- Client-reported payment success must never be trusted.

## Cancellation Stages

| Stage | Delivery State | Default Handling |
| --- | --- | --- |
| Before payment | `DRAFT`, `QUOTED` | Cancel with no refund. |
| After payment, before rider assignment | `CONFIRMED`, `SEARCHING_RIDER` | Cancel delivery and initiate eligible refund. |
| Rider assigned before pickup | `RIDER_ASSIGNED`, `EN_ROUTE_PICKUP`, `ARRIVED_PICKUP` | Cancel delivery and initiate eligible refund in local v1; fee/rider compensation rules must be finalized before launch. |
| After pickup | `PICKED_UP`, `EN_ROUTE_DROP`, `ARRIVED_DROP` | Move to `RETURN_REQUIRED` unless admin marks exception. |
| Delivered | `DELIVERED` | No normal cancellation; use support/dispute flow. |
| Failed/returned/disputed | `FAILED`, `RETURNED`, `DISPUTED` | Admin/support decides refund or adjustment. |

## Refund Rules

- Refund operations must be idempotent.
- Refund state must use the canonical refund states.
- Payment state must remain consistent with refund state.
- Refunds must store reason, amount, provider reference when available, actor, and audit log.
- Partial refunds must store every component separately so margin remains calculable.
- Local mock refunds are marked `SUCCEEDED` immediately and move payment to `REFUNDED`.
- Cancelling an unpaid `CREATED` or `PENDING` payment marks the payment `FAILED` so it cannot be charged later.

## Admin Requirements

Admin cancellation/refund actions must capture:

- Actor
- Delivery ID
- Payment ID when applicable
- Reason
- Amount and currency for refunds
- Customer/business/rider impact notes where needed
- Audit log entry

## Not Yet Finalized

These must be decided before launch:

- Cancellation fee before pickup
- Rider compensation for cancelled assigned jobs
- Return fee after pickup
- Customer refund SLA
- Business postpaid credit rules
- Dispute evidence window
