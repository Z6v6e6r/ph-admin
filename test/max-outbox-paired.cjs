'use strict';
process.env.SUPPORT_MAX_OUTBOX_MODE='receipt-v1';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{randomUUID}=require('node:crypto');
const P=path.resolve(__dirname,'..');
const L=process.env.LK_MAX_ADAPTER_SOURCE;
const N=process.env.NODE_RED_TEST_PACKAGE;
assert.ok(L&&path.isAbsolute(L)&&N&&path.isAbsolute(N),'Explicit isolated adapter/runtime paths required');
const reqP=n=>require(P+'/node_modules/'+n);
reqP('reflect-metadata');
const {MongoClient}=reqP('mongodb'),{NestFactory}=reqP('@nestjs/core'),{Module}=reqP('@nestjs/common');
const {SupportController}=require(P+'/dist/support/support.controller'),{SupportService}=require(P+'/dist/support/support.service'),{SupportPersistenceService}=require(P+'/dist/support/support-persistence.service');
const RED=require(N);
const {MaxOutboxStore,MAX_QUEUE_CONTROL_ID,maxQueueControlName}=require(P+'/dist/support/max-outbox-store');
const nativeFetch=globalThis.fetch;
let app,client,db,server,redStarted=false,providerCalls=0,legacyCalls=0,scenario='accepted',activeConnector='MAX_BOT',lateResolve,lateStarted=false;
const cases=[],warnings=[];
const root=fs.mkdtempSync(require('node:os').tmpdir()+'/max-queue-paired-');fs.chmodSync(root,0o700);fs.mkdirSync(root+'/node_modules',{recursive:true});
fs.cpSync(L+'/node-red/max-outbox-adapter',root+'/node_modules/node-red-contrib-padlhub-max-outbox',{recursive:true});
fs.writeFileSync(root+'/package.json',JSON.stringify({name:'synthetic-paired',private:true,dependencies:{'node-red-contrib-padlhub-max-outbox':'1.0.0'}}));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<200;i++){const x=await fn();if(x)return x;await pause(30)}throw Error('Timed out: '+label)}
const record=(name,details={})=>cases.push({name,result:'PASS',...details});
(async()=>{
const uri=process.argv[2],parsed=new URL(uri);assert.equal(parsed.protocol,'mongodb:');assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.username+parsed.password,'');
client=new MongoClient(uri,{serverSelectionTimeoutMS:8000});await client.connect();
db=client.db('max_retry_test_'+randomUUID().replaceAll('-',''));const coll=db.collection('outbox');await coll.createIndex({id:1},{unique:true});
await db.collection(maxQueueControlName('outbox')).insertOne({_id:MAX_QUEUE_CONTROL_ID,schema:1,enabled:true,sequence:0},{writeConcern:{w:'majority'}});
const queue=new MaxOutboxStore(coll,undefined,undefined,undefined,client);
const config={key:'max',collections:{outbox:'outbox'}};
const persistence=Object.create(SupportPersistenceService.prototype);persistence.backendConfigs=[config];persistence.backendStates=new Map([['max',{config,db,client}]]);
const service=new SupportService(persistence,{},{});
// No full application bootstrap, timers, secrets or unrelated integrations in this harness.
service.onModuleInit=()=>{};service.onApplicationBootstrap=()=>{};
process.env.SUPPORT_INTEGRATION_TOKEN='synthetic-integration-token';
class PairModule{};Module({controllers:[SupportController],providers:[{provide:SupportService,useValue:service}]})(PairModule);
app=await NestFactory.create(PairModule,{logger:false});app.setGlobalPrefix('api');await app.listen(0,'127.0.0.1');const base=await app.getUrl();process.env.SUPPORT_API_BASE_URL=base+'/api';
const api=async(route,body,token='synthetic-integration-token')=>{
 const r=await nativeFetch(base+'/api/support/outbox/'+route,{method:body===undefined?'GET':'POST',headers:{'x-integration-token':token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});let data;try{data=await r.json()}catch{};return{status:r.status,data};
};
globalThis.fetch=async(url,options)=>{
 const u=new URL(url);if(u.hostname!=='platform-api2.max.ru')throw Error('Unexpected transport blocked');
 assert.equal(u.pathname,'/messages');assert.equal(options.headers.Authorization,'synthetic-bot-token-'+pairs.find(p=>p[3]===activeConnector)[6]);assert.equal(options.method,'POST');providerCalls++;
 if(scenario==='network')throw Error('synthetic transport failure');
 if(scenario==='late'){lateStarted=true;return new Promise(resolve=>lateResolve=()=>resolve(new Response(JSON.stringify({message:{body:{mid:'synthetic-late'}}}),{status:200})))}
 if(scenario==='receipt-loss')persistence.backendStates.get('max').db=undefined;
 if(scenario==='403')return new Response(JSON.stringify({code:'bot.blocked',message:'synthetic-private-description'}),{status:403});
 if(scenario==='429')return new Response(JSON.stringify({code:'unclassified'}),{status:429,headers:{'retry-after':'1'}});
 return new Response(JSON.stringify({message:{body:{mid:'synthetic-mid'}}}),{status:200});
};
server=http.createServer();RED.init(server,{userDir:root,flowFile:'synthetic.json',httpAdminRoot:false,disableEditor:true,credentialSecret:'synthetic-key',functionExternalModules:false,externalModules:{autoInstall:false},logging:{console:{level:'off'},capture:{level:'warn',handler:()=>msg=>{if(typeof msg.msg==='string')warnings.push({unconfirmed:msg.msg.includes('MAX_OUTBOX_RECEIPT_UNCONFIRMED'),outputFailure:msg.msg.includes('MAX_OUTBOX_RECEIPT_OUTPUT_FAILED')})}}}});await RED.start();redStarted=true;
RED.nodes.registerType('maxbot-config',function(c){RED.nodes.createNode(this,c);this.token='synthetic-bot-token-'+c.id});
RED.nodes.registerType('maxbot-send',function(c){RED.nodes.createNode(this,c);this.on('input',()=>legacyCalls++)});
const {preparePatch}=await import('file://'+L+'/scripts/prepare_max_outbox_receipts.mjs');
const source=n=>fs.readFileSync(L+'/scripts/nodered_max_nodes/'+n,'utf8');
const before=n=>fs.readFileSync(L+'/scripts/tests/fixtures/max-outbox/'+n,'utf8');
let flows=[];
const pairs=[['47c460de0db646e6','f64e5818bc8d7aa6','41be3d2c95b57295','MAX_ACADEMY_BOT','academy','99db28109ee6a1f7','55b05444842e7b84'],['0006d5707259bc5b','466e8a3ac76c2fab','2e547e998eee631f','MAX_BOT','main','913584cf84dbb460','a5d5eca27e9e56da']];
for(const[d,s,p,connector,suffix,tab,bot]of pairs){flows.push({id:tab,type:'tab',label:'Synthetic MAX '+suffix},{id:bot,type:'maxbot-config'});const h='pull_http_'+suffix,r='pull_response_'+suffix,split='split_'+suffix;flows.push({id:d,type:'function',z:tab,func:before('dispatch-before.function.txt'),outputs:2,wires:[[s],[]]},{id:s,type:'maxbot-send',z:tab,bot,x:0,y:0,wires:[[]]},{id:p,type:'function',z:tab,func:before('pull-before.function.txt').replace('connector=MAX_BOT','connector='+connector),outputs:1,wires:[[h]]},{id:h,type:'http request',z:tab,method:'use',ret:'obj',paytoqs:'ignore',url:'',headers:[],wires:[[r]]},{id:r,type:'function',z:tab,func:source('fn_max_outbox_pull_response.js'),outputs:2,wires:[[split],[]]},{id:split,type:'split',z:tab,splt:'\\n',spltType:'str',arraySplt:1,arraySpltType:'len',stream:false,addname:'',wires:[[d]]});}
const patch=preparePatch(flows),pm=new Map(patch.map(n=>[n.id,n]));flows=flows.map(n=>pm.get(n.id)||n).concat(patch.filter(n=>!flows.some(o=>o.id===n.id)));await RED.nodes.setFlows(flows,'full');await until(()=>RED.nodes.getNode(pairs[1][2]),'both connector graph start');
assert.ok(RED.nodes.getType('max-outbox-send'));record('actual Node-RED4.0.9 loads correct bot-bound constructor-generated connector chains',{candidateNodes:patch.length});
const seed=async(id,connector='MAX_BOT',extra={})=>{activeConnector=connector;await coll.deleteMany({});await queue.enqueue({id,connector,dialogId:'synthetic-dialog',clientId:'synthetic-client',text:'synthetic text',targetExternalChatId:'synthetic-chat',createdAt:new Date().toISOString(),status:'PENDING',attempts:0,...extra})};
const pull=connector=>RED.nodes.getNode(pairs.find(p=>p[3]===connector)[2]).receive({});
const stored=()=>coll.findOne({});
await seed('auth-denial');const beforeClaim=await stored();assert.equal((await api('pull?connector=MAX_BOT&receiptProtocol=max-lease-v1',undefined,'wrong')).status,403);assert.equal((await api('pull?connector=MAX_BOT')).status,409);assert.deepEqual(await stored(),beforeClaim);record('HTTP authorization and legacy protocol deny before any Mongo claim');
for(const connector of ['MAX_BOT','MAX_ACADEMY_BOT']){
 scenario='403';await seed('refused-'+connector,connector);const c0=providerCalls;pull(connector);const refused=await until(async()=>{const c=await stored();return c.status==='FAILED'&&c},'403 durable receipt');assert.equal(refused.terminalReason,'PROVIDER_REFUSED');assert.equal(refused.lastProviderFailure.status,403);assert.equal(refused.lastProviderFailure.code,'bot.blocked');assert.equal(providerCalls,c0+1);assert.ok(!JSON.stringify(refused).includes('synthetic-private-description'));pull(connector);await pause(70);assert.equal(providerCalls,c0+1);record(connector+' full pull→HTTP→split→sender→fail→Mongo403 terminal privacy');
 scenario='accepted';await seed('accepted-'+connector,connector);const a0=providerCalls;pull(connector);const sent=await until(async()=>{const c=await stored();return c.status==='SENT'&&c},'durable ACK');const ack={leaseToken:sent.lastReceipt.token};assert.equal((await api(sent.id+'/ack',ack)).status,201);assert.equal((await api(sent.id+'/fail',{...ack,failure:{status:429}})).status,409);assert.equal((await api(sent.id+'/ack',{leaseToken:randomUUID()})).status,409);assert.equal((await stored()).status,'SENT');pull(connector);await pause(70);assert.equal(providerCalls,a0+1);record(connector+' accepted ACK durable; duplicate ACK idempotent; opposite/stale reject; no replay');
}
scenario='429';await seed('rate-limited');const r0=providerCalls;for(let attempt=1;attempt<=5;attempt++){if(attempt>1)await coll.updateOne({id:'rate-limited'},{$set:{nextAttemptAt:new Date(Date.now()-1).toISOString()}});pull('MAX_BOT');const c=await until(async()=>{const z=await stored();return z.attempts===attempt&&['PENDING','FAILED'].includes(z.status)&&z},'429 receipt');if(attempt<5){assert.equal(c.status,'PENDING');assert.ok(Date.parse(c.nextAttemptAt)>Date.now());const calls=providerCalls;pull('MAX_BOT');await pause(60);assert.equal(providerCalls,calls)}else{assert.equal(c.terminalReason,'ATTEMPTS_EXHAUSTED');assert.equal(c.lastProviderFailure.status,429)}}assert.equal(providerCalls-r0,5);record('429 persisted due time; no early pull; max5, reason retained');
scenario='network';await seed('network-unknown');pull('MAX_BOT');const unknown=await until(async()=>{const c=await stored();return c.status==='FAILED'&&c},'uncertain quarantine');assert.equal(unknown.terminalReason,'DELIVERY_UNKNOWN');record('ambiguous transport→DELIVERY_UNKNOWN without replay');
scenario='receipt-loss';await seed('receipt-loss');const loss0=providerCalls;pull('MAX_BOT');await until(()=>warnings.some(w=>w.unconfirmed),'receipt503 warning');assert.equal((await stored()).status,'LEASED');persistence.backendStates.get('max').db=db;await coll.updateOne({id:'receipt-loss'},{$set:{leasedUntil:new Date(Date.now()-1).toISOString()}});pull('MAX_BOT');await until(async()=>{const c=await stored();return c.status==='FAILED'},'receipt loss quarantine');assert.equal(providerCalls,loss0+1);record('provider acceptance plus backend receipt failure→expired quarantine; no second send');
scenario='late';await seed('late-close');const late0=providerCalls;pull('MAX_BOT');await until(()=>lateStarted,'pending synthetic provider');await RED.nodes.setFlows([],'full');lateResolve();await pause(120);assert.notEqual((await stored()).status,'SENT');assert.equal(providerCalls,late0+1);await coll.updateOne({id:'late-close'},{$set:{leasedUntil:new Date(Date.now()-1).toISOString()}});await api('pull?connector=MAX_BOT&receiptProtocol=max-lease-v1');assert.equal((await stored()).terminalReason,'DELIVERY_UNKNOWN');record('real Node-RED close aborts; late provider200 never ACK; no replay');
assert.equal(legacyCalls,0);record('legacy senders receive zero outbox messages');
const runtimeHashes=Object.fromEntries(['dist/support/max-outbox-store.js','dist/support/support.service.js','dist/support/support-persistence.service.js'].map(n=>[n,require('node:crypto').createHash('sha256').update(fs.readFileSync(P+'/'+n)).digest('hex')]));
const summary={runtimeHashes,backendRuntimeSourceDirty:require('node:child_process').spawnSync('git',['diff','--quiet','HEAD','--','src'],{cwd:P}).status!==0,result:'PASS_ISOLATED_HEADLESS_PAIRED_REHEARSAL',heads:{backend:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:P,encoding:'utf8'}).trim(),adapter:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:L,encoding:'utf8'}).trim()},nodeVersion:process.version,nodeRedVersion:RED.version(),mongoVersion:(await db.admin().serverInfo()).version,cases,syntheticProviderCalls:providerCalls,realProviderCalls:0,productionWrites:0,sharedStagingWrites:0,scope:'Real Node-RED4.0.9 headless/core HTTP and function/split nodes; actual Nest SupportController/SupportService/MAX persistence; synthetic config node and provider. Full app bootstrap disabled; disposable local Mongo only. Editor packaging independently verified after .js correction; not installed-target staging acceptance.'};
await db.dropDatabase();await RED.stop();redStarted=false;await app.close();app=null;await client.close();client=null;server.close();if(process.env.MAX_PAIRED_REPORT){assert.ok(path.isAbsolute(process.env.MAX_PAIRED_REPORT));fs.writeFileSync(process.env.MAX_PAIRED_REPORT,JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600})}fs.rmSync(root,{recursive:true});process.stdout.write(JSON.stringify(summary)+'\n');
})().catch(async e=>{process.stderr.write('ISOLATED_REHEARSAL_FAILED '+e.constructor.name+': '+String(e.message).slice(0,300)+'\n');try{if(db)await db.dropDatabase()}catch{};try{if(redStarted)await RED.stop()}catch{};try{if(app)await app.close()}catch{};try{if(client)await client.close()}catch{};try{server?.close()}catch{};process.exitCode=1});
