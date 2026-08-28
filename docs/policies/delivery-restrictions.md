# Delivery Restrictions Policy

Status: v1 draft for local build and operations testing.

## Purpose

This policy defines what the platform may carry during v1. The product must remain a controlled logistics platform, not a broad marketplace or rider-funded purchase service.

## Applies To

- `SEND`
- `BUSINESS_DELIVERY`
- `LIMITED_FETCH`

## V1 Allowed Items

Allowed items must be legal, non-hazardous, and fit within the configured package limits.

Initial allowed categories:

- Documents and envelopes
- Keys and small personal items
- Small parcels
- Office supplies
- Prepaid business parcels
- Pre-arranged `LIMITED_FETCH` pickups where no rider payment, substitution, or negotiation is required

## V1 Prohibited Items

Do not accept deliveries containing:

- Cash, stored-value instruments, or high-value negotiable instruments
- Illegal goods or stolen goods
- Alcohol, tobacco, narcotics, or controlled substances
- Weapons, ammunition, explosives, fireworks, or hazardous materials
- Prescription drugs requiring legal validation by the rider
- Perishable food marketplace orders
- Live animals
- Open liquids, fragile unpacked items, or leaking packages
- Items requiring age verification unless explicitly added to a future policy
- Any item requiring the rider to purchase, bargain, inspect quality, choose substitutes, or validate legality

## Package Limits

Final limits must be confirmed before launch. Until then, use conservative development defaults:

- `SMALL`: documents or small handheld items
- `MEDIUM`: compact parcels that fit safely in a bike bag
- `LARGE`: allowed only when explicitly priced and operationally approved
- No package should exceed the rider vehicle capability.
- Declared value limits must be configured before public launch.

## LIMITED_FETCH Rules

Allowed:

- Known pickup source
- Already-paid item or no payment required
- Customer-provided pickup reference or instructions
- Rider only collects and delivers

Not allowed:

- Rider pays merchant
- Rider chooses substitute
- Rider negotiates price
- Rider validates prescriptions
- Rider buys restricted goods

## Enforcement

- The API must validate delivery type and package fields before quote creation.
- Admin may cancel or mark a delivery as exception if the item violates this policy.
- Rider may report pickup failure if the actual item does not match the allowed delivery details.
- Policy violations must create audit/status history where tied to a delivery.
