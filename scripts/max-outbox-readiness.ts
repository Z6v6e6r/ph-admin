/** Offline tool. Audit is read-only; every mutation needs an immutable, target-bound plan.
 * Never load .env files, bootstrap Nest, print URIs/recipients/text/tokens or run a provider call.
 */
import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BSON, MongoClient } from 'mongodb';
import { SupportPersistenceService } from '../src/support/support-persistence.service';
import { MAX_QUEUE_CONTROL_ID, MaxOutboxStore, maxQueueControlName, maxRecoveryFingerprint } from '../src/support/max-outbox-store';
import { SupportConnectorRoute as Route, SupportOutboxCommand as Command, SupportOutboxStatus as Status } from '../src/support/support.types';
const root = path.resolve(__dirname, '..');
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function externalFile(name: string, existing: boolean) {
  assert(path.isAbsolute(name)); const parent = fs.realpathSync(path.dirname(name));
  const directory = fs.statSync(parent); assert((directory.mode & 0o022) === 0 && directory.uid === process.getuid?.());
  const real = path.join(parent, path.basename(name)); assert(real !== root && !real.startsWith(root + path.sep));
  if (existing) { const s = fs.lstatSync(real); assert(s.isFile() && s.nlink === 1 && (s.mode & 0o077) === 0); }
  else assert(!fs.existsSync(real));
  return real;
}
export async function main(argv = process.argv.slice(2)) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) { assert(['--report', '--apply-plan', '--plan-sha256', '--evidence-file'].includes(argv[i]) && argv[i + 1]); assert(!args.has(argv[i])); args.set(argv[i], argv[i + 1]); }
  const report = externalFile(args.get('--report')!, false);
  const target = new SupportPersistenceService().maxQueueOperatorTarget();
  // Use the same canonical queue authority resolver as the API. Never fall back on connection failure.
  const targetFingerprint = digest(JSON.stringify([target.uri, target.dbName, target.outbox]));
  const client = new MongoClient(target.uri, { serverSelectionTimeoutMS: 5000, timeoutMS: 5000, retryReads: false });
  const privateCases: unknown[] = [];
  try {
    await client.connect(); const db = client.db(target.dbName), collection = db.collection<Command>(target.outbox);
    const control = db.collection<{ _id: string; schema: number; enabled: boolean; sequence: number }>(maxQueueControlName(target.outbox));
    const hello = await db.admin().command({ hello: 1 });
    const transactionsSupported = hello.logicalSessionTimeoutMinutes !== undefined && (!!hello.setName && hello.maxWireVersion >= 7 || hello.msg === 'isdbgrid' && hello.maxWireVersion >= 8);
    const preControl = await control.findOne({ _id: MAX_QUEUE_CONTROL_ID }, { readConcern: { level: 'majority' }, readPreference: 'primary' });
    const controlFingerprint = maxRecoveryFingerprint(preControl);
    const index = await collection.listIndexes().toArray();
    const idUnique = index.some(i => i.unique && Object.keys(i.key).length === 1 && i.key.id === 1 && !i.partialFilterExpression);
    let legacyUnreviewed = 0, unknown = 0, outstandingLeases = 0;
    for await (const command of collection.find({ connector: { $in: [Route.MAX_BOT, Route.MAX_ACADEMY_BOT] }, status: { $ne: Status.SENT } }, { readConcern: { level: 'majority' }, readPreference: 'primary' })) {
      const legacy = !Number.isSafeInteger(command.queueSequence) && !command.reconciliation;
      const uncertain = command.terminalReason === 'DELIVERY_UNKNOWN';
      const leased = command.status === Status.LEASED;
      if (legacy) legacyUnreviewed++; if (uncertain) unknown++; if (leased) outstandingLeases++;
      if (legacy || uncertain || leased) privateCases.push({ id: command.id, connector: command.connector, status: command.status, attempts: command.attempts,
        createdAt: command.createdAt, terminalReason: command.terminalReason, leasePresent: !!command.leaseToken, expectedFingerprint: maxRecoveryFingerprint(command) });
    }
    let action = 'audit';
    if (args.has('--apply-plan')) {
      const bytes = fs.readFileSync(externalFile(args.get('--apply-plan')!, true));
      assert.equal(digest(bytes), args.get('--plan-sha256')); const plan = JSON.parse(bytes.toString('utf8'));
      assert.equal(plan.schema, 'MAX_QUEUE_OPERATOR_PLAN_V1'); assert.equal(plan.targetFingerprint, targetFingerprint);
      assert.equal(plan.expectedControlFingerprint, controlFingerprint);
      assert.equal(plan.consumersPaused, true); assert.equal(plan.writerCohortVerified, true);
      assert(transactionsSupported && idUnique, 'Target lacks transaction/unique-ID prerequisites');
      action = plan.action;
      if (action === 'provision') {
        assert.equal(preControl, null);
        // This is an explicit operator migration, never startup auto-creation.
        await control.insertOne({ _id: MAX_QUEUE_CONTROL_ID, schema: 1, enabled: false, sequence: 0 }, { writeConcern: { w: 'majority' }, timeoutMS: 5000 });
      } else if (action === 'reconcile') {
        assert(preControl?.schema === 1 && preControl.enabled === false, 'Reconcile only while paused');
        const evidence = fs.readFileSync(externalFile(args.get('--evidence-file')!, true));
        assert.equal(digest(evidence), plan.evidenceSha256);
        assert.equal(typeof plan.id, 'string');
        await new MaxOutboxStore(collection, undefined, undefined, undefined, client).reconcile(plan.id, plan.expectedRecordFingerprint, plan.resolution, plan.evidenceSha256, plan.expectedControlFingerprint);
      } else if (action === 'enable' || action === 'pause') {
        assert(preControl?.schema === 1);
        if (action === 'enable') { assert.equal(legacyUnreviewed, 0, 'Old records require individual decisions'); assert.equal(unknown, 0, 'Unknown outcomes require evidence'); assert.equal(outstandingLeases, 0, 'Outstanding leases require drain or reconciliation'); assert.equal(plan.pairedAcceptanceVerified, true); assert.equal(plan.recoveryArtifactVerified, true); }
        const result = await control.updateOne(preControl, { $set: { enabled: action === 'enable' } }, { writeConcern: { w: 'majority' }, timeoutMS: 5000 });
        assert.equal(result.matchedCount, 1, 'Foreign control change: stop, no blind retry');
      } else assert.fail('Unknown operator action');
    }
    const postControl = await control.findOne({ _id: MAX_QUEUE_CONTROL_ID }, { readConcern: { level: 'majority' }, readPreference: 'primary' });
    const result = { postControl, schema: 'MAX_QUEUE_READINESS_V1', action, targetFingerprint, controlFingerprint, control: preControl,
      transactionsSupported, idUnique, legacyUnreviewed, unknown, outstandingLeases, privateCases, productionAcceptanceProven: false,
      note: 'DB report cannot prove paused flows, bot mapping/TLS or reviewed writer cohort. Re-audit after any mutation.' };
    fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ action, transactionsSupported, idUnique, legacyUnreviewed, unknown, outstandingLeases, privateReportWritten: true }));
  } finally { await client.close(); }
}
if (require.main === module) void main().catch(() => { console.error('MAX_QUEUE_OPERATOR_FAILED_UNCONFIRMED_STOP_READBACK_REQUIRED'); process.exitCode = 1; });
