import test from 'node:test';
import assert from 'node:assert/strict';
import { BSON, MongoClient } from 'mongodb';
import { createHash } from 'node:crypto';
import { compareCup83WebCustody } from '../scripts/lib/cup83-web-custody.mjs';
const sourceEpoch = '83b1c17bc4c5edaec65387b25b5695e48337c3cf';
const hash = b => createHash('sha256').update(b).digest('hex');
const bytes = v => Buffer.from(JSON.stringify(v) + '\n');
const counts = rows => Object.fromEntries(Object.entries(rows).map(([k,v]) => [k,v.length]));
function fixture() {
  const identity = { sourceEpoch, pid: 123, start: '1', nodeVersion: 'v22.13.1' };
  const rows = { commands: [['c', { id: 'c', dialogId: 'd', clientId: 'p', connector: 'LK_WEB_MESSENGER', status: 'PENDING', text: 'synthetic-private' }]],
    messages: [['m', { id: 'm', dialogId: 'd', clientId: 'p', connector: 'LK_WEB_MESSENGER', direction: 'OUTBOUND', senderRole: 'STAFF', kind: 'TEXT', meta: {} }]],
    serviceMessages: [['s', { id: 's', dialogId: 'd', clientId: 'p', connector: 'LK_WEB_MESSENGER', kind: 'SYSTEM', meta: {} }]],
    dialogs: [['d', { id: 'd', clientId: 'p', accessStationIds: ['a','b'] }]], clients: [['p', { id: 'p', phones: ['synthetic-private'] }]] };
  const capture = { schema: 'PHAB_CUP83_WEB_CUSTODY_V1', identity, rows, counts: counts(rows), undefinedPaths: [{commandId:'messages:m',path:['meta','absent']},{commandId:'serviceMessages:s',path:['meta','absent']}], durableCompletenessProven:false };
  const durable = structuredClone(rows); durable.messages[0][1].meta.absent = null; durable.serviceMessages[0][1].meta.absent = null;
  const inventory = { schema:'PHAB_CUP83_WEB_DURABLE_INVENTORY_V1',sourceEpoch,fingerprint:'a'.repeat(64),collectionsSha256:'b'.repeat(64),complete:true,ignoreUndefined:false,rows:durable,counts:counts(durable) };
  const f = { capture, inventory, extra: [], identity };
  f.pack = () => {
    const list=[f.inventory,...f.extra], raw=bytes(f.capture), inventories=list.map(bytes);
    return { inputs:{capture:raw,inventories}, expected:{captureSha256:hash(raw),identity:f.identity,ignoreUndefined:false,namespaces:list.map((v,i)=>({fingerprint:v.fingerprint,collectionsSha256:v.collectionsSha256,sha256:hash(inventories[i])}))} };
  };
  f.run = () => {const {inputs,expected}=f.pack();return compareCup83WebCustody(inputs,expected);};return f;
}
test('matches separate history domains without reporting delivery, drain or restart authority',()=>{
 const f=fixture(),result=f.run();assert.equal(result.status,'PINNED_WEB_CAPTURE_ROWS_MATCH');assert.equal(result.producerDrainProven,false);assert.equal(result.restartAuthorized,false);assert.deepEqual(result.counts,f.capture.counts);assert.equal(JSON.stringify(result).includes('synthetic-private'),false);assert.equal(f.capture.rows.messages[0][1].meta.absent,undefined);
});
test('undefined maps to BSON null only at attested sidecar paths',()=>{
 const f=fixture();delete f.inventory.rows.messages[0][1].meta.absent;assert.throws(f.run,/DURABLE_ROW_CONFLICT/);
 f.inventory.rows.messages[0][1].meta.absent=null;f.inventory.rows.dialogs[0][1].extra=null;assert.throws(f.run,/DURABLE_ROW_CONFLICT/);
});
test('same captured rows across required namespaces are accepted; conflicting copy is not hidden by timestamps',()=>{
 const f=fixture();const second=structuredClone(f.inventory);second.fingerprint='c'.repeat(64);f.extra.push(second);assert.equal(f.run().namespaceCount,2);
 second.rows.dialogs[0][1].updatedAt='2099-01-01T00:00:00.000Z';assert.throws(f.run,/DURABLE_ROW_CONFLICT/);
});
for(const kind of ['commands','messages','serviceMessages','dialogs','clients'])test('missing durable '+kind+' refuses',()=>{
 const f=fixture();f.inventory.rows[kind]=[];f.inventory.counts=counts(f.inventory.rows);assert.throws(f.run,/MISSING_CAPTURED_ROW/);
});
test('ACL array ordering and fields remain exact',()=>{
 const f=fixture();f.inventory.rows.dialogs[0][1].accessStationIds.reverse();assert.throws(f.run,/DURABLE_ROW_CONFLICT/);
});
test('incomplete namespace, schema, source and serialization settings refuse',()=>{
 for(const [field,value]of[['complete',false],['schema','other'],['sourceEpoch','other'],['ignoreUndefined',true]]){const f=fixture();f.inventory[field]=value;assert.throws(f.run,/INVENTORY_BINDING_OR_COMPLETENESS/);}
 const f=fixture(),p=f.pack();p.expected.ignoreUndefined=true;assert.throws(()=>compareCup83WebCustody(p.inputs,p.expected),/SOURCE_SERIALIZATION_CONTRACT/);
});
test('namespace omission, duplication, order or fingerprint drift refuses',()=>{
 const f=fixture();f.extra.push(structuredClone(f.inventory));assert.throws(f.run,/NAMESPACE_IDENTITY/);
 f.extra[0].fingerprint='c'.repeat(64);const p=f.pack();p.inputs.inventories.pop();assert.throws(()=>compareCup83WebCustody(p.inputs,p.expected),/NAMESPACE_SET/);
 const q=f.pack();q.inputs.inventories.reverse();assert.throws(()=>compareCup83WebCustody(q.inputs,q.expected),/INPUT_HASH_OR_BOUND/);
});
test('duplicate IDs, mismatched counts and Mongo _id are rejected',()=>{
 const f=fixture();f.inventory.rows.messages.push(f.inventory.rows.messages[0]);f.inventory.counts=counts(f.inventory.rows);assert.throws(f.run,/ROW_IDENTITY/);
 f.inventory.rows.messages.pop();assert.throws(f.run,/ROW_COUNT/);f.inventory.counts=counts(f.inventory.rows);f.inventory.rows.messages[0][1]._id='must be projected away';assert.throws(f.run,/ROW_IDENTITY/);
});
test('sidecar must reference its correct domain, an absent own field, without duplicates',()=>{
 const f=fixture();f.capture.undefinedPaths[1].commandId='messages:s';assert.throws(f.run,/SIDECAR_REFERENCE/);
 f.capture.undefinedPaths[1].commandId='serviceMessages:s';f.capture.undefinedPaths.push(f.capture.undefinedPaths[0]);assert.throws(f.run,/SIDECAR_DUPLICATE/);
 f.capture.undefinedPaths.pop();f.capture.rows.messages[0][1].meta.absent='not undefined';assert.throws(f.run,/SIDECAR_VALUE_PRESENT/);
});
test('capture reference and system domain validation reject malformed exports',()=>{
 const f=fixture();f.capture.rows.commands[0][1].clientId='missing';assert.throws(f.run,/CAPTURE_REFERENCE/);
 f.capture.rows.commands[0][1].clientId='p';f.capture.rows.serviceMessages[0][1].kind='TEXT';assert.throws(f.run,/CAPTURE_MESSAGE_DOMAIN/);
});
test('hash, duplicate JSON keys, noncanonical bytes and count bound fail closed',()=>{
 const f=fixture(),p=f.pack();p.expected.captureSha256='0'.repeat(64);assert.throws(()=>compareCup83WebCustody(p.inputs,p.expected),/INPUT_HASH_OR_BOUND/);
 for(const suffix of [' ', '\n']){const q=f.pack();q.inputs.capture=Buffer.concat([q.inputs.capture,Buffer.from(suffix)]);q.expected.captureSha256=hash(q.inputs.capture);assert.throws(()=>compareCup83WebCustody(q.inputs,q.expected),/INPUT_SERIALIZATION/);}
 const q=f.pack();q.inputs.capture=Buffer.from(q.inputs.capture.toString().replace('"schema":','"schema":"duplicate","schema":'));q.expected.captureSha256=hash(q.inputs.capture);assert.throws(()=>compareCup83WebCustody(q.inputs,q.expected),/INPUT_SERIALIZATION/);
});
test('deep nested durable fields are bounded before comparison',()=>{
 const f=fixture();let v={};f.inventory.rows.clients[0][1].deep=v;for(let i=0;i<40;i++)v=v.next={};assert.throws(f.run,/ROW_DEPTH/);
});

test('installed Mongo BSON serializer matches the attested undefined-to-null rule', () => {
 const f = fixture(); const original = structuredClone(f.capture.rows.messages[0][1]);
 original.meta.absent = undefined;
 const client = new MongoClient('mongodb://127.0.0.1:1'); // Options only; never connect.
 const options = client.db('synthetic').collection('messages').bsonOptions;
 assert.equal(options.ignoreUndefined, false);
 const roundTrip = BSON.deserialize(BSON.serialize(original, options));
 assert.equal(Object.hasOwn(roundTrip.meta, 'absent'), true); assert.equal(roundTrip.meta.absent, null);
 f.inventory.rows.messages[0][1] = roundTrip; assert.equal(f.run().status, 'PINNED_WEB_CAPTURE_ROWS_MATCH');
});
test('sidecar prototype-looking keys do not mutate prototypes', () => {
 const f = fixture(); f.capture.undefinedPaths.push({ commandId:'clients:p', path:['__proto__'] });
 Object.defineProperty(f.inventory.rows.clients[0][1], '__proto__', { value:null, enumerable:true });
 assert.equal(f.run().status, 'PINNED_WEB_CAPTURE_ROWS_MATCH'); assert.equal(Object.prototype.polluted, undefined);
});
