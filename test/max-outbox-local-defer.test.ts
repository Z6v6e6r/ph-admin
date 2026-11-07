process.env.SUPPORT_MAX_OUTBOX_MODE = 'receipt-v1';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { maxFailure } from '../src/support/max-outbox-policy';
import { MaxOutboxStore, provisionMaxQueue } from './fixtures/max-outbox-fixture';
import { SupportConnectorRoute as Route, SupportOutboxStatus as Status } from '../src/support/support.types';
async function exercise(collection: any, read: () => Promise<any>, connector: Route, now: number) {
  const seeded = await read(), store = new MaxOutboxStore(collection);
  const receipt = { leaseToken: seeded.leaseToken, failure: { status: null, code: 'local_deferred' } };
  const updated = await store.receipt(seeded.id, 'fail', receipt, now);
  assert.equal(updated.status, Status.PENDING); assert.equal(updated.attempts, 4);
  assert.equal(updated.localDeferrals, 1); assert.equal(updated.lastLocalDeferral?.category, 'LOCAL_DEFERRED');
  assert.equal(updated.lastLocalDeferral?.stage, 'admission'); assert.equal(updated.lastProviderFailure, undefined);
  assert.equal(updated.terminalReason, undefined); assert.equal(updated.leaseToken, undefined);
  assert.ok(Date.parse(updated.nextAttemptAt!) >= now + 5000 && Date.parse(updated.nextAttemptAt!) <= now + 6000);
  const repeated = await store.receipt(seeded.id, 'fail', receipt, now + 1);
  assert.equal(repeated.attempts, 4); assert.equal(repeated.localDeferrals, 1);
  assert.deepEqual(await read(), updated, 'Repeated receipt cannot decrement attempts or increment deferrals twice');
  assert.equal(updated.connector, connector);
}
async function main() {
  const now = Date.now();
  assert.equal(maxFailure({status:null,code:'local_deferred'},now).category,'LOCAL_DEFERRED');
  for (const status of [undefined, 400, 429, 503]) assert.notEqual(maxFailure({status,code:'local_deferred'},now).category,'LOCAL_DEFERRED');
  assert.equal(maxFailure({status:503,code:'unclassified'},now).category,'DELIVERY_UNKNOWN');
  const seed = (connector: Route) => ({ id:randomUUID(),connector,dialogId:'synthetic',clientId:'synthetic',text:'synthetic',createdAt:new Date(now).toISOString(),
    status:Status.LEASED,attempts:5,queueSequence:1,leaseToken:randomUUID(),leasedUntil:new Date(now+60000).toISOString() });
  for (const connector of [Route.MAX_BOT,Route.MAX_ACADEMY_BOT]) {
    let row: any = seed(connector), writes = 0;
    const collection = { findOne:async()=>structuredClone(row),findOneAndUpdate:async(filter:any,update:any,options:any)=>{
      assert.ok(options.session);assert.equal(filter.leaseToken,row.leaseToken);assert.equal(filter.attempts,5);
      assert.equal(filter.status,Status.LEASED);assert.deepEqual(filter.leasedUntil,{$gt:new Date(now).toISOString()});writes++;
      Object.assign(row,update.$set);for(const key of Object.keys(update.$unset))delete row[key];return structuredClone(row);
    }};
    await exercise(collection,async()=>structuredClone(row),connector,now); assert.equal(writes,1);
    row={...seed(connector),leasedUntil:new Date(now-1).toISOString()};
    const expired = new MaxOutboxStore({findOne:async()=>row,findOneAndUpdate:async()=>null} as any);
    await assert.rejects(()=>expired.receipt(row.id,'fail',{leaseToken:row.leaseToken,failure:{status:null,code:'local_deferred'}},now),(error:any)=>error.getStatus()===409);
  }
  console.log('MAX local deferral: fenced CAS, no provider failure fabrication, delivery-attempt preservation, idempotency and stale lease PASS');
  const uri=process.argv[2];if(!uri)return;
  const target=new URL(uri);assert.equal(target.protocol,'mongodb:');assert.ok(['127.0.0.1','localhost'].includes(target.hostname),'Owned loopback Mongo required');
  const client=new MongoClient(uri,{serverSelectionTimeoutMS:5000});await client.connect();const db=client.db('cup_max_defer_'+randomUUID().replace(/-/g,''));
  try{
    const collection=db.collection('outbox');await provisionMaxQueue(db);await collection.createIndex({id:1},{unique:true});
    for(const connector of [Route.MAX_BOT,Route.MAX_ACADEMY_BOT]){
      const row=seed(connector);await collection.insertOne(row);await exercise(collection,()=>collection.findOne({id:row.id}),connector,now);
    }
    console.log('Physical Mongo local deferral: both MAX connectors, majority receipt, repeated receipt exactly once PASS');
  }finally{await db.dropDatabase();await client.close();}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
