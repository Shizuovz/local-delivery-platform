# Dispatch Recovery Runbook

Status: v1 draft for local build and operations testing.

## Purpose

Use this runbook when automatic dispatch does not produce a rider assignment quickly enough or when rider offer timing fails.

## Expected V1 Dispatch Behavior

1. Delivery enters `SEARCHING_RIDER`.
2. System offers the job to the nearest eligible rider.
3. Rider has 15-30 seconds to accept.
4. Expired/rejected offers move to the next eligible rider.
5. If no eligible rider accepts, delivery enters admin attention.
6. Admin can assign, reassign, cancel, or contact involved parties.

## Rider Eligibility

Eligible riders must have:

- Approved rider profile
- Online status
- Not suspended
- Fresh location
- Suitable vehicle/package capability
- Inside service zone/radius
- Active-job limit not exceeded

## Recovery Steps

1. Open admin delivery board.
2. Filter for `SEARCHING_RIDER`, stale, or unassigned deliveries.
3. Open delivery timeline.
4. Check available riders and latest locations.
5. If a suitable rider exists, manually assign with a reason.
6. If no rider exists, contact customer/business and cancel or reschedule.
7. Ensure action creates status history and audit log.

## Queue Expectations

Redis/BullMQ dispatch must use:

- `dispatch.delivery` jobs for starting rider search
- `dispatch.offer-timeout` jobs for expiring offers
- Retry with bounded attempts
- Job payloads containing IDs only
- Database as source of truth for assignment state

## Alerts

Alert operations/engineering on:

- Dispatch queue backlog
- High dispatch failure rate
- Repeated offer timeout failures
- Redis connectivity failure
- Delivery stuck in `SEARCHING_RIDER`
- Admin attention queue exceeding threshold

Check queue visibility through:

```http
GET /api/v1/health/metrics
```

Relevant trigger keys:

- `redis.queue.degraded`
- `queue.dispatch.delivery.failed`
- `queue.dispatch.delivery.backlog`
- `queue.dispatch.offer-timeout.failed`
- `queue.dispatch.offer-timeout.backlog`
