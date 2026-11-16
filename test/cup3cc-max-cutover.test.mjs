import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { captureAndFenceCup3ccMax } from '../scripts/lib/cup3cc-max-cutover.mjs';

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
      constructor(){this.legacyMaxClosing=false;this.legacyMaxWrites=new Set();this.legacyMaxWriteFailures=0;}
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
    const expected={sourceCommit:'3cc4708811fc3d734d1c6673fd38f3b928589154',pid:process.pid,nodeVersion:process.version,timeOrigin:'123',startTicks:ticks,
      acceptOutboxSha256:digest(Support.prototype.acceptOutbox),trackedLegacyMaxSha256:digest(Persistence.prototype.trackedLegacyMax),persistOutboxCommandSha256:digest(Persistence.prototype.persistOutboxCommand)};
    const operation=(${captureAndFenceCup3ccMax.toString()});
    ${mutate}
    const call=()=>operation.call([service],expected,Support.prototype,Persistence.prototype,directories);
  `;
  vm.runInContext(setup, context);
  return { root, dirs, context, call: () => vm.runInContext('call()', context), clean: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('preserves both custody copies and held/history rows before terminal fence', () => {
  const f = fixture();
  try {
    const result = f.call(); assert.equal(result.maxAcceptedQueueOnly, true); assert.equal(result.httpDrainProven, false);
    assert.equal(result.activationAdmitted, false); assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), true);
    for (const name of ['pre-fence-map.json', 'fence-intent.json', 'fence-receipt.json']) assert.deepEqual(fs.readFileSync(path.join(f.dirs[0], name)), fs.readFileSync(path.join(f.dirs[1], name)));
    const copy = JSON.parse(fs.readFileSync(path.join(f.dirs[0], 'pre-fence-map.json')));
    assert.equal(copy.rows.outbox.length, 2); assert.equal(copy.rows.messages[0][1][0].body, 'synthetic');
    assert.deepEqual(copy.undefinedPaths, [['messages', 'd', '0', 'missing']]);
    assert.throws(f.call, /ALREADY_CLOSING/);
  } finally { f.clean(); }
});

for (const [name, mutation, error] of [
  ['open command', "service.outbox.set('open',{connector:'MAX_ACADEMY_BOT',status:'LEASED'})", /MAX_OPEN_COMMAND/],
  ['tracked write', 'service.persistence.legacyMaxWrites.add(Promise.resolve())', /MAX_WRITES_NOT_DRAINED/],
  ['write failure', 'service.persistence.legacyMaxWriteFailures=1', /MAX_WRITES_NOT_DRAINED/],
  ['hydration', 'service.isPersistenceSyncInProgress=true', /HYDRATION_ACTIVE/],
  ['producer timer', 'service.noReplyQuickReplyTimer={}', /PRODUCER_TIMER_ACTIVE/],
  ['PID drift', 'expected.pid++', /PROCESS_IDENTITY/],
  ['start drift', "expected.startTicks='wrong'", /PROCESS_START/],
  ['source function drift', "expected.acceptOutboxSha256='0'.repeat(64)", /LIVE_FUNCTION_IDENTITY/],
  ['own acceptance method', 'service.acceptOutbox=()=>undefined', /SHADOWED_ADMISSION_METHOD/],
  ['own tracked method', 'service.persistence.trackedLegacyMax=()=>undefined', /SHADOWED_ADMISSION_METHOD/],
  ['own persistence method', 'service.persistence.persistOutboxCommand=()=>undefined', /SHADOWED_ADMISSION_METHOD/],
  ['unsafe getter', "Object.defineProperty(service.messages.get('d')[0],'secret',{enumerable:true,get(){throw Error('GETTER_EXECUTED')}})", /OWN_DATA_REQUIRED/],
  ['cyclic history', "service.messages.get('d')[0].loop=service.messages.get('d')[0]", /SNAPSHOT_VALUE/]
]) test('refuses ' + name + ' without changing admission or writing a snapshot', () => {
  const f = fixture(mutation);
  try { assert.throws(f.call, error); assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), false); assert.deepEqual(fs.readdirSync(f.dirs[0]), []); }
  finally { f.clean(); }
});

test('preserves an uncertain earlier intent without replay', () => {
  const f = fixture();
  try { fs.writeFileSync(path.join(f.dirs[1], 'fence-intent.json'), 'prior', { mode: 0o600 }); assert.throws(f.call, /EXISTING_ATTEMPT/); assert.equal(fs.readFileSync(path.join(f.dirs[1], 'fence-intent.json'), 'utf8'), 'prior'); assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), false); }
  finally { f.clean(); }
});

test('late producer rejected before durable acceptance; pre-fence microtask gap remains a required external gate', async () => {
  const f = fixture();
  try {
    f.call();
    await assert.rejects(vm.runInContext("service.acceptOutbox({id:'late',connector:'MAX_BOT',status:'PENDING'})", f.context), /CLOSING/);
    assert.equal(vm.runInContext("service.outbox.has('late')", f.context), false);
    assert.equal(vm.runInContext('service.persistence.legacyMaxWrites.size', f.context), 0);
  } finally { f.clean(); }
});

test('receipt write failure after closing preserves custody and leaves admission closed', () => {
  const f = fixture('', view => {
    view.writeFileSync = (fd, body, ...rest) => {
      if (String(body).includes('CUP3CC_MAX_QUEUE_FENCED_V1')) throw Error('RECEIPT_IO_FAILURE');
      return fs.writeFileSync(fd, body, ...rest);
    };
  });
  try {
    assert.throws(f.call, /RECEIPT_IO_FAILURE/);
    assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), true);
    for (const directory of f.dirs) assert.ok(fs.statSync(path.join(directory, 'pre-fence-map.json')).size > 0);
    assert.throws(f.call, /ALREADY_CLOSING/);
  } finally { f.clean(); }
});

test('shows why a tracked cleanup/accept continuation gap must block activation in the postcheck', async () => {
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
    await vm.runInContext("service.acceptOutbox({id:'already-durable',connector:'MAX_BOT',status:'PENDING'})", f.context);
    assert.equal(vm.runInContext('gapReceipt.activationAdmitted', f.context), false);
    assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), true);
    assert.equal(vm.runInContext("service.outbox.get('already-durable').status", f.context), 'PENDING');
    // The external post-fence DB/Map gate sees this open row and refuses stop.
  } finally { f.clean(); }
});

// Exact3cc defaults an absent env mode to legacy. Never write to the live env.
test('accepts the verified unset default legacy mode without changing environment', () => {
  const f = fixture('delete process.env.SUPPORT_MAX_OUTBOX_MODE');
  try {
    assert.equal(f.call().terminalForOldProcess, true);
    assert.equal(vm.runInContext("Object.hasOwn(process.env, 'SUPPORT_MAX_OUTBOX_MODE')", f.context), false);
  } finally { f.clean(); }
});
for (const value of ['', ' legacy ', 'receipt-v1', 'unknown']) {
  test(`refuses an unverified configured mode ${JSON.stringify(value)} before custody writes`, () => {
    const f = fixture(`process.env.SUPPORT_MAX_OUTBOX_MODE = ${JSON.stringify(value)}`);
    try {
      assert.throws(f.call, /RUNTIME_MODE/);
      assert.equal(vm.runInContext('service.persistence.legacyMaxClosing', f.context), false);
      for (const dir of f.dirs) assert.deepEqual(fs.readdirSync(dir), []);
    } finally { f.clean(); }
  });
}
