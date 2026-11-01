import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import vm from 'node:vm';
const source = readFileSync(new URL('../client-sdk/phab-admin-panel.js', import.meta.url), 'utf8');
const code = source.split('// TOURNAMENT_ORGANIZER_CUSTODY_START')[1].split('// TOURNAMENT_ORGANIZER_CUSTODY_END')[0];
const context = vm.createContext({ Set, JSON, Number, Error });vm.runInContext(code,context);
const tenantId=randomUUID(),tournamentId=randomUUID(),selected=randomUUID();
const current=(revision=0,selectedUserId=null)=>({contractVersion:1,tenantId,tournamentId,current:{revision,selectedUserId}});
const confirmed=(command,revision=1)=>({...current(revision,command.selectedUserId),status:'CONFIRMED',operation:{operationId:command.operationId,action:command.action,expectedRevision:command.expectedRevision,requestedSelectedUserId:command.selectedUserId,outcome:command.action==='ASSIGN'?'ASSIGNED':'REVOKED',reason:command.action==='ASSIGN'?'ASSIGNED':'REVOKED',resultingRevision:revision,resultingSelectedUserId:command.selectedUserId,committedAt:new Date().toISOString()}});
function fixture(storage=new Map(),key='synthetic-actor/tournament',isCurrent=()=>true){
 const calls=[];let view;let commandHandler=async()=>{throw Error('lost ACK');},statusHandler=async()=>({...current(),status:'UNKNOWN'});
 const api={read:async()=>{calls.push(['GET']);return current();},preview:async c=>{calls.push(['PREVIEW',c]);return{contractVersion:1,tournamentId,revision:0,profile:{userId:c.selectedUserId,displayName:'Synthetic'}};},command:async c=>{calls.push(['POST',c]);return commandHandler(c);},status:async id=>{calls.push(['STATUS',id]);return statusHandler(id);}};
 const model=context.createTournamentOrganizerCustody({api,isCurrent,storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},key,uuid:randomUUID,changed:v=>view=v});
 return {model,calls,storage,get view(){return view;},set commandHandler(v){commandHandler=v;},set statusHandler(v){statusHandler=v;}};
}
test('actual editor model retains original unknown command; reopen is GET only and edits never replace pending',async()=>{
 const f=fixture();await f.model.load();await f.model.preview(selected);await f.model.assign();const original=f.calls.find(x=>x[0]==='POST')[1];assert.equal(f.view.pending.operationId,original.operationId);
 f.model.edit();await f.model.preview(randomUUID());await f.model.assign();assert.equal(f.calls.filter(x=>x[0]==='POST').length,1);
 f.model.destroy();const reopened=fixture(f.storage);await reopened.model.load();assert.deepEqual(reopened.calls,[['STATUS',original.operationId]]);assert.equal(reopened.view.pending.operationId,original.operationId);
 reopened.statusHandler=async()=>confirmed(original);await reopened.model.restore();assert.equal(reopened.view.pending,null);assert.equal(reopened.view.current.selectedUserId,selected);
});
test('other staff cannot consume original custody; forbidden status hides current profile and retains key',async()=>{
 const f=fixture();await f.model.load();await f.model.preview(selected);await f.model.assign();const isolated=fixture(f.storage,'other-actor/tournament');await isolated.model.load();assert.equal(isolated.view.pending,null);assert.equal(isolated.calls[0][0],'GET');
 f.statusHandler=async()=>{throw Object.assign(Error('denied'),{status:403});};await f.model.restore();assert.equal(f.view.current,null);assert.ok(f.view.pending);assert.ok(f.storage.size);
});
test('late acknowledgement after destroy does not clear saved custody or publish profile',async()=>{
 const f=fixture();await f.model.load();await f.model.preview(selected);let release;f.commandHandler=c=>new Promise(r=>{release=()=>r(confirmed(c));});const sending=f.model.assign();await Promise.resolve();f.model.destroy();release();await sending;
 assert.ok(JSON.parse(f.storage.values().next().value).length);const reopened=fixture(f.storage);await reopened.model.load();assert.equal(reopened.calls[0][0],'STATUS');
});
test('storage full fails closed before dispatch, malformed/foreign response never erases unknown',async()=>{
 const f=fixture();await f.model.load();await f.model.preview(selected);
 const full=Array.from({length:16},(_,i)=>({key:'other-'+i,tenantId,tournamentId,command:{contractVersion:1,operationId:randomUUID(),action:'ASSIGN',selectedUserId:selected,expectedRevision:0}}));f.storage.set('phab-tournament-organizer-v1',JSON.stringify(full));await f.model.assign();assert.equal(f.calls.filter(x=>x[0]==='POST').length,0);
 f.storage.clear();await f.model.preview(selected);await f.model.assign();f.statusHandler=async()=>({...current(),status:'CONFIRMED',operation:{operationId:randomUUID()}});await f.model.restore();assert.ok(f.view.pending);
});
test('production wiring uses scoped API with original idempotency header and destroys before logout',()=>{
 assert.match(source,/headers\['Idempotency-Key'\] = value\.operationId/);assert.match(source,/async function logout\(\) \{\s*state.tournamentEditorLoggingOut = true;\s*closeTournamentEditorModal\(\)/);
 assert.match(source,/JSON\.stringify\(\[cfg\.apiBaseUrl, cfg\.userId, organizerId\]\)/);
});

test('same-key receipt for changed revision/profile or foreign target never clears original metadata',async()=>{
 for(const field of ['expectedRevision','requestedSelectedUserId','tenantId','tournamentId']){
  const f=fixture();await f.model.load();await f.model.preview(selected);await f.model.assign();const original=f.calls.find(x=>x[0]==='POST')[1];f.model.destroy();
  const reopened=fixture(f.storage);reopened.statusHandler=async()=>{const r=confirmed(original);if(field==='expectedRevision')r.operation.expectedRevision++;else if(field==='requestedSelectedUserId')r.operation.requestedSelectedUserId=randomUUID();else r[field]=randomUUID();return r;};
  await reopened.model.load();assert.equal(reopened.view.pending.operationId,original.operationId);assert.equal(reopened.calls[0][0],'STATUS');
 }
 const f=fixture();await f.model.load();await f.model.preview(selected);await f.model.assign();const original=f.calls.find(x=>x[0]==='POST')[1];
 f.statusHandler=async()=>{const r=confirmed(original);r.operation.outcome='REJECTED';r.operation.reason='REVISION_CONFLICT';r.operation.expectedRevision=99;return r;};await f.model.restore();assert.ok(f.view.pending);
});

test('loading blocks another command until preview resolves',async()=>{
 let view,resolve;const storage=new Map();const api={read:()=>Promise.resolve(current()),preview:c=>new Promise(r=>{resolve=()=>r({contractVersion:1,tournamentId,revision:0,profile:{userId:c.selectedUserId,displayName:'Synthetic'}});}),command:()=>{throw Error('must not dispatch');}};
 const model=context.createTournamentOrganizerCustody({api,isCurrent:()=>true,storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},key:'loading',uuid:randomUUID,changed:v=>view=v});
 await model.load();const loading=model.preview(selected);assert.equal(view.busy,true);await model.assign();assert.equal(view.pending,null);resolve();await loading;assert.equal(view.busy,false);assert.equal(view.preview.command.selectedUserId,selected);
});

test('impossible confirmed transitions and coerced UUIDs retain exact pending metadata',async()=>{
 const mutations=[
  r=>{r.operation.resultingRevision=0;r.current.revision=0;},
  r=>{r.operation.outcome='REJECTED';r.operation.reason='REVISION_CONFLICT';r.operation.resultingRevision=0;},
  r=>{r.operation.outcome='REJECTED';r.operation.reason='REVISION_CONFLICT';r.operation.resultingSelectedUserId=['not-a-uuid'];},
  r=>{r.operation.resultingSelectedUserId=[selected];},
  r=>{r.current.selectedUserId=null;},
  r=>{r.current.selectedUserId=[selected];},
  r=>{r.tenantId=[tenantId];},
  r=>{r.tournamentId=[tournamentId];},
 ];
 for(const mutate of mutations){const f=fixture();await f.model.load();await f.model.preview(selected);await f.model.assign();const original=f.calls.find(x=>x[0]==='POST')[1];
  f.statusHandler=async()=>{const r=confirmed(original);mutate(r);return r;};await f.model.restore();assert.equal(f.view.pending.operationId,original.operationId);assert.equal(JSON.parse(f.storage.values().next().value)[0].command.operationId,original.operationId);}
});
test('model current predicate fences dispatch and late ACK even without destroy',async()=>{
 let active=true;const f=fixture(new Map(),'actor/tournament',()=>active);await f.model.load();await f.model.preview(selected);active=false;
 await f.model.assign();await f.model.restore();await f.model.load();assert.equal(f.calls.filter(x=>x[0]==='POST'||x[0]==='STATUS').length,0);
 active=true;let release;f.commandHandler=c=>new Promise(resolve=>{release=()=>resolve(confirmed(c));});const pending=f.model.assign();await Promise.resolve();active=false;release();await pending;
 assert.equal(JSON.parse(f.storage.values().next().value).length,1);assert.ok(f.view.pending);assert.equal(f.view.current.selectedUserId,null);
});

// Execute the actual editor-open source through organizer mount. Only later unrelated form fields
// are excluded; no guard or async boundary in the tested execution path is replaced.
const openStart=source.indexOf('    async function openTournamentEditor(');
const openEnd=source.indexOf("      var allowedPhonesInput = document.createElement('textarea');",openStart);
const openCode=source.slice(openStart,openEnd)+'\n    }\n';
const closeStart=source.indexOf('    function closeTournamentEditorModal()');
const closeCode=source.slice(closeStart,openStart);
const logoutStart=source.indexOf('    async function logout()');
const logoutCode=source.slice(logoutStart,source.indexOf('    async function refreshActiveTab()',logoutStart));
const editorStart=source.indexOf('  function createTournamentOrganizerEditor(');
const editorCode=source.slice(editorStart,source.indexOf('  function createApi(cfg)',editorStart));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function editorFixture(stage='custom'){
 const entered=deferred(),gate=deferred(),logoutGate=deferred(),calls=[],mounts=[];
 function element(){return{children:[],style:{},events:{},classList:{add(){},remove(){}},appendChild(child){this.children.push(child);return child;},setAttribute(){},addEventListener(name,fn){this.events[name]=fn;}};}
 const model={id:'A',source:'CUSTOM',name:'Synthetic',sourceTournamentId:'legacy-source'};
 const delay=async(name,value,id)=>{calls.push([name,id]);if(name===stage&&id!=='B'){entered.resolve();return gate.promise;}return value;};
 const storage=new Map();const ctx=vm.createContext({Set,JSON,Number,Error,Promise,String,Math,
  state:{},cfg:{userId:'synthetic-staff',authToken:'synthetic-session',apiBaseUrl:'synthetic-api'},
  dom:{tournamentEditorBody:element(),tournamentEditorSaveBtn:element(),tournamentEditorTitle:element(),tournamentEditorModal:element(),logoutBtn:element(),refreshBtn:element()},
  document:{createElement:element},window:{sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},crypto:{randomUUID},localStorage:{removeItem(){}},location:{}},
  api:{getCustomTournament:id=>delay('custom',{...model,id},id),getTournament:id=>delay('source',{...model,id},id),logout:()=>logoutGate.promise,
   organizerRequest:async(id,action)=>{calls.push(['organizer',id,action]);return current();}},
  normalizeObject:v=>v||{},normalizeTournamentMechanics:()=>({}),getTournamentChangeLogEntries:()=>[],getTournamentStatusAuditRecord:()=>({}),getTournamentSourceSnapshot:()=>({}),
  normalizeTournamentTypeLabel:v=>v,mergeTournamentEditorModelWithLiveSource:v=>v,loadTournamentPublicationCommunities:()=>delay('publication',[],'A'),
  clearNode:e=>{e.children=[];},buildTournamentCardUrl:()=>'',appendCommunityFormField(){},TOURNAMENT_STATUS_OPTIONS:[],formatDateTimeFull:()=>'-',
  createTournamentTypeSelect:element,createTournamentVisibilitySwitch:()=>({root:element(),input:element()}),createTournamentAccessLevelsControl:()=>({root:element(),input:element()}),
  createTournamentPersonList:element,hasPermission:()=>true,setStatus(){},scenarioPane:{suspend(){}},storeNotificationToken(){},notificationApi:null,
 });
 vm.runInContext(code+editorCode+closeCode+openCode+logoutCode,ctx);
 const actual=ctx.createTournamentOrganizerEditor;ctx.createTournamentOrganizerEditor=options=>{const panel=actual(options);mounts.push({options,panel});return panel;};
 return{ctx,entered,gate,logoutGate,calls,mounts,model};
}
for(const stage of ['custom','source','publication'])for(const close of ['close','logout'])test(`actual pending editor ${stage} load cannot revive organizer after ${close}`,async()=>{
 const f=editorFixture(stage);const opening=f.ctx.openTournamentEditor(f.model);await f.entered.promise;
 let loggingOut;if(close==='logout'){loggingOut=f.ctx.logout();assert.equal(f.ctx.cfg.authToken,'synthetic-session');await f.ctx.openTournamentEditor({...f.model,id:'B'});}else f.ctx.closeTournamentEditorModal();
 f.gate.resolve(stage==='publication'?[]:f.model);await opening;assert.equal(f.mounts.length,0);assert.equal(f.calls.filter(x=>x[0]==='organizer').length,0);assert.equal(f.ctx.dom.tournamentEditorBody.children.length,0);
 if(loggingOut){f.logoutGate.resolve();await loggingOut;}
});
test('actual newer editor B survives late A, and closed current model cannot call organizer APIs',async()=>{
 const f=editorFixture('custom');const a=f.ctx.openTournamentEditor(f.model);await f.entered.promise;
 await f.ctx.openTournamentEditor({...f.model,id:'B',sourceTournamentId:''});assert.equal(f.mounts.length,1);assert.equal(f.calls.filter(x=>x[0]==='organizer').length,1);const b=f.ctx.state.tournamentOrganizerPanel;
 f.gate.resolve(f.model);await a;assert.equal(f.ctx.state.tournamentOrganizerPanel,b);assert.equal(f.mounts.length,1);
 f.ctx.closeTournamentEditorModal();await assert.rejects(f.mounts[0].options.api.command({}));assert.equal(f.calls.filter(x=>x[0]==='organizer').length,1);
});
