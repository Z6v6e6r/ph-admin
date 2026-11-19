const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const requireNodeRed = require('node:module').createRequire(path.join(process.env.NODE_RED_FIXTURE_ROOT, 'package.json'));
const RED=requireNodeRed('node-red');
const packageInfo=requireNodeRed('node-red/package.json');
assert.equal(packageInfo.version,'4.0.9');
const source = require('./lk1-router.json');
const directory=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'phub-native-fixture-'));
const tab='fixture-only';
const receive=(index,msg,sandbox)=>{
  if(index===5)return;
  const output=Array(8).fill(null);
  output[index]=msg;
  process.send({output,sandbox});
};
Object.assign(process.env,{
  TOURNAMENT_OWNER_API_BASE:'https://cup.fixture/api',
  TOURNAMENT_OWNER_INTEGRATION_TOKEN:'synthetic-owner-token'
});
const nodes=[{
  id:tab,type:'tab',label:'Isolated release fixture',disabled:false
},{
  id:source.id,type:'function',z:tab,name:'Exact candidate func',x:140,y:100,
  func:source.func,outputs:source.outputs,noerr:0,libs:source.libs,initialize:'',finalize:'',
  wires:Array.from({length:source.outputs},(_,idx)=>[['effect',idx].join('-')])
},...Array.from({length:source.outputs},(_,idx)=>({
  id:'effect-'+idx,type:'function',z:tab,name:'Capture output '+idx,x:400,y:60+40*idx,
  func:'global.get("fixtureReceive")('+idx+',msg,{url:typeof URL,baseConfigured:!!env.get("TOURNAMENT_OWNER_API_BASE")});return null;',
  outputs:1,noerr:0,wires:[[]]
})),{
  id:'fixture-catch',type:'catch',z:tab,name:'Capture router error',scope:[source.id],uncaught:false,
  x:140,y:460,wires:[['fixture-error']]
},{
  id:'fixture-error',type:'function',z:tab,name:'Report router error',x:420,y:460,
  func:'global.get("fixtureError")(msg.error?.message);return null;',outputs:1,wires:[[]]
}];
fs.writeFileSync(path.join(directory,'flows.json'),JSON.stringify(nodes),{mode:0o600});
const server=http.createServer((_req,res)=>res.writeHead(404).end());
async function start(){
  RED.init(server,{userDir:directory,flowFile:'flows.json',httpAdminRoot:false,httpNodeRoot:false,
    functionExternalModules:true,logging:{console:{level:'info',metrics:false,audit:false}},
    functionGlobalContext:{fixtureReceive:receive,fixtureError:error=>process.send({error}),
      vivacrm_access_token: ['fixture', Buffer.from(JSON.stringify({
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url'), 'unsigned-fixture'].join('.'),
      subscriptions_lk1_plan_rules:{formatVersion:1,rules:[{productId:'11111111-1111-4111-8111-111111111111',
        planKey:'fixture',enforceFrom:'2026-09-01',maxActiveBookings:8,freeGameMinutesPerDay:60,
        gameOverageDiscountPercent:30,groupTrainingDiscountPercent:50,tournamentDiscountPercent:50}]}}});
  await RED.start();
  for(let i=0;i<40;i++){
    if(RED.nodes.getNode(source.id)) return;
    await new Promise(resolve=>setTimeout(resolve,75));
  }
  throw Error('fixture nodes did not load');
}
const started=start();
process.on('message',async msg=>{
  try{
    await started;
    const node=RED.nodes.getNode(source.id);
    assert.ok(node);
    node.receive(msg);
  }catch(e){process.send({error:e.stack});}
});
process.on('SIGTERM',async()=>{await RED.stop();fs.rmSync(directory,{recursive:true,force:true});process.exit(0);});
