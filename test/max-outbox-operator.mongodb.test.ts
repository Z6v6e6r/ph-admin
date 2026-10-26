import * as assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MongoClient } from 'mongodb';
import { main as operator } from '../scripts/max-outbox-readiness';
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
async function main() {
  const uri = process.argv[2], target = new URL(uri); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.username + target.password, '');
  const client = new MongoClient(uri); await client.connect(); const db = client.db('max_operator_test_' + randomUUID().replaceAll('-', ''));
  const coll = db.collection('outbox'); await coll.createIndex({ id: 1 }, { unique: true });
  const before = { ...process.env }, root = await mkdtemp(path.join(os.tmpdir(), 'max-queue-operator-'));
  Object.assign(process.env, { SUPPORT_MONGODB_URI: uri, SUPPORT_MONGODB_DB: db.databaseName, SUPPORT_OUTBOX_COLLECTION: 'outbox', SUPPORT_MAX_OUTBOX_MODE: 'receipt-v1' });
  delete process.env.SUPPORT_MAX_MONGODB_URI; delete process.env.SUPPORT_MAX_MONGODB_DB; delete process.env.SUPPORT_MAX_OUTBOX_COLLECTION;
  let n = 0;
  const run = async (plan?: any, evidence?: string) => {
    const report = path.join(root, 'report-' + ++n + '.json'), args = ['--report', report];
    if (plan) { const file = path.join(root, 'plan-' + n + '.json'), body = JSON.stringify(plan); await writeFile(file, body, { mode: 0o600 }); args.push('--apply-plan', file, '--plan-sha256', hash(body)); }
    if (evidence) args.push('--evidence-file', evidence);
    await operator(args); return JSON.parse(await readFile(report, 'utf8'));
  };
  const plan = (audit: any, action: string) => ({ schema: 'MAX_QUEUE_OPERATOR_PLAN_V1', action, targetFingerprint: audit.targetFingerprint,
    expectedControlFingerprint: audit.controlFingerprint, consumersPaused: true, writerCohortVerified: true });
  try {
    let audit = await run(); assert(audit.transactionsSupported && audit.idUnique); assert.equal(audit.control, null);
    assert.equal((await db.listCollections().toArray()).length, 1, 'Audit never creates collections/control/indexes');
    await assert.rejects(() => operator(['--report', path.resolve('test/forbidden-audit-output.json')]));
    const wrong = plan(audit, 'provision'); wrong.targetFingerprint = '0'.repeat(64); await assert.rejects(() => run(wrong));
    const provisioned = await run(plan(audit, 'provision')); assert.equal(provisioned.postControl.enabled, false);
    await coll.insertOne({ id: 'synthetic-old', connector: 'MAX_BOT', status: 'PENDING', attempts: 100, createdAt: '2020-01-01T00:00:00Z',
      text: 'synthetic-private-message', targetExternalChatId: 'synthetic-private-recipient', leaseToken: 'synthetic-private-token' });
    audit = await run(); assert.equal(audit.legacyUnreviewed, 1);
    const serialized = JSON.stringify(audit); for (const forbidden of ['synthetic-private-message', 'synthetic-private-recipient', 'synthetic-private-token', uri]) assert(!serialized.includes(forbidden));
    await assert.rejects(() => run({ ...plan(audit, 'enable'), pairedAcceptanceVerified: true, recoveryArtifactVerified: true }));
    const evidence = path.join(root, 'synthetic-evidence.txt'); await writeFile(evidence, 'synthetic proof of non-delivery', { mode: 0o600 });
    await run({ ...plan(audit, 'reconcile'), id: audit.privateCases[0].id, expectedRecordFingerprint: audit.privateCases[0].expectedFingerprint,
      evidenceSha256: hash(await readFile(evidence)), resolution: 'confirmed_not_sent' }, evidence);
    assert.equal((await coll.findOne({ id: 'synthetic-old' }))?.status, 'FAILED');
    audit = await run(); assert.equal(audit.legacyUnreviewed, 0); assert.equal(audit.unknown, 0);
    await coll.insertOne({ id: 'synthetic-lost-lease', connector: 'MAX_BOT', status: 'LEASED', attempts: 1, queueSequence: 10, leasedUntil: '2020-01-01T00:00:00Z' });
    const leaseAudit = await run(); assert.equal(leaseAudit.outstandingLeases, 1);
    await assert.rejects(() => run({ ...plan(leaseAudit, 'enable'), pairedAcceptanceVerified: true, recoveryArtifactVerified: true }));
    assert.equal((await coll.findOne({ id: 'synthetic-lost-lease' }))?.status, 'LEASED', 'Read-only gate must never quarantine records as a side effect');
    await coll.deleteOne({ id: 'synthetic-lost-lease' });
    const enabled = await run({ ...plan(audit, 'enable'), pairedAcceptanceVerified: true, recoveryArtifactVerified: true });
    assert.equal(enabled.postControl.enabled, true);
    const snapshot = await coll.find({}).toArray();
    const cleanup = await promisify(execFile)(process.execPath, ['scripts/support-outbox-cleanup.mjs', '--mark-failed'], { env: process.env }).then(() => false, () => true);
    assert(cleanup, 'Legacy cleanup cannot bypass the v1 state fence'); assert.deepEqual(await coll.find({}).toArray(), snapshot);
    console.log('Operator physical Mongo: read-only default, canonical target, private evidence, closed provision, stale/wrong-target denial, old-record gate, per-record reconcile and cleanup exclusion PASS');
  } finally { for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key]; Object.assign(process.env, before);
    await db.dropDatabase(); await client.close(); await rm(root, { recursive: true }); }
}
void main().catch(e => { console.error(e); process.exitCode = 1; });
