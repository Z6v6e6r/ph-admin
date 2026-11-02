# CUP tournament read positions v1

Concrete prerequisite with an actual LK2 Web consumer; no notification feed, inbox,
provider sender or native bridge is installed by this source packet.

Private actor routes under `/internal/tournaments/chat/v1`: POST `read-position`
(read only), POST `read-requests` (original READ), POST `read-requests/read`
(read-only original receipt). The existing dedicated RS256 actor purpose binds exact
method/path/body, canonical tenant/user/session, provider namespace, correlation and
expiry. Original READ requires Idempotency-Key=requestId. This does not authorize a
background importer to mark another actor's messages read. Response version is
`tournament-chat-read.v1`; private exact witness is removed by LK2 after canonical
original JOIN mapping verification. No additional PII/log payloads.

`tournamentChatReadV1` permanently binds tenant, owner namespace, tournament,
incarnation and stream. Positions retain exact original witness, baselineSequence
and monotonic readThroughSequence. Bound640 retained witness positions derives
from existing512 JOIN/LEAVE and128 organizer journals. No eviction/reset. Pending
READ receipts have their own64 cap and persisted pendingCount; they consume no
message sequence and never match the history publication index.

The first chat bootstrap atomically initializes all current witnesses at frontier0.
Existing streams lacking the marker remain unadopted: GET/READ and positive
lifecycle never silently bootstrap a partial marker. `adoptReadState` is a pure full
plan builder: an existing stream requires an explicit audit actor/correlation,
current complete journals/roster and frontier P. A separately approved setup must
capture exact full row, build the entire plan, apply full-preimage CAS, and verify
exact readback. No executable adoption/backfill/production operation runs here.
A stale plan after publication, JOIN, LEAVE or assignment fails CAS and must not
be treated as applied. Replanning is a separately controlled setup step.

Adopted successful new REGISTERED JOIN and successful ASSIGN append baseline=P in
the same existing full raw-row CAS as roster/assignment. Replays do not refresh it.
Rejected operations do not create positions. Exact LEAVE/REVOKE retain even a
malformed/full read marker and NEVER parse it as a removal precondition. Positive
enrollment/read fails on malformed adopted state. Generic writers preserve markers
under full raw CAS or refuse marker presence, including orphan read markers; public
presentation remains a whitelist. Older installed executors need coherent upgrade
and drain: these source fences cannot protect against an already running old writer.

READ candidates are permanent immutable records in `tournament_chat_requests_v1`,
with discriminator TOURNAMENT_CHAT_READ_V1 and a separate _id hash domain. No new
collection or TTL. Full original body/actor/mapping/witness/stream/incarnation binds
first custody. Acceptance CAS captures immutable requested through and resulting
readThrough plus audit/pending result. Recovery copies that exact result into the
candidate before cleanup, including after LEAVE/revoke/archive. No recomputation
from later positions. Raw target is captured BEFORE fresh candidate/result read;
this closes stale-read reacceptance after concurrent recovery. Claim/candidate alone
is never success. Original status has no writes, recovery or candidate creation;
current exact witness equality is necessary for any confirmed disclosure. UNKNOWN,
absence or refusal never means no original acceptance.

Source-only index declaration READ_INDEX: `tournament_chat_read_pending_v1`, keys
`{'tournamentChatReadV1.pendingCount':1,_id:1}`, simple collation, nonunique, no sparse,
partial, hidden or TTL options. Only the guarded disposable CI fixture creates it.
Runtime `readyReads()` lists existing collection/index metadata; no startup/request
DDL. Recovery queries persisted pendingCount>0 using this exact index, max4 rows,
one accepted READ per row/tick, alongside existing bounded message recovery. Missing
read readiness is a fixed recovery failure metric, not silent success; legacy message
recovery still runs. Recovery scheduling remains existing disabled-by-default source.

Before separately approved activation: provision/verify this index with existing
operational governance; count/size retained markers and request records, prove query
timing, majority/primary durability, clocks and compatible writer floor; explicitly
adopt old streams. No retention/TTL/deletion policy is introduced. Rollback must
retain markers, requests and accepted recovery; never resume old writers that erase
or ignore baselines. Index removal only after recovery is stopped and accepted work
is accounted for under a separately approved operation. Soft read capacity never
blocks terminal roster/organizer removal; Mongo hard document limits remain a real
capacity prerequisite, not proved by synthetic fixture success.

Acceptance freshness uses existing5s CAS budget: local proof exp>now+5s and Mongo
NOW<exp-5s with maxTimeMS5s. This bounds owner operation freshness; it is not an ACK
clock synchronization or cross-database atomicity promise. FINISHED remains readable
with current ACL; CANCELED denies new actor reads/writes. Existing send/history wire
and LK1 public APIs remain unchanged. No runtime/provider/device claim.
