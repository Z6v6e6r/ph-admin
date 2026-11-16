import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { captureAndContainCup3ccMax } from '../scripts/lib/cup3cc-max-containment.mjs';

// Real local writes/fsync/duplicates with an explicit virtual UID/ancestry view:
// CI and macOS do not run as root. No production process or Inspector is attached.
function fixture(mutate = '', tweakFs = () => undefined) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cup3cc-cutover-'));
  const dirs = ['custody', 'backup'].map(n => { const p = path.join(root, n); fs.mkdirSync(p, { mode: 0o700 }); return fs.realpathSync(p); });
  const actualFs = { ...fs };
  actualFs.lstatSync = p => {
    const s = fs.lstatSync(p);
    return Object.assign(Object.create(Object.getPrototypeOf(s)), s,
      { uid: 0, mode: dirs.includes(p) ? s.mode : s.mode & ~0o022 });
  };
  actualFs.fstatSync = fd => Object.assign(Object.create(Object.getPrototypeOf(fs.fstatSync(fd))), fs.fstatSync(fd), { uid: 0 });
  const stat = process.platform === 'linux' ? fs.readFileSync('/proc/self/stat', 'utf8') : '1 (fixture) ' + Array(19).fill('0').join(' ') + ' 123';
  actualFs.readFileSync = (p, ...args) => p === '/proc/self/stat' ? stat : fs.readFileSync(p, ...args);
  tweakFs(actualFs);
  const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  const context = vm.createContext({ directories: dirs, process: {
    pid: process.pid, version: process.version, getuid: () => 0,
    env: { NODE_ENV: 'production', SUPPORT_MAX_OUTBOX_MODE: 'legacy', SUPPORT_PERSISTENCE_SYNC_INTERVAL_MS: '0' },
    getBuiltinModule: n => n === 'fs' ? actualFs : n === 'path' ? path : crypto
  }, performance: { timeOrigin: 123 }, Buffer, ticks });
  const setup = `
    class Persistence {
      constructor(){this.legacyMaxClosing=false;this.legacyMaxWrites=new Set();this.legacyMaxWriteFailures=4;}
      trackedLegacyMax(action){if(this.legacyMaxClosing)return Promise.reject(Error('CLOSING'));const p=Promise.resolve().then(action);this.legacyMaxWrites.add(p);void p.then(()=>this.legacyMaxWrites.delete(p),()=>this.legacyMaxWrites.delete(p));return p;}
      persistOutboxCommand(row){return this.trackedLegacyMax(()=>Promise.resolve(row));}
    }
    class Support {
      constructor(){this.persistence=new Persistence();this.persistenceSyncIntervalMs=0;this.isPersistenceSyncInProgress=false;this.outbox=new Map();this.messages=new Map([['d',[{id:'m',body:'synthetic',missing:undefined}]]]);this.dialogs=new Map();this.clients=new Map();this.responseMetrics=new Map();}
      async acceptOutbox(row){const r=await this.persistence.persistOutboxCommand(row);this.outbox.set(r.id,r);return r;}
    }
    const service=new Support();
    service.outbox.set('held',{id:'held',connector:'MAX_BOT',status:'PENDING',meta:{legacyMaxRestartCustody:{reason:'DELIVERY_UNKNOWN'}}});
    service.outbox.set('done',{id:'done',connector:'MAX_BOT',status:'SENT'});
    const digest=f=>process.getBuiltinModule('crypto').createHash('sha256').update(f.toString()).digest('hex');
    const expected={unresolvedHistoricalFailures:4,sourceCommit:'3cc4708811fc3d734d1c6673fd38f3b928589154',pid:process.pid,nodeVersion:process.version,timeOrigin:'123',startTicks:ticks,
      acceptOutboxSha256:digest(Support.prototype.acceptOutbox),trackedLegacyMaxSha256:digest(Persistence.prototype.trackedLegacyMax),persistOutboxCommandSha256:digest(Persistence.prototype.persistOutboxCommand)};
    const operation=(${captureAndContainCup3ccMax.toString()});
    ${mutate}
    const call=()=>operation.call([service],expected,Support.prototype,Persistence.prototype,directories);
  `;
  vm.runInContext(setup, context);
  return { root, dirs, context, call: () => vm.runInContext('call()', context), clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('contains exact four unresolved failures without clearing evidence or admitting restart', () => {
  const f = fixture();
  try {
    const result = f.call();
    assert.equal(result.unresolvedHistoricalFailures, 4);
    assert.equal(result.writeFailures, 4);
    for (const key of ['activationAdmitted', 'failureRetirementProven', 'producerDrainProven',
      'httpDrainProven', 'historyPreservationProven', 'cohortCoverageProven']) assert.equal(result[key], false);
    assert.equal(result.containmentOnly, true);
    assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), true);
    assert.equal(vm.runInContext('service.persistence.legacyMaxWriteFailures', f.context), 4);
    for (const name of ['pre-containment-map.json', 'containment-intent.json', 'containment-receipt.json']) {
      assert.deepEqual(fs.readFileSync(path.join(f.dirs[0], name)), fs.readFileSync(path.join(f.dirs[1], name)));
    }
    const copy = JSON.parse(fs.readFileSync(path.join(f.dirs[0], 'pre-containment-map.json')));
    assert.equal(copy.unresolvedHistoricalFailures, 4);
    assert.equal(copy.activationAdmitted, false);
    assert.equal(copy.rows.messages[0][1][0].body, 'synthetic');
    assert.deepEqual(copy.undefinedPaths, [['messages', 'd', '0', 'missing']]);
    assert.equal(copy.rows.outbox[0][1].meta.legacyMaxRestartCustody.reason, 'DELIVERY_UNKNOWN');
    assert.throws(f.call, /ALREADY_CLOSING/);
  } finally { f.clean(); }
});

for (const [name, mutation, error] of [
  ['new failure', 'service.persistence.legacyMaxWriteFailures=5', /HISTORICAL_FAILURE_COUNT_DRIFT/],
  ['cleared failures', 'service.persistence.legacyMaxWriteFailures=0', /HISTORICAL_FAILURE_COUNT_DRIFT/],
  ['different expectation', 'expected.unresolvedHistoricalFailures=5', /HISTORICAL_FAILURE_COUNT_DRIFT/],
  ['missing expectation', 'delete expected.unresolvedHistoricalFailures', /HISTORICAL_FAILURE_COUNT_DRIFT/],
  ['tracked write', 'service.persistence.legacyMaxWrites.add(Promise.resolve())', /MAX_WRITES_NOT_DRAINED/],
  ['open command', "service.outbox.set('open',{connector:'MAX_BOT',status:'LEASED'})", /MAX_OPEN_COMMAND/],
  ['timer', 'service.noReplyQuickReplyTimer={}', /PRODUCER_TIMER_ACTIVE/],
  ['source drift', "expected.acceptOutboxSha256='0'.repeat(64)", /LIVE_FUNCTION_IDENTITY/],
  ['hydration', 'service.isPersistenceSyncInProgress=true', /HYDRATION_ACTIVE/],
  ['wrong mode', "process.env.SUPPORT_MAX_OUTBOX_MODE='receipt-v1'", /RUNTIME_MODE/],
  ['getter', "Object.defineProperty(service.persistence,'legacyMaxWriteFailures',{get(){throw Error('GETTER_EXECUTED')}})", /OWN_DATA_REQUIRED/]
]) test('refuses ' + name + ' before custody or closing', () => {
  const f = fixture(mutation);
  try {
    assert.throws(f.call, error);
    assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), false);
    for (const directory of f.dirs) assert.deepEqual(fs.readdirSync(directory), []);
  } finally { f.clean(); }
});

test('accepts the pinned default legacy mode without changing the environment', () => {
  const f = fixture('delete process.env.SUPPORT_MAX_OUTBOX_MODE');
  try {
    assert.equal(f.call().unresolvedHistoricalFailures, 4);
    assert.equal(vm.runInContext("Object.hasOwn(process.env,'SUPPORT_MAX_OUTBOX_MODE')", f.context), false);
  } finally { f.clean(); }
});

test('preserves existing attempt files and never retries an ambiguous operation', () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.dirs[1], 'containment-intent.json'), 'earlier', { mode: 0o600 });
    assert.throws(f.call, /EXISTING_ATTEMPT/);
    assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), false);
    assert.equal(fs.readFileSync(path.join(f.dirs[1], 'containment-intent.json'), 'utf8'), 'earlier');
  } finally { f.clean(); }
});

test('receipt failure preserves both snapshots and leaves the terminal fence closed', () => {
  const f = fixture('', view => {
    view.writeFileSync = (fd, body, ...rest) => {
      if (String(body).includes('CUP3CC_MAX_CONTAINED_V1')) throw Error('RECEIPT_IO_FAILURE');
      return fs.writeFileSync(fd, body, ...rest);
    };
  });
  try {
    assert.throws(f.call, /RECEIPT_IO_FAILURE/);
    assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), true);
    assert.equal(vm.runInContext('service.persistence.legacyMaxWriteFailures', f.context), 4);
    for (const directory of f.dirs) assert.ok(fs.statSync(path.join(directory, 'pre-containment-map.json')).size > 0);
    assert.throws(f.call, /ALREADY_CLOSING/);
  } finally { f.clean(); }
});

test('late MAX acceptance is rejected while a pre-fence continuation still blocks restart', async () => {
  const f = fixture(`
    let gapReceipt;
    Persistence.prototype.trackedLegacyMax=function(action){
      if(this.legacyMaxClosing)return Promise.reject(Error('CLOSING'));
      const p=Promise.resolve().then(action);this.legacyMaxWrites.add(p);
      void p.then(()=>{this.legacyMaxWrites.delete(p);gapReceipt=call()});return p;
    };
    expected.trackedLegacyMaxSha256=digest(Persistence.prototype.trackedLegacyMax);
  `);
  try {
    await vm.runInContext("service.acceptOutbox({id:'durable-before-fence',connector:'MAX_BOT',status:'PENDING'})", f.context);
    assert.equal(vm.runInContext('gapReceipt.activationAdmitted', f.context), false);
    assert.equal(vm.runInContext("service.outbox.get('durable-before-fence').status", f.context), 'PENDING');
    await assert.rejects(vm.runInContext("service.acceptOutbox({id:'late',connector:'MAX_BOT',status:'PENDING'})", f.context), /CLOSING/);
    assert.equal(vm.runInContext("service.outbox.has('late')", f.context), false);
  } finally { f.clean(); }
});
