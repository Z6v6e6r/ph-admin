# Support identity conflicts and repair boundaries

A successful identity lookup establishes the owner for the entire incoming event,
including ordinary text. Phone, email and username matches must not replace that
owner or merge another historical profile into it. The verified-phone check and
the fail-closed checks for multiple owners, crossed fields, divergent store copies
and unavailable persistence remain mandatory.

Profiles loaded from persistence are authoritative for their current identities,
authentication state and contact ownership. Hydrating old messages must not add
removed identities, phones or emails to those profiles or upgrade their auth state.
Legacy reconstruction of a genuinely missing profile is unchanged; it is not an
administrative repair or an independent proof of current ownership.

## Addressing existing duplicates

Use an individually reviewed repair plan, with explicit authorization for its
target. Do not automatically choose a canonical owner by age or phone alone.

1. Read all configured stores and establish the canonical client from independent
   account/channel evidence. Include crossed user/chat-field matches in the search.
2. Preserve raw BSON preimages and an independently verified private backup.
   Inventory historical message IDs/hashes, dialog ownership, stable outbox entries
   and the actual archive inventory. An absent historical archive is not proof that
   it was preserved; record the absence separately without restoring or replaying it.
3. Remove only the reviewed obsolete identity elements with typed full-preimage
   CAS and majority+j writes. Preserve the profile, phone, messages and dialogs.
   Journal intent before each write. Resolve a lost acknowledgement by readback,
   not automatic retry; reconcile partial outcomes before any further operation.
4. Verify exact target postimages, canonical bindings, one distinct owner across
   stores and preservation of baseline history/outbox. Concurrent legitimate
   messages may change canonical timestamps, but not the protected binding.
5. Verify the actual running process separately. A persisted-only replay does not
   inspect its cache. A natural client message can establish end-to-end evidence;
   never send a diagnostic message as the client without explicit authorization.

`GET clients/resolve` can return cached data and is not cache invalidation. Full
hydrate/reconcile can merge same-phone clients and rewrite historical references;
it must not be used as a cache-clearing shortcut. Keep full sync disabled during
an identities-only repair. Do not infer revocation solely from an identity missing
in a fresh database read: asynchronous client writes may still be pending.

## Prevention and remaining work

The owner pin and authoritative-profile hydration rules prevent the two reproduced
paths for a known owner: a normal message merging it into an older same-phone
profile, and historical messages restoring a detached binding. Regression tests
cover partial warm cache, hydration, WEB/MAX, retained history/archive, real
conflicts, unavailable stores and legacy orphan reconstruction.

They do not introduce atomic global uniqueness for new identities. Stronger
protection requires a separately reviewed authoritative identity registry, atomic
claim/revocation with versions, a migration of existing bindings, and simultaneous
first-message/multiple-worker tests. A unique index in just one mirror is
insufficient. Add a read-only duplicate audit and operational alerting before
rolling this out broadly; do not auto-merge conflicts based on phone alone.

The media recovery patch must derive the same support service as the candidate.
Keep its exact-source and compiled-closure checks; do not waive drift to release
an identity fix. Merge, deployment, restart and shared data repair each retain
their explicit operational authorization and readiness requirements.
