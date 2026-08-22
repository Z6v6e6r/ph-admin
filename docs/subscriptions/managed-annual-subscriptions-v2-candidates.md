# Managed annual subscriptions: Piter and HUB v2 candidates

Status: **ISOLATED CANDIDATE / NO DATABASE OR PROVIDER MUTATION**.

This checkpoint prepares API-ready policy-version candidates for the existing annual Piter and HUB
subscription types. It does not create v2 in production, publish a policy, create a provider mapping,
activate an instance, enable runtime flags or change Viva.

## Read-only evidence, 2026-08-22

The candidate uses exact provider read-backs, not labels copied from the admin form. Those live
reads were not retained as the separately controlled Golden HAR artifact, so the candidate keeps
`dictionaryEvidenceRef=null` and remains blocked from publication:

- Piter subscription product `8bf334ba-3050-4017-b40a-7eef2db1eb16` returned HTTP 200 from the exact
  Viva subscription-card read path. It reports 365 validity days, studio limitation enabled with
  Piter studio `1ea77cbf-bc36-49a1-96d6-f35c216a409b`, direction `4588` and type `1613`.
- HUB subscription product `db7a5250-7369-4f43-8ac5-9111be24bc74` returned HTTP 200 from the same
  exact read path. It reports 365 validity days, no studio limitation, direction `4588` and type
  `1613`.
- Detail reads for current public open games at Piter, Skolkovo, Nagatinskaya Premium, Yasenevo,
  Terekhovo and Nagatinskaya all returned direction `4588`.
- The public Viva studio dictionary returned 25 studio IDs. HUB station access and benefits both use
  an explicit `STATION_LIST`, because the current runtime's `ALL_STATIONS` access combined with an
  exact benefit list would let an unknown station produce a full-price entitlement and consume a
  daily unit. The HUB candidate therefore pins the complete 25-ID dictionary snapshot and its hash.
  A later studio addition fails closed with `STATION_NOT_ALLOWED` until a new policy version updates
  that snapshot.

The provider `cost` read-back is intentionally not used by the policy candidate. The current Viva
adapter still marks the cost unit as `UNVERIFIED`; a numeric value alone is not sufficient price-unit
evidence.

## Candidate rules

Both candidates retain the current v1 lifecycle and controls, then add only the proven game benefits:

- one usage per local day across create or join;
- create: one 60-minute open game;
- join: a 60, 90 or 120-minute open game;
- activation on first use, otherwise at `2026-10-01 00:00 Europe/Moscow`;
- validity: 365 days;
- Piter: exact Piter station only;
- HUB: access and benefits pinned to the same reviewed Viva studio snapshot;
- canonical event identity: `viva:direction:4588:type:1613`.

Group training, tournaments and discounted 90/120-minute create add-ons are absent. They remain
blocked until their exact Viva dictionaries, price-unit evidence and action-specific canonical target
traces are reviewed.

## Local commands

Check both candidates without rendering a mutation request:

```bash
npm run subscriptions:annual-v2:check
```

Render one candidate, including the `CreatePolicyVersionDto` request body:

```bash
npx ts-node scripts/managed-subscriptions-annual-v2-candidates.ts --render=PITER
npx ts-node scripts/managed-subscriptions-annual-v2-candidates.ts --render=HUB
```

Run the candidate contract test:

```bash
npm run test:subscriptions-annual-v2
```

The command has no `--apply` mode by design.

## How rules change later

Policy versions are append-only. While Piter/HUB v1 remain DRAFT, the reviewed request can create v2
through `POST /v1/admin/subscription-types/:subscriptionTypeId/policy-versions`; the server allocates
the next version and keeps it DRAFT. Publication then requires separate provider preview, publication
preview, approval and publish gates.

After a version is published it must not be edited in place. A later change requires a new version,
a new dictionary revision/evidence reference, regression checks and a supersession operation. The
current contour does not yet implement the supersession command, so later replacement of an active
policy remains a release blocker rather than an implicit overwrite.

## Remaining runtime blocker

These candidates make the policy-version payload pass the current service and runtime-projection
contracts, but are intentionally not publication-ready and do not make LK1/LK2 enforce it. A real
enforcement still requires a provider-backed canonical target producer that maps each trusted LK
create/join target to the composite event identity, exact station, duration, price and immutable
evidence revision. Publication also requires an independently retained and reviewed Golden HAR
dictionary evidence artifact. The first-publication contour also currently supports only one exact
station or `ALL_STATIONS`, not the safe 25-station HUB scope; this requires a separate reviewed
multi-station provider-scope design. Until those items and the publication/runtime flags are
separately deployed and enabled, the contour must remain fail closed.
