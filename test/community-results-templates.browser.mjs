// Synthetic localhost-only verification of the actual approved HTML -> PNG renderer.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
const scratch=process.env.PHAB_TEST_SCRATCH;
assert.ok(scratch,'Set PHAB_TEST_SCRATCH to an owned scratch directory');
const dir=mkdtempSync(join(scratch,'vnd-template-browser-'));
const renderer=readFileSync(new URL('../client-sdk/phab-community-results-templates.js',import.meta.url));
const assets=readFileSync(new URL('../dist/client-sdk/community-results-assets.json',import.meta.url));
const server=createServer((req,res)=>{
 if(req.url==='/renderer.js'){res.setHeader('Content-Type','application/javascript');res.end(renderer);}
 else if(req.url==='/assets.json'){res.setHeader('Content-Type','application/json');res.end(assets);}
 else {res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><meta charset="utf-8"><script src="/renderer.js"></script><body>LOCAL template QA</body></html>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const chrome=spawn(process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+join(dir,'profile'),'about:blank'],{stdio:'ignore'});
let socket;let nextId=0;const pending=new Map();const errors=[];const requests=[];
async function until(check,label){for(let i=0;i<300;i++){const v=await check();if(v)return v;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout '+label);}
function call(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
 await until(()=>existsSync(join(dir,'profile','DevToolsActivePort')),'debugger');
 const port=readFileSync(join(dir,'profile','DevToolsActivePort'),'utf8').split('\n')[0];
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push('console.error');if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);if(!m.id)return;const h=pending.get(m.id);pending.delete(m.id);if(m.error)h.reject(new Error(JSON.stringify(m.error)));else h.resolve(m.result);});
 await call('Page.enable');await call('Runtime.enable');await call('Network.enable');await call('Page.navigate',{url:base});
 await until(()=>evaluate('!!window.PHABCommunityResultsTemplates'),'renderer');
 assert.equal(await evaluate('typeof window.PHABCommunityResultsTemplates.render'),'function','PNG rendering must be implemented');
 await evaluate(`(async()=>{window.assets=await(await fetch('/assets.json')).json();window.rows=Array.from({length:23},(_,i)=>({rank:i+1,name:i===0?'Тестовый Оченьдлинныйфамильный Игрок':'Тестовый игрок '+(i+1),score:123.456-i,statistics:{tournamentsPlayed:4,tournamentsWon:2}}));window.pages=PHABCommunityResultsTemplates.paginate(rows);window.baseInput={communityName:'ЛИГА Терехово «Время на друзей» D',periodLabel:'01.10.2026 — 16.10.2026',dataAsOf:'2026-10-16T10:00:00Z',page:0,pageCount:3};window.overview=document.createElement('canvas');overview.width=1800;overview.height=1350;})()`);
 const designs=['01_klassika','02_temnaya_arena','03_podium','04_tablo','05_oblozhka'];
 const divisions=['start','rokot','smash'];
 const records=[];
 for(const [index,design] of designs.entries())for(const division of divisions){
  const output=await evaluate(`(async()=>{var input={...baseInput,design:${JSON.stringify(design)},division:${JSON.stringify(division)},rows:pages[0]};var prepared=PHABCommunityResultsTemplates.prepare(input,assets);var doc=new DOMParser().parseFromString(prepared.html,'text/html');var ranks=Array.from(doc.querySelectorAll('[data-export-rank]'),e=>Number(e.dataset.exportRank)).sort((a,b)=>a-b);var text=doc.body.textContent;var canvas=await PHABCommunityResultsTemplates.render(input,assets);overview.getContext('2d').drawImage(canvas,${index}*360,${divisions.indexOf(division)}*450,360,450);return {ranks,text,width:canvas.width,height:canvas.height,png:canvas.toDataURL('image/png').split(',')[1]};})()`);
  assert.deepEqual(output.ranks,[1,2,3,4,5,6,7,8,9,10],design+' '+division);
  assert.doesNotMatch(output.text,/Константин|Александр|Венцеслав|\[N\]|\[ДД|\[ЛОКАЦИЯ\]|▲|▼|СЛЕДУЮЩИЙ ТУР/);
  assert.match(output.text,/Тестовый/);
  assert.match(output.text,/ЛИГА Терехово/,'the actual community must remain in the exported image');
  assert.equal(await evaluate(`PHABCommunityResultsTemplates.prepare({...baseInput,design:${JSON.stringify(design)},division:${JSON.stringify(division)},rows:pages[0]},assets).overflowingScores`),0,'decimal scores must fit without clipping or neighbouring-column overlap');
  assert.equal(output.width,1080);assert.equal(output.height,1350);
  const png=Buffer.from(output.png,'base64');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const path=join(scratch,'vnd-'+design+'-'+division+'.png');writeFileSync(path,png);records.push({design,division,path,bytes:png.length});
 }
 const edge=await evaluate(`(()=>{var result=[];for(var size of [1,2,3,10,11,23,50]){var all=Array.from({length:size},(_,i)=>({...rows[0],rank:i+1,statistics:undefined}));var chunks=PHABCommunityResultsTemplates.paginate(all);for(var i=0;i<chunks.length;i++){var p=PHABCommunityResultsTemplates.prepare({...baseInput,design:'03_podium',division:'smash',rows:chunks[i],page:i,pageCount:chunks.length},assets);var d=new DOMParser().parseFromString(p.html,'text/html');var ranks=Array.from(d.querySelectorAll('[data-export-rank]'),e=>Number(e.dataset.exportRank)).sort((a,b)=>a-b);result.push({size,page:i,ranks,text:d.body.textContent});}}return result;})()`);
 for(const record of edge){
  const start=record.page*10+1;
  const count=Math.min(10,record.size-start+1);
  assert.deepEqual(record.ranks,Array.from({length:count},(_,i)=>start+i));
  assert.doesNotMatch(record.text,/Константин|▲|▼|ТУРН|ПОБ|\[N\]|СЛЕДУЮЩИЙ ТУР/);
  const heading=record.text.match(/(\d+[–-]\d+) МЕСТО/);
  if(count>3)assert.equal(heading?.[1],(start+3)+'–'+(start+count-1),'lower podium heading must reflect this page, not static sample ranks');
  else assert.equal(heading,null,'no lower-range heading when only podium cards exist');
 }
 assert.equal(await evaluate(`(()=>{try{PHABCommunityResultsTemplates.prepare({...baseInput,design:'../../private',division:'start',rows:pages[0]},assets);return false;}catch{return true;}})()`),true);
 const injected=await evaluate(`(()=>{var p=PHABCommunityResultsTemplates.prepare({...baseInput,design:'01_klassika',division:'start',rows:[{rank:1,name:'<img src=x onerror=alert(1)>',score:1}]},assets);var d=new DOMParser().parseFromString(p.html,'text/html');return {injected:d.querySelectorAll('img[src=x]').length,text:d.body.textContent};})()`);
 assert.equal(injected.injected,0);assert.match(injected.text,/<img src=x/);
 const literal=await evaluate(`(()=>{var p=PHABCommunityResultsTemplates.prepare({...baseInput,design:'01_klassika',division:'start',rows:[{rank:1,name:'Обновлено [N] Лига ВНД',score:1}]},assets);return new DOMParser().parseFromString(p.html,'text/html').querySelector('[data-export-rank] > div:nth-child(2)').textContent;})()`);
 assert.equal(literal,'Обновлено [N] Лига ВНД','player text must not be interpreted as a template placeholder');
 writeFileSync(join(scratch,'vnd-templates-overview.png'),Buffer.from(await evaluate("overview.toDataURL('image/png').split(',')[1]"),'base64'));
 assert.deepEqual(errors,[]);
 assert.ok(requests.every(url=>url.startsWith(base)||url.startsWith('data:')||url.startsWith('blob:')),'no hosted design editor/CDN/provider access');
 writeFileSync(join(scratch,'vnd-template-browser-results.json'),JSON.stringify({evidence:'LOCAL',templates:records,edgeCases:edge.length,errors,externalRequests:0},null,2));
 console.log(JSON.stringify({evidence:'LOCAL',pngs:records.length,dimensions:'1080x1350',edgeCases:edge.length,errors:0,externalRequests:0,overview:join(scratch,'vnd-templates-overview.png')}));
}finally{
 if(socket)socket.close();chrome.kill();await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
