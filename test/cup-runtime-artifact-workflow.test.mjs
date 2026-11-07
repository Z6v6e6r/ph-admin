import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../.github/workflows/cup-runtime-artifact.yml', import.meta.url), 'utf8');
function identityGuard() {
 const lines = workflow.slice(workflow.indexOf('      - name: Verify exact PR or main source')).split('\n');
 const start = lines.findIndex(line => line.trim() === 'run: |');
 assert.ok(start >= 0);
 const script = [];
 for (const line of lines.slice(start + 1)) {
  if (line.trim() && !line.startsWith('          ')) break;
  script.push(line.slice(10));
 }
 assert.ok(script.length > 5);
 return script.join('\n');
}

test('runtime artifact uses exact PR head or exact main push with read-only permissions', () => {
 assert.match(workflow, /\n  push:\n    branches: \[main\]/);
 assert.match(workflow, /\n  pull_request:\n    branches: \[main\]/);
 const ref = "${{ github.event_name == 'pull_request' && github.event.pull_request.head.sha || github.sha }}";
 assert.ok(workflow.includes(`ref: ${ref}`));
 assert.ok(workflow.includes(`EXPECTED_SHA: ${ref}`));
 assert.match(workflow, /permissions:\n  contents: read\n/);
 assert.doesNotMatch(workflow, /workflow_dispatch:|contents: write|id-token: write/);
 assert.match(workflow, /node --test test\/cup-runtime-artifact-workflow.test.mjs/);
});

test('actual workflow shell rejects wrong event/ref/SHA and dirty source before building', t => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cup-workflow-identity-'));
 t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
 const environment = {PATH:process.env.PATH ?? '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null'};
 const git = (...args) => execFileSync('git',args,{cwd:directory,env:environment,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git('init','--initial-branch=main');
 fs.writeFileSync(path.join(directory,'source.txt'),'synthetic build source\n');
 git('add','source.txt');
 git('-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','synthetic source');
 const sha = git('rev-parse','HEAD');
 const run = change => spawnSync('bash',['--noprofile','--norc','-e','-o','pipefail','-c',identityGuard()],{
  cwd:directory,env:{...environment,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_BASE_REF:'main',EXPECTED_SHA:sha,...change},encoding:'utf8',timeout:5000,
 }).status;
 assert.equal(run({}),0);
 assert.equal(run({GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/1/merge'}),0);
 for(const input of [
  {GITHUB_EVENT_NAME:'workflow_dispatch'}, {GITHUB_REF:'refs/heads/feature'},
  {GITHUB_EVENT_NAME:'pull_request',GITHUB_BASE_REF:'release'}, {EXPECTED_SHA:'0'.repeat(40)},
  {EXPECTED_SHA:'invalid'}, {EXPECTED_SHA:''}, {EXPECTED_SHA:'$(touch should-not-exist)'},
 ]) assert.notEqual(run(input),0,JSON.stringify(input));
 assert.equal(fs.existsSync(path.join(directory,'should-not-exist')),false);
 fs.writeFileSync(path.join(directory,'source.txt'),'modified\n');assert.notEqual(run({}),0);
 fs.writeFileSync(path.join(directory,'source.txt'),'synthetic build source\n');
 fs.writeFileSync(path.join(directory,'unexpected.txt'),'untracked\n');assert.notEqual(run({}),0);
});
