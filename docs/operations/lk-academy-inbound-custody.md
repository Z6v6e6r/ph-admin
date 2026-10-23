# LK Academy inbound bridge: source fix, not durable cutover admission

## Status

This increment removes the template's unconditional early success response. **It does not make the current support API durable and does not authorize importing this flow, opening the maintenance fence, or switching production traffic.** `SupportService.ingestEvent()` still publishes in-memory state before its fire-and-forget Mongo writes complete.

## Owned source

- `node-red/lk-academy-support-ingest-flow.json`.
- `test/nodered-lk-academy-ingest.test.mjs`.
- This operational/compatibility note.

No support identity rules, server persistence semantics, Mongo schema/indexes, subscriptions/D0 rules, deployment files or dependencies are changed. Existing identity isolation and verified-contact guards must remain intact in any later durability change.

## Bridge behavior and compatibility

The path and connector stay unchanged: `POST /integrations/lk-academy/webhook` forwards once to `POST /support/dialogs/events` with `LK_ACADEMY_WEB_MESSENGER`.

- There is one downstream request, no application retry and no redirect following. The request carries an 8000 ms Node-RED HTTP request timeout. A scoped Catch handles transport failure; it is not wired back to the request.
- No response is sent while that request is pending. A valid downstream 2xx result must contain nonempty string `client.id` and `dialog.id`; a message is not required because existing profile/contact events need not create one.
- Successful processing retains HTTP 200 and `{ ok: true, accepted: true }`, adding `persistenceConfirmed: false`. This explicitly means **processing/forwarding only**, not verified Mongo custody, deduplication, exactly-once handling or a safe point for the sender to discard its durable copy.
- Missing identifiers return HTTP 400 instead of being silently dropped. Downstream 400/422 map to 400; 409 maps to 409; 429/503 map to 503; 504 maps to 504. Other failures, redirects and malformed 2xx map to 502. Transport failure returns 503. These error responses are fixed small objects, not copies of downstream bodies, headers, diagnostics or credentials.
- Error/timeout does not prove the backend did nothing. This bridge does not automatically repeat the POST. A safe sender retry/replay contract remains an admission prerequisite.
- `externalMessageId` and `timestamp` are forwarded exactly from their explicitly named source fields when present. They are not invented from `id`/`messageId`, text or receive time. Existing DTO validation still applies. Their presence does **not** establish namespace, account binding or stability across retries.
- Both full-message debug nodes are disabled and disconnected from the ingress/result path. Failure logging no longer emits the downstream body. Existing `meta.payload` compatibility is unchanged; this change does not claim a complete stored-PII minimization audit.
- `msg.req`/`msg.res` are preserved along success, validation and Catch response paths.

The changed timing and non-2xx behavior require sender compatibility testing before import. Node-RED HTTP-node timeout, Catch-only transport error delivery (`senderr`) and redirect options must also be verified against the intended installed runtime; tests below execute function bodies and graph wiring, not an installed Node-RED engine.

## LOCAL evidence

Run `node --test test/nodered-lk-academy-ingest.test.mjs` with the supported project Node runtime. The harness executes the actual committed function bodies and wires, with a deferred synthetic HTTP boundary and no network, database, credential or provider access.

Observed RED cases before their fixes: response emitted before downstream completion; downstream 503 converted to 200; explicit source event fields omitted; missing-identity request dropped; timeout/Catch configuration absent; full debug active. Valid processing and malformed-result cases are compatibility/negative coverage, not physical persistence proof.

Retain existing `test:support-contact-identity`, `test:support-dialog-resolution`, `test:support-client-resolve` and the build typecheck. There is no configured aggregate test/lint/formatter in this repository. Do not label the synthetic bridge tests as Mongo durability, process-restart, installed Node-RED, provider or production acceptance.

## Still required for durable custody and replay

Before designing or activating the durable route, obtain:

1. The actual sender implementation/configuration, stable source ID contract and uniqueness namespace (account/tenant, user/chat, event/message), including retries and ID reuse.
2. Sender durable retention until an authoritative receipt, behavior after timeout/non-2xx/lost ACK, replay support and retention duration.
3. The event set covered by custody: inbound messages and/or contact/profile/station/system events that create no message; required recovery result and command semantics.
4. The authoritative client-profile/backend ownership and compatible cross-backend merge boundary; intended Mongo topology, transaction support, durability and verify-only index readiness.

A later scoped `commitAcademyInbound` must prepare isolated state, commit canonical records/receipt and outbox intents atomically on the agreed target, then publish cache/observers. It must not wrap the existing fire-and-forget methods, silently fall back to another backend, expose uncommitted commands, erase conflicting copies or turn arbitrary duplicate-key errors into success. Duplicate recovery must retain identity guards and verify committed owner/payload evidence. Cache hydration must not replace a newer commit with a stale snapshot.

Acceptance must include failed/ambiguous writes, loss of response after commit, concurrent duplicates across instances, process restart, more than 30 newer messages, changed dialog, conflicting account/chat/payload, distinct IDs with identical text and events without a message. Exactly-once observer delivery does not follow from a Mongo transaction and needs its own contract.

MAX and Telegram use other paths and are not certified by this Academy-only change. The production maintenance fence stays closed. No real/shared DB writes, Node-RED import, release publication, external messages or deployment are part of this increment.
