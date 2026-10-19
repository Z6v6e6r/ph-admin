import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
const file = new URL('../client-sdk/phab-community-results-templates.js',import.meta.url);
function api() {
  assert.ok(existsSync(file),'the approved-template renderer must exist');
  const context=vm.createContext({window:{},Number,Error});
  vm.runInContext(readFileSync(file,'utf8'),context);
  return context.window.PHABCommunityResultsTemplates;
}
test('template pages preserve canonical order and ranks, at most ten per PNG',()=>{
  const renderer=api();
  const rows=Array.from({length:23},(_,i)=>({rank:i+1,name:'Игрок '+(i+1),score:23-i}));
  const pages=renderer.paginate(rows);
  assert.deepEqual(Array.from(pages,p=>p.length),[10,10,3]);
  assert.deepEqual(Array.from(pages[1],r=>r.rank),[11,12,13,14,15,16,17,18,19,20]);
  assert.equal(pages[2][2],rows[22]);
  assert.equal(renderer.paginate([]).length,0);
  assert.throws(()=>renderer.paginate(Array(51).fill(rows[0])));
});

test('build packages fifteen layouts and all fonts/logos without editor dependencies',()=>{
  assert.match(readFileSync(new URL('../Dockerfile',import.meta.url),'utf8'),/COPY assets \.\/assets/,'container build must receive the same approved assets');
  const path=new URL('../dist/client-sdk/community-results-assets.json',import.meta.url);
  assert.ok(existsSync(path),'the build must emit the self-contained asset pack');
  const assets=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(assets.version,'vnd-results-templates-v1');
  assert.equal(Object.keys(assets.html).length,15);
  assert.equal(Object.keys(assets.resources).length,11);
  for(const value of Object.values(assets.html)) {
    assert.match(value,/1080px/); assert.match(value,/1350px/);
    assert.doesNotMatch(value,/<script|\son\w+=|https?:\/\//i);
  }
  for(const [name,uri] of Object.entries(assets.resources)) {
    assert.match(name,/^(fonts|img)\//);
    assert.match(uri,/^data:(font\/ttf|image\/svg\+xml);base64,/);
  }
});
