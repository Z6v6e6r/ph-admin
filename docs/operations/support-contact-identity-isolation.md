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

Validation: `npx ts-node test/support-contact-identity-isolation.test.ts`,
`npm run test:support-client-resolve`, `npm run test:support-dialog-resolution`,
`npm run test:support-outbox-max-attempts`, and `npm run build`. The regression
checks forwarded contacts, mismatched identities/phones, partial caches,
unavailable persistence, no-write failures and reload/reconciliation.
