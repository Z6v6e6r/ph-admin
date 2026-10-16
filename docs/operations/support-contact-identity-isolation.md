# Support contact identity isolation

An inbound CONTACT from an already verified connector identity is a shared
contact, not evidence that another phone or email belongs to the sender. Keep
the sender's client, display name and connector binding. Store the contact
phone/email in `message.meta.sharedContact`; use the sender's primary phone in
the message's identity fields and leave its identity email unset.

Before phone/email fallback, ingest independently loads supplied user/chat
identity candidates from every configured persistence backend. A missing
configured backend or a failed lookup returns 503 before persistence writes.
Field collisions, different owners and user/chat pairs that do not coexist on
one connector identity return 400. A known verified LK/MAX sender with a
conflicting message phone also returns 400. Existing lookup callers keep their
availability behavior because strict backend readiness is opt-in.

The initial phone-based linking flow is preserved when no sender identity is
known. Already contaminated profiles/messages require a separate authorized
repair: this guard does not split existing records or alter runtime caches.

For a repair, preserve a coherent protected preimage, independently attribute
client messages and staff replies, retire shared IDs, quarantine notifications
whose recipient ownership is ambiguous, and permanently cancel undelivered
commands rather than replaying them. Quiesce every direct and bridged writer;
use compare-and-swap transaction checks, guarded recovery and post-restart
identity/history verification. Activating a compatible runtime artifact and
restarting production remain separate operator actions.

New dialogs receive their connector before the first persistence write. Without
that routing information, the initial write can target the primary backend while
the completed dialog targets web/MAX; their asynchronous cross-backend cleanup
can delete both copies. The identity acceptance includes durable dialog and
message ownership, not only the in-memory client count.

Validation: `npm run test:support-contact-identity`,
`npm run test:support-client-resolve`, `npm run test:support-dialog-resolution`,
`npm run test:support-outbox-max-attempts`, and `npm run build`. The regression
checks forwarded contacts, mismatched identities/phones, partial caches,
unavailable persistence, no-write failures and reload/reconciliation.

## Physical persistence and process-restart acceptance

Run `npm run test:support-contact-identity:mongo` with
`SUPPORT_IDENTITY_MONGODB_TEST_URI` explicitly pointing to a disposable loopback
replica set, for example
`mongodb://127.0.0.1:27017/?replicaSet=rs0&retryWrites=true&w=majority`.
There is no application-env or default-URI fallback. The test rejects credentials
and non-fixture hosts, isolates primary/web/MAX in randomly named databases, and
drops only those validated databases at completion. Never point it at a real or
shared target.

Five separate Node processes seed verified owners, forward contacts with either
partial cache, reload persisted history, and exercise an actual closed Mongo
connection plus a missing configured backend. No connector delivery, quick-reply
worker or real provider runs. The checks cover physical profile copies, dialog
and message ownership, and unchanged stored state on lookup failure.

The exact-head workflow runs both this integration test and the focused support
regressions. `node --test test/support-contact-identity-ci.test.mjs` guards their
explicit wiring. This is LOCAL/CI evidence only: it does not accept the production
operator journey, repair existing contaminated records, verify live Mongo rights,
or authorize an installation or restart.
