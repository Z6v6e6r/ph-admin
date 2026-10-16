// Local synthetic browser rehearsal; no production server or user profile is used.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {buildCommunityResultsExport, resolveCommunityResultsWindow} = require('../dist/communities/community-results-export.js');
const {buildCommunityRatingSnapshot} = require('../dist/communities/canonical-rating/aggregates.js');
const {COMMUNITY_RATING_CALCULATION_VERSION} = require('../dist/communities/canonical-rating/contract.js');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
assert.ok(existsSync(chromePath), 'Set CHROME_PATH to an installed Chromium executable');
const scratch = process.env.PHAB_TEST_SCRATCH;
assert.ok(scratch, 'PHAB_TEST_SCRATCH must point to an owned scratch directory');
const dir = mkdtempSync(join(scratch, 'community-results-browser-'));
const now = Date.now();
const members = ['Тестовая Анна','Тестовый Борис'].map((name,i) => ({
  playerKey:'id:fixture-'+i,playerId:'fixture-'+i,playerPhone:null,playerName:name,playerAvatarUrl:null,currentLevel:2
}));
const facts = members.map((member,i) => ({
  ...member, id:'fact-'+i, communityId:'fixture-community',sourcePostId:null,eventId:'visit-'+i,
  ratingDelta:0,ratingEventIds:[],lastRatingDelta:null,lastRatingChangedAt:null,lastRatingChangedAtTs:null,lastRatingEventId:null,
  occurredAt:new Date(now-60000).toISOString(),occurredAtTs:now-60000,calculationVersion:COMMUNITY_RATING_CALCULATION_VERSION,
  collectedAt:new Date(now).toISOString(),eventType:'visit',metrics:{visitsAttended:1}
}));
const snapshot = buildCommunityRatingSnapshot({communityId:'fixture-community',period:'all',members,facts,nowTs:now});
const panel = readFileSync(new URL('../client-sdk/phab-admin-panel.js',import.meta.url),'utf8');
const helpers = panel.slice(panel.indexOf('  function communityResultsExportOptions('),panel.indexOf('  function createApi('));
const server = createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (url.pathname === '/results-export') {
    const query = Object.fromEntries(url.searchParams);
    const mode = query.mode;
    if (mode === 'delay') await new Promise(resolve => setTimeout(resolve,250));
    const result = buildCommunityResultsExport('fixture-community',{snapshot,facts},resolveCommunityResultsWindow(query,now));
    if (mode === 'empty') result.rows = [];
    if (mode === 'wrong-period') result.period = 'all';
    if (mode === 'many') result.rows = Array.from({length:Number(query.places)},(_,i)=>({rank:i+1,name:'Тестовый игрок '+(i+1),score:100-i,statistics:{tournamentsPlayed:4,tournamentsWon:1}}));
    res.writeHead(mode === 'error' ? 503 : 200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify(result));
  } else if (url.pathname === '/client-script/community-results-templates.js') {
    res.setHeader('Content-Type','application/javascript');
    res.end(readFileSync(new URL('../client-sdk/phab-community-results-templates.js',import.meta.url)));
  } else if (url.pathname === '/client-script/community-results-assets.json') {
    res.setHeader('Content-Type','application/json');
    res.end(readFileSync(new URL('../dist/client-sdk/community-results-assets.json',import.meta.url)));
  } else {
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Community export — synthetic local QA</title><style>body{font-family:sans-serif;background:#f7f0f4}.phab-admin-btn,.phab-admin-btn-secondary{padding:12px;border-radius:18px;border:0;background:#b8f1df;color:#330020;font-weight:700}.phab-admin-modal-close{border:0;background:none;font-size:24px}</style><button id="open">Выгрузить результаты</button><script>'+helpers+`
window.fixtureMode = '';
document.querySelector('#open').onclick = function () {
  window.controller = createCommunityResultsExportDialog({id:'fixture-community',name:'ЛИГА Терехово «Время на друзей» D'}, async function(options) {
    window.lastOptions = options;
    var response = await fetch('/results-export?' + new URLSearchParams({...options,mode:window.fixtureMode}));
    if (!response.ok) throw new Error('Не удалось загрузить результаты. Повторите попытку.');
    return response.json();
  }, function () {return loadCommunityResultsTemplates(location.origin);});
};
</script></html>`);
  }
});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = 'http://127.0.0.1:'+server.address().port;
const chrome = spawn(chromePath,['--headless=new','--remote-debugging-port=0','--user-data-dir='+join(dir,'profile'),'--no-first-run','--no-default-browser-check','about:blank'],{stdio:'ignore'});
let socket;
const browserErrors = [];
const requests = [];
const pending = new Map();
let nextId = 0;
async function waitUntil(check, message) {
  for (let i=0;i<150;i++) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  throw new Error('Timed out: '+message);
}
function call(method,params={}) {
  const id=++nextId;
  return new Promise((resolve,reject) => {
    pending.set(id,{resolve,reject});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function statusIncludes(text) {
  await waitUntil(() => evaluate(`document.querySelector('[data-status]').textContent.includes(${JSON.stringify(text)})`),text);
}
async function generate(period='month', mode='') {
  await evaluate(`window.fixtureMode=${JSON.stringify(mode)}; var form=document.querySelector('form'); form.elements.period.value=${JSON.stringify(period)}; form.elements.period.dispatchEvent(new Event('change',{bubbles:true})); form.requestSubmit();`);
}
try {
  await waitUntil(() => existsSync(join(dir,'profile','DevToolsActivePort')),'Chrome debug socket');
  const port = readFileSync(join(dir,'profile','DevToolsActivePort'),'utf8').split('\n')[0];
  const tabs = await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') browserErrors.push('console.error');
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (!message.id) return;
    const handler=pending.get(message.id); pending.delete(message.id);
    if (message.error) handler.reject(new Error(JSON.stringify(message.error))); else handler.resolve(message.result);
  });
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
  await call('Page.navigate',{url:base});
  await waitUntil(() => evaluate("!!document.querySelector('#open')"),'fixture loaded');
  await evaluate("document.querySelector('#open').focus();document.querySelector('#open').click()");
  assert.equal(await evaluate('document.activeElement.name'),'template');
  for (const period of ['month','week','all']) {
    await generate(period); await statusIncludes('Готово.');
    assert.equal(await evaluate('window.lastOptions.period'),period);
    assert.equal(await evaluate("document.querySelector('[data-download]').disabled"),false);
  }
  await evaluate("document.querySelector('[data-download]').click()");
  const pngPath=join(dir,'community-results-all.png');
  await waitUntil(() => existsSync(pngPath),'PNG download');
  const png=readFileSync(pngPath);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),1080);
  assert.equal(png.readUInt32BE(20),1080);
  const date=new Date(now+3*3600000).toISOString().slice(0,10);
  await evaluate(`var form=document.querySelector('form');form.elements.period.value='custom';form.elements.period.dispatchEvent(new Event('change',{bubbles:true}));form.elements.from.value='${date}';form.elements.to.value='${date}';form.requestSubmit()`);
  await statusIncludes('Готово.');
  assert.equal(await evaluate('window.lastOptions.from'),date);
  await generate('week','empty'); await statusIncludes('результатов нет');
  assert.equal(await evaluate("document.querySelector('[data-download]').disabled"),true);
  await generate('week','error'); await statusIncludes('Не удалось загрузить');
  await generate('week','wrong-period'); await statusIncludes('Выгрузка отменена');
  await generate('week','delay');
  await evaluate("document.querySelector('[name=places]').value='1';document.querySelector('[name=places]').dispatchEvent(new Event('input',{bubbles:true}))");
  await new Promise(resolve => setTimeout(resolve,400));
  assert.equal(await evaluate("document.querySelector('canvas').hidden"),true);
  await generate('week'); await statusIncludes('Готово.');
  await evaluate("document.querySelector('[name=template]').value='custom';document.querySelector('[name=template]').dispatchEvent(new Event('change',{bubbles:true}))");
  const {root}=await call('DOM.getDocument');
  const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'input[type=file]'});
  const backgroundPath=join(dir,'background.png');
  const backgroundData=await evaluate("(() => {var canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1080;var ctx=canvas.getContext('2d');ctx.fillStyle='#246458';ctx.fillRect(0,0,1080,1080);return canvas.toDataURL('image/png').split(',')[1]})()");
  writeFileSync(backgroundPath,Buffer.from(backgroundData,'base64'));
  await call('DOM.setFileInputFiles',{nodeId,files:[backgroundPath]});
  await statusIncludes('Фон загружен');
  await generate('week'); await statusIncludes('Готово.');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate("window.matchMedia('(max-width:480px)').matches"),true);
  assert.equal(await evaluate("document.querySelector('dialog').getBoundingClientRect().width <= 366"),true);
  assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth"),true);
  const screenshot = await call('Page.captureScreenshot',{format:'png'});
  const screenshotPath=join(scratch,'community-results-export-mobile.png');
  writeFileSync(screenshotPath,Buffer.from(screenshot.data,'base64'));
  await evaluate("document.querySelector('[data-download]').scrollIntoView({block:'center'})");
  assert.equal(await evaluate("document.querySelector('[data-download]').getBoundingClientRect().bottom <= window.innerHeight"),true);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitUntil(() => evaluate("!document.querySelector('dialog')"),'Escape close');
  assert.equal(await evaluate('document.activeElement.id'),'open');
  await evaluate("document.querySelector('#open').click();window.controller.close()");
  assert.equal(await evaluate("document.querySelector('dialog')"),null);
  await evaluate("document.querySelector('#open').click();var f=document.querySelector('form');f.elements.template.value='01_klassika';f.elements.template.dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await evaluate('f.elements.division.value'),'','do not silently label another community as the Start division');
  assert.equal(await evaluate('f.checkValidity()'),false);
  await evaluate("f.elements.division.value='start';f.elements.places.value=23;window.fixtureMode='many';f.requestSubmit()");
  await statusIncludes('Готово.');
  assert.equal(await evaluate("document.querySelector('canvas').height"),1350,'approved layout retains its 1080x1350 frame');
  assert.equal(await evaluate('window.lastOptions.details'),'templates-v1');
  assert.equal(await evaluate("document.querySelector('[data-page-label]').textContent"),'Страница 1 из 3');
  assert.equal(await evaluate("document.querySelector('[data-next-page]').getBoundingClientRect().height >= 44"),true,'mobile page controls need a touch-sized target');
  await evaluate("document.querySelector('[data-next-page]').click()");
  assert.equal(await evaluate("document.querySelector('[data-page-label]').textContent"),'Страница 2 из 3');
  await evaluate("document.querySelector('[data-download]').click()");
  const templatePath=join(dir,'community-results-month-01_klassika-start-p02.png');
  await waitUntil(()=>existsSync(templatePath),'template PNG download');
  const templatePng=readFileSync(templatePath);
  assert.equal(templatePng.readUInt32BE(16),1080);assert.equal(templatePng.readUInt32BE(20),1350);
  await evaluate("document.querySelector('[data-pages]').scrollIntoView({block:'end'})");
  const brandedMobile=await call('Page.captureScreenshot',{format:'png'});
  writeFileSync(join(scratch,'community-results-branded-mobile.png'),Buffer.from(brandedMobile.data,'base64'));
  assert.equal(await evaluate("document.querySelector('dialog').scrollWidth <= document.querySelector('dialog').clientWidth"),true);
  await evaluate("document.querySelector('[name=division]').value='smash';document.querySelector('[name=division]').dispatchEvent(new Event('change',{bubbles:true}))");
  assert.equal(await evaluate("document.querySelector('[data-download]').disabled"),true);
  assert.equal(await evaluate("document.querySelector('[data-pages]').hidden"),true);
  await evaluate('window.controller.close()');
  assert.deepEqual(browserErrors,[]);
  assert.ok(requests.every(url=>url.startsWith(base)||url.startsWith('blob:')||url.startsWith('data:')),'fixture must never contact a live service');
  console.log('Browser LOCAL: all periods, legacy PNG/upload, 1080x1350 template PNG download, 23-row pagination, stale/empty/error, mobile390, Escape/focus passed.');
  console.log('Screenshot: '+screenshotPath);
} finally {
  if (socket) socket.close();
  chrome.kill();
  await new Promise(resolve => chrome.exitCode !== null ? resolve() : chrome.once('exit',resolve));
  await new Promise(resolve => server.close(resolve));
  rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
