# Cache Policy

Status: v1 draft for local build and operations testing.

## Purpose

This policy defines how Redis-backed caching may be used in the local delivery platform. PostgreSQL remains the source of truth for delivery, assignment, payment, refund, proof, permission, and audit state.

## Principles

- Cache only read models and derived summaries.
- Never use cache as the source of truth for state-changing decisions.
- Keep TTLs short for operational views.
- Do not cache raw PII, private proof/document URLs, OTP codes, auth tokens, payment payloads, or webhook secrets.
- Redis failures must degrade to database reads for user-facing APIs.
- All cache keys must avoid phone numbers, addresses, names, proof file refs, and exact coordinates.

## Allowed Cache Uses

| Data | Allowed | TTL |
| --- | --- | --- |
| Admin operations report summary | Yes | 15 seconds |
| Admin dashboard count widgets | Yes | 15 seconds |
| Service-zone public config | Yes | 5 minutes |
| Pricing rule public config | Yes, once configurable pricing exists | 1 minute |
| Rider eligibility candidate snapshot | Only as optimization, not truth | 5-15 seconds |
| Business report export metadata | Yes, after report generation | 1-5 minutes |

## Not Allowed In Cache

- OTP codes or hashes.
- Auth/session tokens.
- Raw payment webhook payloads.
- Raw proof or document file URLs.
- Signed proof/document URLs.
- Full customer address books.
- Exact rider location history beyond a short operational optimization.
- Any value used as the only enforcement point for assignment, payment, refund, proof, or authorization.

## Invalidation Rules

Admin operations report cache should be invalidated or allowed to expire after:

- delivery creation
- delivery status transition
- assignment accept/reject/expire/assign/reassign
- payment or refund state change
- support ticket creation or status update
- rider availability/status change

For v1, short TTL expiry is acceptable for admin summary metrics. Explicit invalidation can be added where stale reads become operationally confusing.

## Failure Behavior

If Redis is unavailable:

- API must continue serving reports from PostgreSQL or the in-memory store.
- Cache get/set/delete failures should not fail user requests.
- Health/operations tooling should expose Redis availability separately.

## Key Convention

Use namespaced keys:

```text
cache:v1:<scope>:<name>[:<stable-id>]
```

Examples:

```text
cache:v1:admin:operations-report
cache:v1:service-zones:active
```

Do not include phone numbers, names, full addresses, proof refs, tokens, or raw coordinates in keys.

## Current Implementation

The first cache-backed report is:

```text
GET /api/v1/admin/reports/operations
```

It returns derived operational counts and may be cached for 15 seconds. PostgreSQL or in-memory data remains authoritative.
