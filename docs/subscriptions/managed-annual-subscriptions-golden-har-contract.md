# Managed annual subscriptions: Golden HAR contract

Status: **CONTRACT ONLY / NO PROVIDER SEMANTICS ACCEPTED YET**.

This contract defines the evidence required before a Viva/LK projection producer may create a real
row in `subscription_canonical_target_snapshots`. The synthetic fixture producer does not satisfy
this contract and must never be relabelled as provider evidence.

## Capture boundary

Capture is read-only and must use the separately confirmed synthetic Viva client. Record the exact
request method, normalized endpoint template, response status, capture time and provider request
correlation reference. Do not create, join, cancel, delete, charge, refund or consume a visit while
collecting the evidence.

The raw HAR is an encrypted, access-controlled diagnostic artifact outside MongoDB and Git. Before
review, remove authorization headers, cookies, phone numbers, names, email addresses, payment
instruments, session identifiers and unrelated client records. Keep only the synthetic client
identifier where it is required to prove response ownership. Never put a bearer, cookie, raw HAR or
provider response body in a canonical snapshot.

## Evidence required for one target revision

Each accepted revision must have independently reviewable evidence for:

| Canonical field | Required proof | Stop condition |
| --- | --- | --- |
| `tenantId` | Configured tenant and authenticated synthetic response belong to the same tenant | Tenant inferred from browser URL or request body |
| `targetId` | Stable provider/LK target identifier and endpoint semantics | ID changes between list and detail without a documented bridge |
| `action` and `category` | Exact read path proving create, join, group, tournament or add-on classification | Classification derived from title text |
| `stationId` | Reviewed CUP station to Viva studio/location mapping with revision | Browser-supplied station or unverified studio mapping |
| `externalEventTypeId` | Provider event/direction/type dictionary response and CUP mapping revision | Human-readable label used as identity |
| `productTypeId` | Product dictionary proof for add-ons; explicit null for non-add-ons | Product inferred from price or title |
| `durationMinutes` | Source timestamps or explicit duration field and timezone rule | Local time guessed or DST/timezone unknown |
| `startsAt` | Provider timestamp plus documented conversion to UTC ISO-8601 | Time has no zone or date rollover is ambiguous |
| `basePriceMinor` | Raw price field, currency, unit and rounding proof | Rubles/kopecks unit is unverified or floating arithmetic is required |
| `dictionaryRevision` | Immutable hash/version of all station/event/product mappings used | Mutable dictionary without revision |
| `evidenceRef` | SHA-256 reference to sanitized target evidence metadata | Raw payload, URL token or PII stored in MongoDB |
| `priceEvidenceRef` | Separate SHA-256 reference to sanitized price evidence metadata | Reuse of target evidence without explicit price field proof |
| `observedAt` and `expiresAt` | Server capture time and approved freshness window | Client clock or unbounded cache lifetime |

Provider catalogue `cost` currently remains `UNVERIFIED`: it must not be converted to RUB minor
units until a Golden HAR pair and provider documentation or an authoritative read-back prove the
unit. The same applies to station, event and product IDs seen only in an admin form.

## Required trace set

For every supported station/event combination, retain sanitized metadata for:

1. the list/read response that establishes the target and ownership;
2. the exact detail/dictionary response that establishes station and event/product identity;
3. the exact authoritative price read and its currency/unit;
4. one unavailable/not-found response;
5. one stale/revoked or cancelled target response;
6. a repeated read proving stable identifiers and price units.

Create and join are separate action contracts even when they reference the same event type. Group
training, tournament and add-on product each require their own trace set. One trace must not be
generalized to another station or category.

## Projection acceptance

A reviewer records only hashes, normalized endpoint templates, statuses, timestamps, dictionary
revision and explicit field mappings. The producer must then pass contract tests proving:

- deterministic mapping of the same evidence to the same snapshot revision;
- conflict on changed content at the same tenant/target/action/revision;
- monotonic revision and explicit revocation behavior;
- action/category and add-on product invariants;
- integer RUB minor units with documented rounding;
- bounded freshness and expiration;
- absence of PII, credentials and raw provider payloads;
- no provider mutation or browser-controlled canonical field.

Until all rows in the table are proven, a real producer must fail closed with provider/canonical
evidence unavailable. Synthetic fixtures may be used only for Gate E calculation tests and must
retain their `synthetic:` evidence prefixes.
