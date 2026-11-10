import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const source=readFileSync(new URL('../client-sdk/phab-admin-panel.js',import.meta.url),'utf8');
function extract(name,next) {
  const start=source.indexOf('    function '+name+'(');
  const end=source.indexOf('    function '+next+'(',start);
  assert.ok(start>=0&&end>start);return source.slice(start,end);
}
// Minimal controls exercise the real editor and serializer without browser/network writes.
function harness() {
  const cards=[];
  function card() {
    const fields=[];
    const result={
      set innerHTML(html) {
        for(const match of html.matchAll(/<(input|select|textarea|button)\b([^>]*)>/g)) {
          const attrs=match[2],key=attrs.match(/\b(data-benefit-[a-z-]+)(?:\s|>|$)/)?.[1];
          if(!key)continue;
          fields.push({key,value:attrs.match(/\bvalue="([^"]*)"/)?.[1]||'',checked:false,disabled:false,
            listeners:{},addEventListener(event,fn){this.listeners[event]=fn;}});
        }
        result.querySelector('[data-benefit-kind]').value='PERCENT_DISCOUNT';
      },
      querySelector(selector){const row=this.querySelectorAll(selector)[0];assert.ok(row,selector);return row;},
      querySelectorAll(selector){return fields.filter(f=>'['+f.key+']'===selector.replace(':checked','')&&(!selector.endsWith(':checked')||f.checked));},
      remove(){cards.splice(cards.indexOf(this),1);}
    };return result;
  }
  const context={document:{createElement:card},dom:{subscriptionBenefits:{appendChild(c){cards.push(c);},querySelectorAll(){return cards;}}},
    normalizeArray:v=>Array.isArray(v)?v:[],splitSubscriptionIds:v=>String(v||'').split(/[\s,;]+/).filter(Boolean)};
  vm.createContext(context);
  vm.runInContext(extract('addSubscriptionBenefitEditor','addSubscriptionStationRule')+extract('subscriptionBenefitRulesPayload','subscriptionStationRulesPayload'),context);
  return {context,cards,add:definition=>context.addSubscriptionBenefitEditor(definition),payload:()=>JSON.parse(JSON.stringify(context.subscriptionBenefitRulesPayload()))};
}
const rule={enabled:true,category:'GAME',actions:['CREATE_GAME','JOIN_GAME'],kind:'PERCENT_DISCOUNT',percentage:30,
 externalEventTypeIds:['viva:direction:1:type:2'],productTypeIds:[],durationMinutes:[60,90,120],stationIds:[],allStations:true};
test('saved residency benefits retain both game actions, wildcard and percentage through edit/save',()=>{
 const h=harness();h.add({category:'GAME',rule});const c=h.cards[0];
 assert.equal(c.querySelector('[data-benefit-stations]').disabled,true);
 const [p]=h.payload();assert.deepEqual(p.actions,rule.actions);assert.equal(p.allStations,true);assert.deepEqual(p.stationIds,[]);assert.equal(p.percentage,30);
});
test('legacy explicit lists and omitted wildcard retain their meaning',()=>{
 for(const allStations of [undefined,false]) {
  const h=harness();h.add({category:'GAME',rule:{...rule,actions:['JOIN_GAME'],stationIds:['station-a'],allStations}});
  const [p]=h.payload();assert.deepEqual(p.actions,['JOIN_GAME']);assert.deepEqual(p.stationIds,['station-a']);assert.ok(!Object.hasOwn(p,'allStations'));
 }
});
test('wildcard never sends conflicting station list and toggling back restores entered list',()=>{
 const h=harness();h.add({category:'GAME',rule:{...rule,allStations:false,stationIds:['station-a']}});const c=h.cards[0],toggle=c.querySelector('[data-benefit-all-stations]');
 toggle.checked=true;toggle.listeners.change();assert.equal(c.querySelector('[data-benefit-stations]').disabled,true);assert.deepEqual(h.payload()[0].stationIds,[]);
 toggle.checked=false;toggle.listeners.change();assert.equal(c.querySelector('[data-benefit-stations]').disabled,false);assert.deepEqual(h.payload()[0].stationIds,['station-a']);
});
test('new group-training benefit defaults to its action with no implicit wildcard',()=>{
 const h=harness();h.add({category:'GROUP_TRAINING'});const [p]=h.payload();assert.deepEqual(p.actions,['BOOK_GROUP_TRAINING']);assert.ok(!Object.hasOwn(p,'allStations'));
});
test('empty actions on an enabled benefit fail before API submission',()=>{
 const h=harness();h.add({category:'GAME',rule});h.cards[0].querySelectorAll('[data-benefit-action]').forEach(c=>{c.checked=false;});assert.throws(h.payload,/Выберите хотя бы одно действие/);
});
