import * as assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express = require('express');
import { createHistoryProtection, canonicalIp, HistoryProtectionOptions } from '../src/traffic/history-protection';
import { readHistoryProtectionReport } from '../src/traffic/history-protection-report';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const route = '/lk/tournaments/americano/history?tournamentId=synthetic';
async function fixture(options: HistoryProtectionOptions = {}) {
  const guard = createHistoryProtection({ trustLoopbackProxy: true, ...options });
  const state = { reads: 0, writes: 0, version: 1, delay: 0, writeDelay: 0, controls: '', status: 200, private: false, vary: false, noStore: false, compressed: false, large: false, hang: false, endCallback: false };
  const app = express();
  app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', 'https://example.test'); next(); });
  app.use((req, _res, next) => { (req as any).verifiedFixtureSubject = req.headers['x-fixture-subject']; next(); });
  app.use(guard.middleware);
  app.use(async (req, res) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { state.writes += 1; state.version += 1; if (state.writeDelay) await pause(state.writeDelay); res.status(201).send('write unchanged'); return; }
    state.reads += 1;
    const body = JSON.stringify({ version: state.version, visit: state.reads, payload: state.large ? 'x'.repeat(1024) : 'synthetic' });
    if (state.hang) return;
    if (state.delay) await pause(state.delay);
    res.status(state.status).set('Content-Type', 'application/json');
    if (state.private) res.set('Set-Cookie', 'fixture=private');
    if (state.vary) res.set('Vary', 'Origin');
    if (state.noStore) res.set('Cache-Control', 'private, no-store');
    if (state.controls) res.set('Cache-Control', state.controls);
    if (state.compressed) res.set('Content-Encoding', 'fixture');
    if (state.endCallback) { res.write(body); res.end(() => undefined); } else res.end(body);
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  function request(path = route, headers: Record<string, string | undefined> = {}, method = 'GET') {
    return new Promise<{status:number;body:string;headers:any}>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { 'X-Real-IP': '203.0.113.10', ...headers } }, res => {
        const chunks: Buffer[] = []; res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers }));
      });
      req.on('error', reject); req.end();
    });
  }
  async function close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  function abort(afterMs = 20) {
    return new Promise<void>(resolve => {
      const req = httpRequest({ host:'127.0.0.1',port,path:route,headers:{'X-Real-IP':'203.0.113.10'} });
      req.on('error',()=>resolve());req.on('response',res=>res.resume());req.end();
      setTimeout(()=>req.destroy(new Error('synthetic disconnect')),afterMs);
    });
  }
  return { guard, state, request, abort, close };
}

async function main() {
  assert.equal(canonicalIp('::ffff:188.127.235.140'), '188.127.235.140');
  assert.equal(canonicalIp('2001:0db8::1'), '2001:db8::1');
  assert.equal(canonicalIp('1.2.3.4, 188.127.235.140'), undefined);
  assert.throws(() => createHistoryProtection({ cacheTtlMs: 6000 }));
  assert.throws(() => createHistoryProtection({ enableCache: true }));
  for (const mode of ['off', 'shadow'] as const) {
    const f = await fixture({ mode, burst: 1 });
    try {
      for (let i=0;i<5;i++) assert.equal((await f.request()).status, 200);
      assert.equal(f.state.reads, 5); assert.equal(f.guard.snapshot().counters.limited, 0);
      assert.equal(f.guard.snapshot().counters.wouldLimit, mode === 'shadow' ? 4 : 0);
    } finally { await f.close(); }
  }
  let clock = Date.now();
  const f = await fixture({ mode: 'enforce', burst: 2, ratePerMinute: 120, now: () => clock });
  try {
    assert.equal((await f.request()).status, 200); assert.equal((await f.request()).status, 200);
    const blocked = await f.request(); assert.equal(blocked.status, 429); assert.equal(f.state.reads, 2);
    assert.equal(blocked.headers['retry-after'], '1'); assert.equal(blocked.headers['access-control-allow-origin'], 'https://example.test');
    for (const headers of [{Authorization:'Bearer fake'}, {Cookie:'session=fake'}, {'X-Forwarded-For':'188.127.235.140'}, {'X-User-Id':'fake'}]) {
      assert.equal((await f.request(route, headers)).status, 429);
    }
    for (const path of [route+'&extra=1', route+'&tournamentId=other', '/lk/tournaments/americano/history?tournamentId[$ne]=x', '/lk/tournaments/americano/history/', '/lk/tournaments/americano/h%69story?tournamentId=synthetic']) {
      assert.equal((await f.request(path)).status, 429, path);
    }
    assert.equal((await f.request(route, {}, 'HEAD')).status, 429);
    assert.equal((await f.request(route, {}, 'OPTIONS')).status, 200);
    assert.equal((await f.request('/lk/games/synthetic/split/join', {}, 'POST')).status, 201);
    assert.equal((await f.request('/lk/tournaments/americano/history/export')).status, 200);
    for (let i=0;i<6;i++) assert.equal((await f.request(route, {'X-Real-IP':'::ffff:188.127.235.140'})).status, 200);
    clock += 500; assert.equal((await f.request()).status, 200);
    assert.equal((await f.request(route, {'X-Real-IP':'2001:db8::1'})).status, 200);
    assert.equal((await f.request(route, {'X-Real-IP':'invalid'})).status, 200);
    assert.equal(f.guard.snapshot().counters.identityUnavailable, 1);
  } finally { await f.close(); }
  const account = await fixture({ mode:'enforce', burst:1, verifiedSubject:req => (req as any).verifiedFixtureSubject });
  try {
    assert.equal((await account.request(route, {'X-Fixture-Subject':'verified-test-account','X-Real-IP':'203.0.113.20'})).status,200);
    assert.equal((await account.request(route, {'X-Fixture-Subject':'verified-test-account','X-Real-IP':'203.0.113.21'})).status,429);
    assert.ok(!JSON.stringify(account.guard.snapshot()).includes('verified-test-account'));
  } finally { await account.close(); }
  const direct = await fixture({ mode:'enforce', burst:1, trustLoopbackProxy:false });
  try {
    assert.equal((await direct.request()).status,200);
    assert.equal((await direct.request(route, {'X-Real-IP':'188.127.235.140'})).status,429);
  } finally { await direct.close(); }

  const cache = await fixture({ mode:'enforce', burst:300, enableCache:true, publicHistoryConfirmed:true, cacheTtlMs:1000, now:()=>clock, maxEntries:2 });
  try {
    cache.state.delay=25;
    const group=await Promise.all(Array.from({length:5},()=>cache.request()));
    assert.equal(cache.state.reads,1); assert.equal(new Set(group.map(x=>x.body)).size,1);
    assert.equal(cache.guard.snapshot().counters.coalesced,4);
    assert.equal((await cache.request()).body,group[0].body);assert.equal(cache.state.reads,1);
    clock+=1001;await cache.request();assert.equal(cache.state.reads,2);
    await cache.request('/lk/tournaments/americano/results',{},'POST');await cache.request();assert.equal(cache.state.reads,3);
    cache.guard.invalidate();await cache.request();assert.equal(cache.state.reads,4);
    for (const headers of [{Authorization:'Bearer fake'},{Cookie:'private=synthetic'},{'X-Client-Id':'synthetic'},{'If-None-Match':'fixture'},{Range:'bytes=0-5'},{'Cache-Control':'no-cache'}]) {
      const n: number=cache.state.reads;await cache.request(route,headers);await cache.request(route,headers);assert.equal(cache.state.reads,n+2);
    }
    for (const path of [route+'&phone=synthetic',route+'&tournamentId=other',route.replace('synthetic','bad%20id'),route.replace('history','h%69story'),route.replace('history?','history/?'),route.replace('history','x/../history'),route.replace('history','x/%2e%2e/history'),route+'#fragment']) {
      const n: number=cache.state.reads;await cache.request(path);await cache.request(path);assert.equal(cache.state.reads,n+2);
    }
    const n: number=cache.state.reads;await cache.request(route,{'Origin':'https://second.example.test'});assert.equal(cache.state.reads,n+1);
    await cache.request(route.replace('synthetic','second'));await cache.request(route.replace('synthetic','third'));
    assert.equal(cache.guard.snapshot().state.cacheEntries,2);
    cache.guard.invalidate();cache.state.endCallback=true;await cache.request();await cache.request();assert.equal(cache.guard.snapshot().counters.cacheHits>=2,true);
    cache.state.endCallback=false;cache.guard.invalidate();cache.state.delay=80;
    const old=cache.request();await pause(10);const follower=cache.request();await pause(10);
    await cache.request('/lk/tournaments/americano/results',{},'POST');
    assert.equal(JSON.parse((await old).body).version,2);
    assert.equal(JSON.parse((await follower).body).version,3);
    assert.equal(cache.guard.snapshot().state.flights,0);
    cache.state.delay=0;cache.state.writeDelay=60;
    const writing=cache.request('/lk/tournaments/americano/results',{},'POST');await pause(15);
    assert.equal(cache.guard.snapshot().state.writers,1);
    const before: number=cache.state.reads;await cache.request();await cache.request();assert.equal(cache.state.reads,before+2);
    assert.equal(cache.guard.snapshot().state.cacheEntries,0);await writing;cache.state.writeDelay=0;
    cache.state.controls='public, max-age="0"';await cache.request();await cache.request();assert.equal(cache.guard.snapshot().state.cacheEntries,0);
    cache.state.controls='';
    for (const kind of ['private','vary','noStore','compressed','large'] as const) {
      cache.guard.invalidate();cache.state[kind]=true;const n: number=cache.state.reads;
      await Promise.all([cache.request(),cache.request()]);
      if (kind!=='large') assert.equal(cache.state.reads,n+2,kind);
      cache.state[kind]=false;
    }
    cache.guard.invalidate();cache.state.status=503;const e=await Promise.all([cache.request(),cache.request()]);
    assert.ok(e.every(x=>x.status===503));assert.equal(cache.guard.snapshot().state.cacheEntries,0);
    assert.ok(!JSON.stringify(cache.guard.snapshot()).includes('private=synthetic'));
  } finally { await cache.close(); }
  const small=await fixture({mode:'enforce',burst:300,enableCache:true,publicHistoryConfirmed:true,maxResponseBytes:10});
  try {await small.request();await small.request();assert.equal(small.state.reads,2);assert.equal(small.guard.snapshot().state.cacheEntries,0);}finally{await small.close();}
  const overflow=await fixture({mode:'enforce',burst:1,maxSources:2,now:()=>clock});
  try {
    await overflow.request(route,{'X-Real-IP':'203.0.113.1'});await overflow.request(route,{'X-Real-IP':'203.0.113.2'});
    assert.equal((await overflow.request(route,{'X-Real-IP':'203.0.113.3'})).status,200);
    assert.equal((await overflow.request(route,{'X-Real-IP':'203.0.113.4'})).status,429);
    assert.equal((await overflow.request(route,{'X-Real-IP':'203.0.113.5'})).status,429);
    assert.equal((await overflow.request(route,{'X-Real-IP':'188.127.235.140'})).status,200);
  } finally {await overflow.close();}
  const timeout=await fixture({mode:'enforce',burst:300,enableCache:true,publicHistoryConfirmed:true,waitMs:10,captureTimeoutMs:20});
  try {
    timeout.state.delay=70;
    const responses=await Promise.all([timeout.request(),timeout.request()]);assert.ok(responses.every(x=>x.status===200));
    assert.equal(timeout.guard.snapshot().state.flights,0);assert.equal(timeout.guard.snapshot().state.cacheEntries,0);
    assert.ok(timeout.guard.snapshot().counters.captureTimeouts>=1);
    timeout.state.hang=true;await Promise.all(Array.from({length:10},()=>timeout.abort()));await pause(30);
    assert.equal(timeout.guard.snapshot().counters.aborted,10);
    assert.ok(timeout.guard.snapshot().candidates.some(x=>x.reasons.includes('aborted_requests')));
    assert.equal(timeout.guard.snapshot().candidates[0].errors,0);
    assert.equal(timeout.guard.snapshot().state.flights,0);
  } finally {await timeout.close();}

  const detection=await fixture({mode:'shadow',burst:1,distinctThreshold:2,spikePerMinute:3,maxSources:2,now:()=>clock});
  const dir=await fs.mkdtemp(join(tmpdir(),'history-protection-'));
  try {
    for (const id of ['viva:one','viva:two','viva:three']) await detection.request(route.replace('synthetic',id));
    const report=detection.guard.snapshot();assert.equal(report.candidates[0].distinctTournaments,3);
    assert.deepEqual(report.candidates[0].reasons,['broad_scan','request_spike']);
    await detection.request(route,{'X-Real-IP':'203.0.113.11'});await detection.request(route,{'X-Real-IP':'203.0.113.12'});
    assert.equal(detection.guard.snapshot().state.sources,2);assert.equal(detection.guard.snapshot().counters.capacityFallback,1);
    const file=join(dir,'status.json');const stop=detection.guard.startReporting(file,1000);await pause(50);stop();
    const read=await readHistoryProtectionReport(file,clock);assert.equal(read.state,'ok');
    assert.equal((await readHistoryProtectionReport(file,clock+90001)).state,'stale');
    assert.ok(!JSON.stringify(read).includes('tournamentId'));assert.equal((await readHistoryProtectionReport()).state,'not_configured');
    await fs.writeFile(file,'broken');assert.equal((await readHistoryProtectionReport(file)).state,'unavailable');
    await fs.writeFile(file,JSON.stringify({...report,checkedAt:new Date(clock+100000).toISOString()}));assert.equal((await readHistoryProtectionReport(file,clock)).state,'invalid');
    clock+=660001;assert.equal(detection.guard.snapshot().candidates.length,0);
    assert.equal(detection.guard.snapshot().state.sources,0);
  } finally {await detection.close();await fs.rm(dir,{recursive:true,force:true});}
  console.log('History protection: real HTTP pass-through, rate/IP/account, spoofing, allowlist, public-only cache/coalescing, invalidation races, privacy, bounds, signals and stale telemetry PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
