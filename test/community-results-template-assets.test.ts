import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ClientScriptController } from '../src/client-script/client-script.controller';
const controller = new ClientScriptController() as any;
for (const [method, route, suffix, contentType] of [
  ['streamCommunityResultsTemplates','community-results-templates.js','phab-community-results-templates.js','application/javascript'],
  ['streamCommunityResultsAssets','community-results-assets.json','community-results-assets.json','application/json']
]) {
  assert.equal(typeof controller[method],'function','fixed-name template asset endpoint exists');
  assert.equal(Reflect.getMetadata(PATH_METADATA,controller[method]),route);
  const headers: Record<string,string>={}; let file='';
  controller[method]({setHeader:(key:string,value:string)=>{headers[key]=value;},sendFile:(path:string)=>{file=path;}});
  assert.ok(file.endsWith(suffix));
  assert.ok(headers['Content-Type'].startsWith(contentType));
  assert.equal(headers['Cache-Control'],'no-store, max-age=0');
}
console.log('Template assets: static fixed-name routes, explicit content types and no stale cache passed');
