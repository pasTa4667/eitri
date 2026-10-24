import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const harness = String.raw`
import {readFile} from 'node:fs/promises';
import {applicationResult} from './test/fixture-application-check-fixture.mjs';
const mode=process.argv[1];
const inventory=JSON.parse(await readFile('./scripts/profile-reconciliation/installed-inputs.json','utf8'));
const original=await readFile('./worker/frozen-browser/application-driver.mjs','utf8');
let reads=0, launches=[];
globalThis.applicationSpawn=(...args)=>{
  launches.push(args);
  if(mode==='timeout') return {error:new Error('timeout')};
  return {status:mode==='exit'?1:0,signal:null,stdout:JSON.stringify(applicationResult('baseline-with-regressions')),stderr:''};
};
globalThis.applicationFs={
  lstat:async()=>({isFile:()=>mode!=='directory',isSymbolicLink:()=>mode==='symlink',nlink:mode==='hardlink'?2:1,size:mode==='oversized'?4*1024**2+1:12}),
  readFile:async()=>{reads++;return Buffer.alloc(mode==='changed-size'?13:12);},
};
const source=original.replace("import { spawnSync } from 'node:child_process';",'const spawnSync=globalThis.applicationSpawn;')
  .replace(/import \{ (?:lstat, )?readFile \} from 'node:fs\/promises';/,'const {lstat,readFile}=globalThis.applicationFs;')
  .replace("'/opt/verify/application.mjs'",JSON.stringify(new URL('./scripts/profile-reconciliation/application.mjs',import.meta.url).href));
const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
let passed=false;
try{await module.runApplication('fixture-profile-v1',inventory);passed=true;}catch{}
console.log(JSON.stringify({passed,reads,launches}));
`;

for (const mode of [
  'normal',
  'directory',
  'symlink',
  'hardlink',
  'oversized',
  'changed-size',
  'exit',
  'timeout',
])
  test(`protected application driver ${mode} preserves bounded subprocess and PNG admission`, () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', harness, mode], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, EITRI_NONCE: 'not-for-project', NODE_OPTIONS: '' },
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.passed, mode === 'normal');
    assert.equal(result.reads, ['normal', 'changed-size'].includes(mode) ? 1 : 0);
    assert.equal(result.launches.length, 1);
    const [file, args, options] = result.launches[0];
    assert.equal(file, '/usr/bin/python3');
    assert.deepEqual(args, [
      '-I',
      '/opt/verify/application-supervisor.py',
      'baseline-with-regressions',
    ]);
    assert.deepEqual(options.env, {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/tmp',
      PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright',
      EITRI_FROZEN_APPLICATION: '1',
    });
    assert.equal(options.timeout, 55000);
    assert.equal(options.maxBuffer, 192 * 1024);
  });
