import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
  readFile,
  chmod,
  readdir,
  symlink,
  link,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import { digest } from '../src/domain.ts';
import { WorkspaceStore, caseId, repositoryId, requestId, virtualPath } from '../src/workspace.ts';

function processWitness(pid: string, ppid: string, nested = false) {
  return {
    pid,
    ppid,
    startTicks: String(Number(pid) * 100),
    state: 'live',
    uid: [1001, 1001, 1001, 1001],
    capEff: '0000000000000000',
    capPrm: '0000000000000000',
    capBnd: nested ? '000001ffffffffff' : '0000000000000000',
    nnp: '1',
    seccomp: '2',
    nspid: nested ? `${pid} 3` : pid,
    userNamespace: nested ? 'user:[101]' : 'user:[100]',
    uidMap: nested ? '1001 1001 1' : '0 0 4294967295',
    gidMap: nested ? '1001 1001 1' : '0 0 4294967295',
  };
}
const kernelProcesses = [
  processWitness('1', '0'),
  processWitness('2', '1'),
  processWitness('24', '2'),
  processWitness('33', '24', true),
  { ...processWitness('35', '33', true), capEff: '0000000000200000', capPrm: '0000000000200000' },
  processWitness('83', '33', true),
  { ...processWitness('119', '35', true), state: 'zombie' },
  processWitness('158', '35', true),
  processWitness('176', '35', true),
  processWitness('187', '35', true),
  processWitness('200', '1'),
];

const driverFixture = String.raw`
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
const mode = process.argv[2];
const procRecords = JSON.parse(process.argv[3]);
let scans=0, statReads=0, cdpReads=0;
const result = {stdout:'',stderr:'',exitCode:0,headers:{},closed:[],phases:[]};
let context, primary, serve;
const message = (page, type, text) => {
 const value = {type:()=>type,text:()=>text};
 page.emit('console',value); context.emit('console',value);
};
const failure = (page) => {
 const error = Error('synthetic-page-error');
 page.emit('pageerror',error); context.emit('weberror',{error:()=>error});
};
const phase = name => {
 result.phases.push(name);
 if (mode === 'late-'+name+'-overflow') message(primary,'log','x'.repeat(1025));
 if (mode === 'late-'+name+'-error') failure(primary);
 if (mode === 'late-'+name+'-count-overflow')
  for(let i=0;i<33;i++) message(primary,'log','bounded');
 if (mode === 'late-'+name+'-bytes-overflow')
  for(let i=0;i<9;i++) message(primary,'log','x'.repeat(1024));
};
class Page extends EventEmitter {
 constructor(sandbox=false) { super(); this.sandbox=sandbox; }
 async goto(url) {
  if (!this.sandbox) {
   serve({method:'GET',url:'/src/index.html'}, {
    writeHead(_status,headers) {result.headers=headers;},end(){}
   });
  }
  return {status:()=>200};
 }
 locator(selector) { return {
  count:async()=>1,
  innerText:async()=>this.sandbox?'sandbox':selector==='#result'?(this.clicked?'B':''):'',
  click:async()=>{
   this.clicked=true;
   if (mode.startsWith('popup-')) {
    const popup=await context.newPage();
    if(mode==='popup-error') failure(popup);
    if(mode==='popup-console-error') message(popup,'error','popup-console-error');
    if(mode==='popup-overflow') message(popup,'log','x'.repeat(1025));
    if(mode==='popup-crash') popup.emit('crash');
   }
   if(mode==='worker') this.emit('worker',{});
   if(mode==='dedicated-worker' || mode==='shared-worker') {
    if(result.headers['content-security-policy'] === "worker-src 'none'")
     message(this,'error','Refused to create a worker');
   }
  }
 }; }
 async screenshot() {phase('screenshot');return Buffer.from('trusted-png-fixture');}
 async close() {}
}
class Context extends EventEmitter {
 count=0;
 async newPage() {
  const page=new Page(this.count++===0);
  if(!page.sandbox && !primary) primary=page;
  this.emit('page',page);
  return page;
 }
 async route() {}
}
const fs = {
 async readdir(path) {
  if(path==='/proc') {
   phase('census'); scans++;
   if(mode==='census-overflow') return Array.from({length:257},(_,i)=>String(i+1));
   return [...procRecords.filter(p=>!(mode==='entries-churn' && scans%2===0 && p.pid==='200')).map(p=>p.pid), 'self', 'sys'];
  }
  return path==='/snapshot/'?['src']:['index.html'];
 },
 async lstat(path) {
  if(!path.startsWith('/snapshot/src')) throw Object.assign(Error(),{code:'ENOENT'});
  const directory=path==='/snapshot/src';
  return {isDirectory:()=>directory,isFile:()=>!directory,nlink:1,size:1,uid:1001,mode:directory?0o555:0o444};
 },
 async readFile(path) {
  const name=String(path);
  if(name.endsWith('/scenario.json')) return readFileSync(new URL('scenario.json', 'file://'+process.argv[1]));
  if (/^\/proc\/\d+\/(cmdline|exe)$/.test(name)) throw Error('forbidden-argv-read');
  const proc = name.match(/^\/proc\/(\d+)\/(stat|status|uid_map|gid_map)$/);
  if(proc) {
   const [,pid,field]=proc;
   const p=procRecords.find(p=>p.pid===pid);
   if(pid==='200' && (mode==='disappearing' || (mode==='disappears-once' && scans===1)))
    throw Object.assign(Error(),{code:'ENOENT'});
   if(pid==='200' && mode==='access-error') throw Object.assign(Error(),{code:'EACCES'});
   if(pid==='119' && mode==='zombie-unreadable') throw Object.assign(Error(),{code:'EACCES'});
   if(field==='stat') {
    statReads++;
    const state=p.state==='zombie' || (mode==='state-churn' && pid==='200' && statReads%2===0)?'Z':statReads%2?'R':'S';
    const ticks=mode==='pid-reuse' && pid==='200'?String(Number(p.startTicks)+statReads):p.startTicks;
    const ppid=mode==='reparent-churn' && pid==='200' && statReads%2===0?'2':p.ppid;
    return p.pid+' (rewritten ) helper) '+state+' '+ppid+' '+Array(17).fill('0').join(' ')+' '+ticks+' 0 0';
   }
   if(field==='status' && mode==='security-churn' && pid==='200') p.capBnd=scans%2?'0000000000000000':'0000000000000001';
   if(field==='status') return 'State:\t'+(p.state==='zombie'?'Z':'S')+'\nPPid:\t'+p.ppid+'\nUid:\t'+p.uid.join(' ')+'\nCapEff:\t'+p.capEff+'\nCapPrm:\t'+p.capPrm+'\nCapBnd:\t'+p.capBnd+'\nNoNewPrivs:\t'+p.nnp+'\nSeccomp:\t'+p.seccomp+'\nNSpid:\t'+p.nspid;
   return p[field==='uid_map'?'uidMap':'gidMap'];
  }
  return Buffer.from('fixture');
 },
 async readlink(path) {
  if(!/^\/proc\/\d+\/ns\/user$/.test(path)) throw Error('unexpected-readlink');
  return procRecords.find(p=>p.pid===path.split('/')[2]).userNamespace;
 },
 async writeFile() {throw Object.assign(Error(),{code:'EROFS'});}
};
const server = {
 once(){},listen(_port,_host,resolve){resolve();},address(){return {port:1234};},
 close(resolve){phase('server-close');result.closed.push('server');resolve();}
};
const socket = {setTimeout(){},once(name,callback){if(name==='error') queueMicrotask(()=>callback({code:'ENETUNREACH'}));},destroy(){}};
const fakeProcess = {
 version:'v26.5.0',arch:'arm64',getuid:()=>1001,execArgv:[],pid:2,
 env:{EITRI_NONCE:'a'.repeat(64),EITRI_REQUEST:'b'.repeat(64)},
 stdout:{write:value=>{result.stdout+=value;}},stderr:{write:value=>{result.stderr+=value;}},
 exit:()=>{throw Error('unexpected-exit');},
 set exitCode(value){result.exitCode=value;}
};
const realm=createContext({process:fakeProcess,Buffer,URL});
const dependencies = {
 'playwright':{chromium:{launch:async()=>({
  newContext:async()=>{context=new Context();return context;},
  newBrowserCDPSession:async()=>({
   send:async name=>{
    if(name!=='SystemInfo.getProcessInfo') throw Error('unexpected-cdp');
    cdpReads++;
    let processInfo=[{id:24,type:'browser'},{id:158,type:'renderer'},{id:176,type:'renderer'},{id:187,type:'renderer'},{id:83,type:'other'}];
    if(mode==='cdp-missing-browser') processInfo=processInfo.filter(p=>p.type!=='browser');
    if(mode==='cdp-missing-renderer') processInfo=processInfo.filter(p=>p.type!=='renderer');
    if(mode==='cdp-duplicate') processInfo.push({id:24,type:'browser'});
    if(mode==='cdp-unmatched') processInfo.push({id:250,type:'renderer'});
    if(mode==='cdp-churn' && cdpReads%2===0) processInfo=processInfo.filter(p=>p.id!==187);
    return {processInfo};
   },detach:async()=>{}
  }),
  close:async()=>{phase('browser-close');result.closed.push('browser');}
 })}},
 'node:fs/promises':fs,
 'node:http':{createServer:handler=>{serve=handler;return server;}},
 'node:crypto':{createHash},'node:net':{default:{connect:()=>socket}}
};
const driver=new SourceTextModule(readFileSync(process.argv[1],'utf8'),{
 context:realm,initializeImportMeta:meta=>{meta.url='file://'+process.argv[1];}
});
await driver.link(specifier=>{
 const exports=dependencies[specifier];
 if(!exports) throw Error('unexpected-import '+specifier);
 return new SyntheticModule(Object.keys(exports),function(){
  for(const [key,value] of Object.entries(exports)) this.setExport(key,value);
 },{context:realm});
});
await driver.evaluate();
process.stdout.write(JSON.stringify(result));
`;

async function runTrustedDriver(
  mode: string,
  processes = kernelProcesses,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  headers: Record<string, string>;
  closed: string[];
  phases: string[];
}> {
  const child = spawn(
    process.execPath,
    [
      '--experimental-vm-modules',
      '--input-type=module',
      '--eval',
      driverFixture,
      fileURLToPath(new URL('../worker/frozen-browser/driver.mjs', import.meta.url)),
      mode,
      JSON.stringify(processes),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const output: Buffer[] = [],
    errors: Buffer[] = [];
  child.stdout.on('data', (bytes: Buffer) => output.push(bytes));
  child.stderr.on('data', (bytes: Buffer) => errors.push(bytes));
  const [code] = await once(child, 'close');
  assert.equal(code, 0, Buffer.concat(errors).toString());
  return JSON.parse(Buffer.concat(output).toString());
}

const transcript = String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
const hash = b => createHash('sha256').update(b).digest('hex');
const path = process.argv[2];
const args = process.argv.slice(3);
if (args.shift() !== '--context' || args.shift() !== 'orbstack') throw Error('context');
const state = JSON.parse(readFileSync(path));
state.calls.push(args);
const save = () => writeFileSync(path, JSON.stringify(state));
const output = value => { save(); process.stdout.write(JSON.stringify(value)); };
const plain = value => { save(); process.stdout.write(value); };
const baseId = 'sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff';
const derived = 'sha256:' + 'd'.repeat(64), cid = 'c'.repeat(64);
const base = { Id: baseId, Architecture: 'arm64', Os: 'linux', RootFS: {Type: 'layers', Layers: ['sha256:'+'b'.repeat(64)]}, Config: {Env:['HOME=/tmp','PATH=/usr/local/bin:/usr/bin:/bin'], OnBuild:null} };
const opt = name => args[args.indexOf(name)+1];
const commandConfig = kind => state.commandConfig?.[kind] ?? {Cmd:[]};
if (args[0] === 'version') output({Version:'29.4.0', Arch:'arm64', GitCommit:'daa0cb7f'});
else if (args[0] === 'info') output(['name=seccomp,profile=builtin']);
else if (args[0] === 'build') {
 const chunks=[]; let total=0;
 for await (const b of process.stdin) {
  total+=b.length; if(total>40*1024**2) throw Error('context-overflow');
  chunks.push(b);
 }
 const tar=Buffer.concat(chunks); state.contextBytes=tar.length;
 if(state.mode==='capture-context') writeFileSync(path+'.tar',tar);
 let offset=0, nextPath; const files={};
 while (offset+512<=tar.length && tar[offset]) {
  const h=tar.subarray(offset,offset+512), size=parseInt(h.toString('ascii',124,136),8)||0;
  const b=tar.subarray(offset+512,offset+512+size);
  if (h.toString('ascii',156,157)==='x') nextPath=b.toString().match(/ path=(.*)\n/)[1];
  else {
   const name=nextPath??h.toString('utf8',0,100).replace(/\0.*$/s,'');
   if (h.toString('ascii',156,157)==='0') files[name]=b;
   nextPath=undefined;
  }
  offset+=512+Math.ceil(size/512)*512;
 }
 if (!files.Dockerfile || /\nRUN /.test(files.Dockerfile.toString())) throw Error('not COPY only');
 state.assets=Object.fromEntries(['driver.mjs','watchdog.mjs','scenario.json'].map(k=>[k,hash(files[k])]));
 state.manifest=Object.entries(files).filter(([p])=>p.startsWith('rootfs/snapshot/')).map(([p,b])=>({path:p.slice(16),size:b.length,sha256:hash(b)})).sort((a,b)=>a.path<b.path?-1:1);
 state.labels=Object.fromEntries(args.flatMap((v,i)=>v==='--label'?[args[i+1].split('=')]:[]));
 state.tag=opt('--tag');
 if (state.mode==='build-hang') { save(); setInterval(()=>{},1000); }
 else { state.image=true; plain('COPY complete\n'); }
} else if (args[0] === 'image' && args[1] === 'inspect') {
 if (args[2].startsWith('eitri-chromium-probe:')) output([base]);
 else if (state.image) output([{...base,Id:derived,RepoTags:[state.tag],RootFS:{Type:'layers',Layers:[...base.RootFS.Layers,'sha256:'+'e'.repeat(64)]},Config:{...base.Config,Labels:state.labels,Entrypoint:['/usr/local/bin/node','/opt/eitri/frozen-browser/watchdog.mjs'],...commandConfig('image'),User:'1001:1001',WorkingDir:'/opt/eitri'}}]);
 else {save(); process.exitCode=1;}
} else if (args[0]==='create') {
 if(state.mode==='create-hang') {save();await new Promise(()=>setInterval(()=>{},1000));}
 const env=args.flatMap((v,i)=>v==='--env'?[args[i+1]]:[]);
 const policyArg=args.flatMap((v,i)=>v==='--security-opt'?[args[i+1]]:[]).find(v=>v.startsWith('seccomp='));
 state.container={Id:cid,Name:'/'+opt('--name'),Image:derived,Mounts:[],State:{Status:'created',ExitCode:0,OOMKilled:false},
  Config:{Labels:state.labels,User:'1001:1001',WorkingDir:'/opt/eitri',Entrypoint:['/usr/local/bin/node','/opt/eitri/frozen-browser/watchdog.mjs'],...commandConfig('container'),StopTimeout:2,OpenStdin:false,Tty:false,Env:[...base.Config.Env,...env].reverse()},
  HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:null,Memory:4294967296,MemorySwap:4294967296,NanoCpus:2e9,PidsLimit:256,IpcMode:'private',ShmSize:268435456,PublishAllPorts:false,AutoRemove:false,Runtime:'runc',CgroupnsMode:'private',RestartPolicy:{Name:'no',MaximumRetryCount:0},Tmpfs:{'/tmp':'rw,exec,nosuid,size=256m,uid=1001,gid=1001'},Ulimits:[{Name:'core',Hard:0,Soft:0}],SecurityOpt:['no-new-privileges','seccomp='+readFileSync(policyArg.slice(8),'utf8')]}};
 if(state.mode==='bad-env') state.container.Config.Env.push('HOME=/forged');
 if(state.mode==='bad-mount') state.container.Mounts.push({Source:'/host',Destination:'/snapshot'});
 plain(cid+'\n');
} else if(args[0]==='container' && args[1]==='inspect') {
 if(state.container) {
  if(state.container.State.Status==='created') state.appliedInspection={config:state.container.Config,hostConfig:state.container.HostConfig,mounts:state.container.Mounts};
  output([state.container]);
 } else {save();process.exitCode=1;}
} else if(args[0]==='start') {
 state.started=true; state.container.State.Status='exited';
 if(state.mode==='execution-hang') {state.container.State.Status='running';save();setInterval(()=>{},1000);}
 else {
 const bindings=Object.fromEntries(state.container.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
 const sec=(pid,ppid,nested=false)=>({pid,ppid,startTicks:String(Number(pid)*100),state:'live',uid:[1001,1001,1001,1001],capEff:'0000000000000000',capPrm:'0000000000000000',capBnd:nested?'000001ffffffffff':'0000000000000000',nnp:'1',seccomp:'2',nspid:nested?pid+' 3':pid,userNamespace:nested?'user:[101]':'user:[100]',uidMap:nested?'1001 1001 1':'0 0 4294967295',gidMap:nested?'1001 1001 1':'0 0 4294967295'});
 const parent={...sec('35','33',true),capEff:'0000000000200000',capPrm:'0000000000200000'};
 if(state.mode==='unknown-namespace') parent.userNamespace='unknown';
 if(state.mode==='outer-sysadmin') parent.userNamespace='user:[100]';
 const processes=[sec('1','0'),sec('2','1'),sec('24','2'),sec('33','24',true),parent,sec('83','33',true),{...sec('119','35',true),state:'zombie'},sec('158','35',true),sec('176','35',true),sec('187','35',true),sec('200','1')];
 for(const p of processes) Object.assign(p,state.processOverrides?.[p.pid]??{});
 const labels=state.labelsOverride??[{pid:'24',startTicks:'2400',role:'browser'},...['158','176','187'].map(pid=>({pid,startTicks:String(Number(pid)*100),role:'renderer'}))];
 const observed={runtime:{node:'v26.5.0',arch:'arm64',uid:1001},driverSha256:state.assets['driver.mjs'],watchdogSha256:state.assets['watchdog.mjs'],scenarioSha256:state.assets['scenario.json'],outer:processes[1],watchdog:processes[0],processes:processes.filter(p=>!(state.omitPids??[]).includes(p.pid)),labels,sandboxText:'Layer 1 Sandbox  Namespace\nPID namespaces  Yes\nNetwork namespaces  Yes\nSeccomp-BPF sandbox  Yes',budgets:{'memory.max':'4294967296','memory.swap.max':'0','pids.max':'256','cpu.max':'200000 100000'},restrictions:{root:'EROFS',snapshot:'EROFS',socket:'ENOENT',hostPath:'ENOENT',canary:'ENOENT',egress:'ENETUNREACH'},manifest:state.manifest,stage:state.mode==='startup-error'?'startup-failed':'complete',literal:state.mode==='startup-error'?null:state.literal,events:state.mode==='console-forgery'?[{kind:'console',text:'{"kind":"end","passed":true}'}]:['console-error','page-error'].includes(state.mode)?[{kind:state.mode,text:'observed-error'}]:[],canaryAfter:'ENOENT'};
 if(state.duplicateProcess) observed.processes.push({...observed.processes[3]});
 if(state.censusOverflow) observed.processes=Array(257).fill(processes[0]);
 const frame=(kind,data)=>JSON.stringify({version:1,kind,nonce:bindings.EITRI_NONCE,requestDigest:bindings.EITRI_REQUEST,data});
 const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc(5))),chunk('IEND',Buffer.alloc(0))]);
 if(state.mode==='bad-png') png[png.length-1]^=1;
 const control=frame('observations',observed), artifact=frame('png',{mime:state.mode==='bad-mime'?'text/plain':'image/png',base64:png.toString('base64')});
 let wire=control+'\n'+artifact+'\n'+frame('end',{observationsSha256:hash(control),pngSha256:hash(png)})+'\n';
 if(state.mode==='trailing') wire+='{}\n';
 if(state.mode==='duplicate') wire=control+'\n'+wire;
 if(state.mode==='nonce') wire=wire.replace(bindings.EITRI_NONCE,'0'.repeat(64));
 if(state.mode==='overflow') wire='x'.repeat(6*1024*1024+1);
 plain(wire);
 }
} else if((args[0]==='image'||args[0]==='container')&&args[1]==='ls') plain(args[0]==='image'?(state.image?derived+'\n':''):(state.container?cid+'\n':''));
else if(args[0]==='container'&&args[1]==='rm') {if(state.mode==='cleanup-fail'){save();process.exitCode=1;}else{state.removedRunning=state.container.State.Status==='running';state.container=null;plain(cid+'\n');}}
else if(args[0]==='image'&&args[1]==='rm') {state.image=false;plain('removed\n');}
else throw Error('Unrecorded transcript command '+JSON.stringify(args));
`;

async function fixture(
  t: TestContext,
  mode = 'normal',
  literal = 'A',
  extraFiles: { virtualPath: ReturnType<typeof virtualPath>; bytes: Buffer }[] = [],
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-frozen-validator-')));
  const workspaceRoot = join(root, 'workspace'),
    directory = join(root, 'validator'),
    bin = join(root, 'bin');
  for (const path of [workspaceRoot, directory, bin]) await mkdir(path, { mode: 0o700 });
  const statePath = join(root, 'transcript.json');
  await writeFile(statePath, JSON.stringify({ mode, literal, calls: [] }));
  const script = join(bin, 'transcript.mjs');
  await writeFile(script, transcript);
  await writeFile(
    join(bin, 'docker'),
    `#!${process.execPath}\nprocess.argv.splice(2,0,${JSON.stringify(statePath)});await import(${JSON.stringify(new URL(`file://${script}`).href)});\n`,
  );
  await chmod(join(bin, 'docker'), 0o700);
  const previousPath = process.env.PATH;
  process.env.PATH = bin;
  const store = await WorkspaceStore.open({
    directory: workspaceRoot,
    regressionDirectory: virtualPath('test/regression'),
  });
  const cid = caseId(randomUUID());
  const html =
    '<button id="run">Run</button><output id="result"></output><script>run.onclick=()=>result.textContent="A"</script>';
  const w = await store.provision({
    caseId: cid,
    repositoryId: repositoryId(randomUUID()),
    baseline: [
      { virtualPath: virtualPath('src/index.html'), bytes: Buffer.from(html) },
      {
        virtualPath: virtualPath('package.json'),
        bytes: Buffer.from('{"scripts":{"test":"node poison.cjs"}}'),
      },
      {
        virtualPath: virtualPath('poison.cjs'),
        bytes: Buffer.from('throw Error("project code must not run")'),
      },
      ...extraFiles,
    ],
  });
  if (w.state !== 'ready') throw Error('not-ready');
  const frozen = await store.freeze(cid, w.checkpoint.revision);
  const validator = await FrozenBrowserValidator.open({ workspace: store, directory });
  const request = frozenBrowserRequest({
    frozen,
    action: { caseId: cid, actionId: randomUUID(), epoch: 0 },
    scenarioId: 'synthetic-click-v1',
    role: 'baseline',
    allowanceMs: 60000,
  });
  t.after(async () => {
    try {
      await validator.close();
      await store.close();
    } finally {
      process.env.PATH = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  });
  return {
    root,
    directory,
    store,
    validator,
    request,
    statePath,
    async state(): Promise<Record<string, unknown>> {
      return JSON.parse(await readFile(statePath, 'utf8'));
    },
  };
}
const signal = () => new AbortController().signal;
async function waitFor(predicate: () => Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw Error('transcript-wait-timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('trusted frozen driver retains complete B and shutdown observations without faults', async () => {
  const result = await runTrustedDriver('normal');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.closed, ['browser', 'server']);
  assert.deepEqual(result.phases, [
    'screenshot',
    'census',
    'census',
    'browser-close',
    'server-close',
  ]);
  const lines = result.stdout
    .trimEnd()
    .split('\n')
    .map((line: string) => JSON.parse(line));
  assert.deepEqual(
    lines.map((frame) => frame.kind),
    ['observations', 'png', 'end'],
  );
  assert.equal(lines[0].data.stage, 'complete');
  assert.equal(lines[0].data.literal, 'B');
  assert.deepEqual(lines[0].data.events, []);
});

test('trusted frozen driver inventories every process without argv or executable reads', async () => {
  const result = await runTrustedDriver('normal');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  const frames = result.stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(frames[0].data.processes, kernelProcesses);
  assert.deepEqual(frames[0].data.labels, [
    { pid: '24', role: 'browser', startTicks: '2400' },
    { pid: '158', role: 'renderer', startTicks: '15800' },
    { pid: '176', role: 'renderer', startTicks: '17600' },
    { pid: '187', role: 'renderer', startTicks: '18700' },
  ]);
  assert.equal(
    frames[2].data.observationsSha256,
    createHash('sha256').update(result.stdout.split('\n')[0]!).digest('hex'),
  );
});

test('trusted frozen driver retries a disappearing scan without omitting a helper', async () => {
  const result = await runTrustedDriver('disappears-once');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout.split('\n')[0]).data.processes, kernelProcesses);
  assert.equal(result.phases.filter((p) => p === 'census').length, 3);
});

test('trusted frozen driver rejects unstable, inaccessible and invalid CDP censuses', async (t) => {
  for (const mode of [
    'disappearing',
    'access-error',
    'zombie-unreadable',
    'pid-reuse',
    'state-churn',
    'reparent-churn',
    'security-churn',
    'entries-churn',
    'cdp-missing-browser',
    'cdp-missing-renderer',
    'cdp-duplicate',
    'cdp-unmatched',
    'cdp-churn',
    'census-overflow',
  ])
    await t.test(mode, async () => {
      const result = await runTrustedDriver(mode);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'frozen-driver-failed\n');
      if (['disappearing', 'pid-reuse'].includes(mode))
        assert.equal(result.phases.filter((p) => p === 'census').length, 3);
    });
});

test('trusted frozen driver fails closed on overflow through final shutdown', async (t) => {
  for (const phase of ['screenshot', 'census', 'browser-close', 'server-close'])
    for (const limit of ['overflow', 'count-overflow', 'bytes-overflow'])
      await t.test(`${phase} ${limit}`, async () => {
        const result = await runTrustedDriver(`late-${phase}-${limit}`);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, 'frozen-driver-failed\n');
        assert.deepEqual(result.closed, ['browser', 'server']);
      });
});

test('trusted frozen driver collects popup and shutdown errors instead of clean B', async (t) => {
  for (const [mode, expected] of [
    ['popup-error', { kind: 'page-error', text: 'synthetic-page-error' }],
    ['popup-console-error', { kind: 'console-error', text: 'popup-console-error' }],
    ['popup-crash', { kind: 'page-error', text: 'page-crash' }],
    ['late-browser-close-error', { kind: 'page-error', text: 'synthetic-page-error' }],
    ['late-server-close-error', { kind: 'page-error', text: 'synthetic-page-error' }],
  ] as const)
    await t.test(mode, async () => {
      const result = await runTrustedDriver(mode);
      assert.equal(result.exitCode, 0);
      const observations = JSON.parse(result.stdout.split('\n')[0]).data;
      assert.deepEqual(observations.events, [expected]);
      assert.equal(observations.literal, mode.startsWith('popup-') ? null : 'B');
    });
});

test('trusted frozen driver rejects popup overflow and unexpected dedicated workers', async (t) => {
  for (const mode of ['popup-overflow', 'worker'])
    await t.test(mode, async () => {
      const result = await runTrustedDriver(mode);
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'frozen-driver-failed\n');
    });
});

test('trusted frozen driver serves a worker restriction and retains worker denial errors', async (t) => {
  for (const mode of ['dedicated-worker', 'shared-worker'])
    await t.test(mode, async () => {
      const result = await runTrustedDriver(mode);
      assert.equal(result.headers['content-security-policy'], "worker-src 'none'");
      assert.equal(result.exitCode, 0);
      const observations = JSON.parse(result.stdout.split('\n')[0]).data;
      assert.deepEqual(observations.events, [
        { kind: 'console-error', text: 'Refused to create a worker' },
      ]);
      assert.equal(observations.stage, 'action-failed');
      assert.equal(observations.literal, null);
    });
});

test('frozen browser COPY context has a short first header recognizable without PAX lookahead', async (t) => {
  const f = await fixture(t, 'capture-context');
  const report = await f.validator.validate(f.request, signal());
  assert.deepEqual(report.outcome, { kind: 'baseline-reproduced' });
  const archive = await readFile(`${f.statePath}.tar`);
  const run = promisify(execFile);
  const full = await run('/usr/bin/tar', ['-tf', `${f.statePath}.tar`]);
  assert.equal(full.stderr, '');
  assert.equal(full.stdout.split('\n')[0], 'rootfs/');
  const peek = join(f.root, 'header.tar');
  await writeFile(peek, archive.subarray(0, 512));
  const sniff = await run('/usr/bin/tar', ['-tf', peek]);
  assert.equal(sniff.stdout, 'rootfs/\n');
  assert.equal(sniff.stderr, '');
  assert.equal(archive.toString('ascii', 257, 265), 'ustar\0' + '00');
  assert.equal(archive.toString('ascii', 156, 157), '5');
  assert.equal(report.evidence?.provenance.contextBytes, archive.length);
  assert.equal(
    report.evidence?.provenance.contextSha256,
    createHash('sha256').update(archive).digest('hex'),
  );
  assert.equal(archive.length <= 40 * 1024 ** 2, true);
  assert.equal(archive.length % 512, 0);
  assert.deepEqual(archive.subarray(-1024), Buffer.alloc(1024));
});

test('frozen browser COPY context fixes trusted asset mode 0555 and preserves snapshot modes and paths', async (t) => {
  const extraFiles = [
    { virtualPath: virtualPath('src/café.txt'), bytes: Buffer.from('UTF8 café 🌱\n') },
    {
      virtualPath: virtualPath(`src/${'é'.repeat(70)}/${'長'.repeat(50)}.bin`),
      bytes: Buffer.from([0, 255, 128, 10, 0, 42]),
    },
  ];
  let extracted: string | undefined;
  const directories = [
    'rootfs',
    'rootfs/snapshot',
    'rootfs/snapshot/src',
    `rootfs/snapshot/src/${'é'.repeat(70)}`,
  ];
  t.after(async () => {
    if (extracted) for (const path of directories) await chmod(join(extracted, path), 0o755);
  });
  const f = await fixture(t, 'capture-context', 'A', extraFiles);
  const report = await f.validator.validate(f.request, signal());
  assert.deepEqual(report.outcome, { kind: 'baseline-reproduced' });
  const run = promisify(execFile);
  const listing = await run('/usr/bin/tar', ['-tvnf', `${f.statePath}.tar`]);
  assert.equal(listing.stderr, '');
  for (const line of listing.stdout.trimEnd().split('\n')) {
    assert.match(line, /^(dr-xr-xr-x|-r--r--r--)\s/);
    assert.match(line, /\s1001(?:\/|\s+)1001\s/);
  }
  extracted = join(f.root, 'extracted');
  await mkdir(extracted);
  const unpack = await run('/usr/bin/tar', ['-xf', `${f.statePath}.tar`, '-C', extracted]);
  assert.equal(unpack.stderr, '');
  assert.deepEqual((await readFile(join(extracted, 'Dockerfile'), 'utf8')).trimEnd().split('\n'), [
    'FROM eitri-chromium-probe:1.64.1-node26.5.0',
    'COPY --chown=0:0 --chmod=0555 driver.mjs watchdog.mjs scenario.json /opt/eitri/frozen-browser/',
    'COPY --chown=1001:1001 rootfs/ /',
    'USER 1001:1001',
    'WORKDIR /opt/eitri',
    'ENTRYPOINT ["/usr/local/bin/node", "/opt/eitri/frozen-browser/watchdog.mjs"]',
    'CMD []',
  ]);
  for (const file of await f.store.readFrozen(f.request.frozen, signal())) {
    const path = join(extracted, 'rootfs/snapshot', file.virtualPath);
    assert.deepEqual(await readFile(path), Buffer.from(file.bytes));
    assert.equal((await stat(path)).mode & 0o777, 0o444);
  }
  for (const path of directories)
    assert.equal((await stat(join(extracted, path))).mode & 0o777, 0o555);
  for (const name of ['Dockerfile', 'driver.mjs', 'watchdog.mjs', 'scenario.json']) {
    assert.deepEqual(
      await readFile(join(extracted, name)),
      await readFile(new URL(`../worker/frozen-browser/${name}`, import.meta.url)),
    );
    assert.equal((await stat(join(extracted, name))).mode & 0o777, 0o444);
  }
  assert.deepEqual((await readdir(extracted)).sort(), [
    'Dockerfile',
    'driver.mjs',
    'rootfs',
    'scenario.json',
    'watchdog.mjs',
  ]);
});

test('frozen browser literal A after B has host evidence, detached cache and persistent idempotency', async (t) => {
  const f = await fixture(t);
  const before = await f.store.read(f.request.frozen.caseId, virtualPath('src/index.html'));
  await f.store.edit(f.request.frozen.caseId, f.request.frozen.revision, {
    requestId: requestId(randomUUID()),
    virtualPath: virtualPath('src/index.html'),
    expectedHash: before.sha256,
    bytes: Buffer.from('B'),
  });
  const first = f.validator.validate(f.request, signal());
  const duplicate = f.validator.validate(f.request, signal());
  const report = await first;
  assert.deepEqual(await duplicate, report);
  assert.deepEqual(
    report.outcome,
    { kind: 'baseline-reproduced' },
    JSON.stringify(await f.state()),
  );
  assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
  assert.equal(report.evidence?.observations.literal, 'A');
  assert.equal(JSON.stringify(report).includes(f.root), false);
  assert.equal(report.evidence?.png.mime, 'image/png');
  assert.match(String(report.evidence?.provenance.requestDigest), /^[0-9a-f]{64}$/);
  assert.equal(report.evidence?.provenance.contextBytes, (await f.state()).contextBytes);
  assert.equal(
    Buffer.from(
      (await f.store.read(f.request.frozen.caseId, virtualPath('src/index.html'))).bytes,
    ).toString(),
    'B',
  );
  assert.deepEqual(await readdir(join(f.root, 'workspace', 'exports')), []);
  const calls = (await f.state()).calls;
  if (!report.evidence) throw Error('missing-evidence');
  report.evidence.observations.literal = 'forged';
  const cached = await f.validator.validate(f.request, signal());
  assert.equal(cached.evidence?.observations.literal, 'A');
  assert.deepEqual((await f.state()).calls, calls);
  await assert.rejects(
    f.validator.validate(frozenBrowserRequest({ ...f.request, role: 'candidate' }), signal()),
    /identity-conflict/,
  );
  await f.validator.close();
  const reopened = await FrozenBrowserValidator.open({
    workspace: f.store,
    directory: f.directory,
  });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.validate(f.request, signal()), cached);
  assert.deepEqual((await f.state()).calls, calls);
});

test('frozen browser empty inspected Cmd forms persist canonically and reopen without effects', async (t) => {
  const forms = [
    ['omitted', {}],
    ['null', { Cmd: null }],
    ['empty array', { Cmd: [] }],
  ] as const;
  for (const [imageName, image] of forms)
    for (const [containerName, container] of forms)
      await t.test(`image ${imageName}, container ${containerName}`, async (t) => {
        const f = await fixture(t);
        await writeFile(
          f.statePath,
          JSON.stringify({ ...(await f.state()), commandConfig: { image, container } }),
        );
        const report = await f.validator.validate(f.request, signal());
        assert.deepEqual(report.outcome, { kind: 'baseline-reproduced' });
        assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
        const state = await f.state();
        const raw = state.appliedInspection as {
          config: Record<string, unknown>;
          hostConfig: Record<string, unknown>;
          mounts: unknown[];
        };
        assert.equal(Object.hasOwn(raw.config, 'Cmd'), Object.hasOwn(container, 'Cmd'));
        assert.deepEqual(raw.config.Cmd, 'Cmd' in container ? container.Cmd : undefined);
        assert.ok(report.evidence);
        const applied = report.evidence.provenance.applied;
        assert.deepEqual((applied.config as Record<string, unknown>).Cmd, []);
        assert.equal(applied.inspectionSha256, digest(raw));
        if (containerName !== 'empty array')
          assert.notEqual(
            applied.inspectionSha256,
            digest({ ...raw, config: { ...raw.config, Cmd: [] } }),
          );
        await f.validator.close();
        const db = new DatabaseSync(join(f.directory, 'journal.sqlite'), { readOnly: true });
        try {
          const value = JSON.parse(
            String(db.prepare('SELECT body FROM runs WHERE id=1').get()?.body),
          );
          assert.deepEqual(value.result.report.evidence.provenance.applied.config.Cmd, []);
        } finally {
          db.close();
        }
        const reopened = await FrozenBrowserValidator.open({
          workspace: f.store,
          directory: f.directory,
        });
        t.after(() => reopened.close());
        assert.deepEqual(await reopened.validate(f.request, signal()), report);
        assert.deepEqual((await f.state()).calls, state.calls);
      });
});

test('frozen browser rejects nonempty and malformed raw Cmd before container start', async (t) => {
  for (const kind of ['image', 'container'])
    for (const cmd of [
      ['--unexpected'],
      [null],
      [1],
      [[]],
      '',
      'node',
      {},
      { length: 0 },
      false,
      0,
    ])
      await t.test(`${kind} Cmd ${JSON.stringify(cmd)}`, async (t) => {
        const f = await fixture(t);
        await writeFile(
          f.statePath,
          JSON.stringify({ ...(await f.state()), commandConfig: { [kind]: { Cmd: cmd } } }),
        );
        const report = await f.validator.validate(f.request, signal());
        assert.deepEqual(report.outcome, {
          kind: 'infrastructure-failed',
          code: 'frozen-browser-check-failed',
        });
        assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
        assert.equal(report.evidence, null);
        const state = await f.state();
        assert.equal(state.started, undefined);
        assert.equal(
          (state.calls as string[][]).some((args) => args[0] === 'create'),
          kind === 'container',
        );
        await f.validator.close();
        const reopened = await FrozenBrowserValidator.open({
          workspace: f.store,
          directory: f.directory,
        });
        t.after(() => reopened.close());
        assert.deepEqual(await reopened.validate(f.request, signal()), report);
        assert.deepEqual((await f.state()).calls, state.calls);
      });
});

test('frozen browser reopen rejects noncanonical persisted Cmd in recorded and settled evidence', async (t) => {
  for (const kind of ['recorded', 'settled'])
    await t.test(kind, async (t) => {
      const f = await fixture(t);
      assert.deepEqual((await f.validator.validate(f.request, signal())).outcome, {
        kind: 'baseline-reproduced',
      });
      await f.validator.close();
      const calls = (await f.state()).calls;
      const marker = await readFile(join(f.directory, 'owner.json'));
      const db = new DatabaseSync(join(f.directory, 'journal.sqlite'));
      try {
        const body = String(db.prepare('SELECT body FROM runs WHERE id=1').get()?.body);
        for (const cmd of [
          undefined,
          null,
          ['--unexpected'],
          [null],
          [1],
          [[]],
          '',
          'node',
          {},
          { length: 0 },
          false,
          0,
        ]) {
          const value = JSON.parse(body);
          if (kind === 'recorded') {
            const { outcome, evidence } = value.result.report;
            value.result = { kind, outcome, evidence };
          }
          const saved = kind === 'recorded' ? value.result : value.result.report;
          if (cmd === undefined) delete saved.evidence.provenance.applied.config.Cmd;
          else saved.evidence.provenance.applied.config.Cmd = cmd;
          db.prepare('UPDATE runs SET body=?,digest=? WHERE id=1').run(
            JSON.stringify(value),
            digest(value),
          );
          await assert.rejects(
            FrozenBrowserValidator.open({ workspace: f.store, directory: f.directory }),
            cmd === undefined ? /invalid-frozen-browser-fields/ : /corrupt-committed-bindings/,
            `${kind} Cmd ${JSON.stringify(cmd)}`,
          );
        }
      } finally {
        db.close();
      }
      assert.deepEqual((await f.state()).calls, calls);
      assert.deepEqual(await readFile(join(f.directory, 'owner.json')), marker);
    });
});

test('frozen browser classifies protected roles and unrelated startup or literal failures', async (t) => {
  for (const [role, literal, mode, expected] of [
    ['baseline', 'B', 'normal', 'baseline-not-reproduced'],
    ['candidate', 'B', 'normal', 'candidate-passed'],
    ['candidate', 'B', 'console-error', 'unrelated-failure'],
    ['candidate', 'B', 'page-error', 'unrelated-failure'],
    ['candidate', 'A', 'normal', 'candidate-failed'],
    ['baseline', 'C', 'normal', 'unrelated-failure'],
    ['baseline', 'A', 'startup-error', 'unrelated-failure'],
    ['baseline', 'A', 'console-forgery', 'baseline-reproduced'],
  ])
    await t.test(`${role} ${literal} ${mode}`, async (t) => {
      const f = await fixture(t, mode, literal);
      const request = frozenBrowserRequest({ ...f.request, role });
      assert.equal((await f.validator.validate(request, signal())).outcome.kind, expected);
    });
});

test('frozen browser rejects malformed protocol and containment transcripts before classification', async (t) => {
  for (const mode of [
    'trailing',
    'duplicate',
    'nonce',
    'overflow',
    'bad-mime',
    'bad-png',
    'unknown-namespace',
    'outer-sysadmin',
    'bad-env',
    'bad-mount',
  ])
    await t.test(mode, async (t) => {
      const f = await fixture(t, mode);
      const r = await f.validator.validate(f.request, signal());
      assert.deepEqual(r.outcome, {
        kind: 'infrastructure-failed',
        code: 'frozen-browser-check-failed',
      });
      assert.deepEqual(r.cleanup, { kind: 'owned-removed', cache: 'retained' });
      if (mode === 'bad-env' || mode === 'bad-mount')
        assert.equal((await f.state()).started, undefined);
    });
});

test('frozen browser accepts the nested census including an unknown helper and zombie', async (t) => {
  const f = await fixture(t);
  const report = await f.validator.validate(f.request, signal());
  assert.deepEqual(report.outcome, { kind: 'baseline-reproduced' });
  assert.deepEqual(report.evidence?.observations.processes, kernelProcesses);
});

test('frozen browser rejects invalid kernel identity, labels and security on every process', async (t) => {
  const sysadmin = { capEff: '0000000000200000', capPrm: '0000000000200000' };
  const browser = { pid: '24', startTicks: '2400', role: 'browser' };
  const renderer = { pid: '158', startTicks: '15800', role: 'renderer' };
  const mutations: [string, Record<string, unknown>][] = [
    ...['1', '2', '24', '200'].flatMap((pid) =>
      ['capEff', 'capPrm', 'capBnd'].map(
        (mask) =>
          [
            `initial ${pid} ${mask}`,
            { processOverrides: { [pid]: { [mask]: '0000000000200000' } } },
          ] as [string, Record<string, unknown>],
      ),
    ),
    ...['33', '35', '83', '119', '158'].map(
      (pid) =>
        [
          `nested ${pid} bounding`,
          { processOverrides: { [pid]: { capBnd: '0000000000000001' } } },
        ] as [string, Record<string, unknown>],
    ),
    ['unknown helper SYS_ADMIN', { processOverrides: { '200': sysadmin } }],
    ['nested service SYS_ADMIN', { processOverrides: { '83': sysadmin } }],
    ['indirect renderer ancestor SYS_ADMIN', { processOverrides: { '33': sysadmin } }],
    ['renderer SYS_ADMIN', { processOverrides: { '158': sysadmin } }],
    ['zombie SYS_ADMIN', { processOverrides: { '119': sysadmin } }],
    ['parent zombie', { processOverrides: { '35': { state: 'zombie' } } }],
    ['parent namespace mismatch', { processOverrides: { '35': { userNamespace: 'user:[102]' } } }],
    ['parent effective only', { processOverrides: { '35': { capPrm: '0000000000000000' } } }],
    [
      'parent other capability',
      { processOverrides: { '35': { capEff: '0000000000000001', capPrm: '0000000000000001' } } },
    ],
    ['browser not direct driver child', { processOverrides: { '24': { ppid: '1' } } }],
    [
      'browser nested',
      {
        processOverrides: {
          '24': {
            userNamespace: 'user:[101]',
            uidMap: '1001 1001 1',
            gidMap: '1001 1001 1',
            nspid: '24 2',
          },
        },
      },
    ],
    ['renderer outside browser ancestry', { processOverrides: { '33': { ppid: '2' } } }],
    ...['33', '35', '83', '119', '158'].flatMap(
      (pid) =>
        [
          [`nested ${pid} uid map`, { processOverrides: { [pid]: { uidMap: '1001 1001 2' } } }],
          [
            `nested ${pid} gid map`,
            { processOverrides: { [pid]: { gidMap: '1001 1001 1\n1002 1002 1' } } },
          ],
          [`nested ${pid} NSpid`, { processOverrides: { [pid]: { nspid: pid } } }],
        ] as [string, Record<string, unknown>][],
    ),
    ['helper UID', { processOverrides: { '200': { uid: [0, 0, 0, 0] } } }],
    ['helper NNP', { processOverrides: { '200': { nnp: '0' } } }],
    ['zombie seccomp', { processOverrides: { '119': { seccomp: '0' } } }],
    ['helper namespace', { processOverrides: { '200': { userNamespace: 'unknown' } } }],
    ['missing browser label', { labelsOverride: [renderer] }],
    ['missing renderer label', { labelsOverride: [browser] }],
    ['duplicate browser label', { labelsOverride: [browser, browser, renderer] }],
    [
      'conflicting label',
      { labelsOverride: [browser, renderer, { ...renderer, role: 'browser' }] },
    ],
    [
      'multiple browsers',
      { labelsOverride: [browser, renderer, { pid: '83', startTicks: '8300', role: 'browser' }] },
    ],
    ['unmatched renderer label', { labelsOverride: [browser, { ...renderer, pid: '250' }] }],
    ['PID reuse label', { labelsOverride: [browser, { ...renderer, startTicks: '15801' }] }],
    [
      'zombie renderer label',
      { labelsOverride: [browser, { pid: '119', startTicks: '11900', role: 'renderer' }] },
    ],
    ['zombie browser', { processOverrides: { '24': { state: 'zombie' } } }],
    ['missing parent', { omitPids: ['33'] }],
    ['missing outer census record', { omitPids: ['2'] }],
    ['cycle', { processOverrides: { '33': { ppid: '35', startTicks: '3500' } } }],
    ['parent younger than child', { processOverrides: { '33': { startTicks: '3600' } } }],
    ['duplicate PID', { duplicateProcess: true }],
    ['census overflow', { censusOverflow: true }],
  ];
  for (const [name, change] of mutations)
    await t.test(name, async (t) => {
      const f = await fixture(t);
      await writeFile(f.statePath, JSON.stringify({ ...(await f.state()), ...change }));
      const report = await f.validator.validate(f.request, signal());
      assert.deepEqual(report.outcome, {
        kind: 'infrastructure-failed',
        code: 'frozen-browser-check-failed',
      });
      assert.equal(report.evidence, null);
      assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
    });
});

test('frozen browser accepts zero nested bounding masks without granting capabilities', async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.statePath,
    JSON.stringify({
      ...(await f.state()),
      processOverrides: Object.fromEntries(
        ['33', '35', '83', '119', '158', '176', '187'].map((pid) => [
          pid,
          { capBnd: '0000000000000000' },
        ]),
      ),
    }),
  );
  assert.deepEqual((await f.validator.validate(f.request, signal())).outcome, {
    kind: 'baseline-reproduced',
  });
});

test('frozen browser cancellation and close remove the running container even without awaiting validation', async (t) => {
  const f = await fixture(t, 'execution-hang');
  const controller = new AbortController();
  const running = f.validator.validate(f.request, controller.signal);
  await waitFor(async () => (await f.state()).started === true);
  await assert.rejects(
    f.validator.validate(
      frozenBrowserRequest({
        ...f.request,
        action: { ...f.request.action, actionId: randomUUID() },
      }),
      signal(),
    ),
    /busy/,
  );
  controller.abort();
  await f.validator.close();
  assert.deepEqual((await running).outcome, {
    kind: 'cancelled',
    code: 'cancelled-or-allowance-exhausted',
  });
  assert.equal((await f.state()).removedRunning, true);
  await assert.rejects(f.validator.validate(f.request, signal()), /closed/);
});

test('frozen browser lost build remains uncertain and blocks new attempts across reopen', async (t) => {
  const f = await fixture(t, 'build-hang');
  const controller = new AbortController();
  const running = f.validator.validate(f.request, controller.signal);
  await waitFor(async () => (await f.state()).contextBytes !== undefined);
  controller.abort();
  const report = await running;
  assert.deepEqual(report.outcome, { kind: 'uncertain', code: 'daemon-build-unresolved' });
  assert.deepEqual(report.cleanup, {
    kind: 'incomplete',
    cache: 'retained',
    code: 'daemon-build-unresolved',
  });
  await f.validator.close();
  const reopened = await FrozenBrowserValidator.open({
    workspace: f.store,
    directory: f.directory,
  });
  t.after(() => reopened.close());
  await assert.rejects(
    reopened.validate(
      frozenBrowserRequest({
        ...f.request,
        action: { ...f.request.action, actionId: randomUUID() },
      }),
      signal(),
    ),
    /daemon-build-unresolved/,
  );
  assert.equal((await reopened.validate(f.request, signal())).cleanup.kind, 'incomplete');
});

test('frozen browser exact boundary rejects extra fields and unrecorded revisions without Docker effects', async (t) => {
  const f = await fixture(t);
  assert.throws(() => frozenBrowserRequest({ ...f.request, command: 'arbitrary' }), /fields/);
  assert.throws(() => frozenBrowserRequest({ ...f.request, allowanceMs: 60001 }), /number/);
  assert.throws(
    () => frozenBrowserRequest({ ...f.request, action: { ...f.request.action, epoch: -1 } }),
    /number/,
  );
  const r = await f.validator.validate(
    frozenBrowserRequest({
      ...f.request,
      frozen: { ...f.request.frozen, revision: '1'.repeat(40) },
    }),
    signal(),
  );
  assert.deepEqual(r.outcome, {
    kind: 'infrastructure-failed',
    code: 'frozen-browser-check-failed',
  });
  assert.deepEqual(r.cleanup, { kind: 'not-needed', cache: 'retained' });
  assert.deepEqual((await f.state()).calls, []);
});

test('frozen browser reservations are nonrefundable and persist through all 16 failed attempts', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 16; i++) {
    const request = frozenBrowserRequest({
      ...f.request,
      frozen: { ...f.request.frozen, revision: '1'.repeat(40) },
      action: { ...f.request.action, actionId: randomUUID() },
    });
    assert.equal(
      (await f.validator.validate(request, signal())).outcome.kind,
      'infrastructure-failed',
    );
  }
  await f.validator.close();
  const reopened = await FrozenBrowserValidator.open({
    workspace: f.store,
    directory: f.directory,
  });
  t.after(() => reopened.close());
  await assert.rejects(reopened.validate(f.request, signal()), /lifetime-limit/);
  const db = new DatabaseSync(join(f.directory, 'journal.sqlite'), { readOnly: true });
  try {
    const row = db.prepare('SELECT body FROM meta').get();
    assert.equal(JSON.parse(String(row?.body)).contribution, 640 * 1024 ** 2);
  } finally {
    db.close();
  }
});

test('frozen browser rejects unowned, linked, missing-accounting and replaced stores without adoption', async (t) => {
  for (const mode of ['unowned', 'symlink', 'hardlink', 'accounting'])
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      await f.validator.close();
      const journal = join(f.directory, 'journal.sqlite');
      if (mode === 'unowned') await writeFile(join(f.directory, 'unexpected'), 'sentinel');
      if (mode === 'symlink' || mode === 'hardlink') {
        const saved = join(f.root, 'saved.sqlite');
        await writeFile(saved, await readFile(journal), { mode: 0o600 });
        await rm(journal);
        if (mode === 'symlink') await symlink(saved, journal);
        else await link(saved, journal);
      }
      if (mode === 'accounting') {
        const db = new DatabaseSync(journal);
        db.exec('DELETE FROM meta');
        db.close();
      }
      await assert.rejects(
        FrozenBrowserValidator.open({ workspace: f.store, directory: f.directory }),
        /validator|unsafe/,
      );
      if (mode === 'unowned')
        assert.equal(await readFile(join(f.directory, 'unexpected'), 'utf8'), 'sentinel');
    });
});

test(
  'frozen browser allows native SQLite hot-journal rollback before recovery validation',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    await f.validator.close();
    const script = join(f.root, 'transaction.mjs');
    await writeFile(
      script,
      `import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(join(f.directory, 'journal.sqlite'))}); db.exec("PRAGMA cache_size=1; BEGIN IMMEDIATE; UPDATE meta SET body=printf('%100000s','x');"); process.stdout.write('ready'); setInterval(()=>{},1000);`,
    );
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => child.kill('SIGKILL'));
    await once(child.stdout, 'data');
    assert.equal((await readdir(f.directory)).includes('journal.sqlite-journal'), true);
    child.kill('SIGKILL');
    await once(child, 'close');
    const reopened = await FrozenBrowserValidator.open({
      workspace: f.store,
      directory: f.directory,
    });
    t.after(() => reopened.close());
    assert.equal(
      (await reopened.validate(f.request, signal())).outcome.kind,
      'baseline-reproduced',
    );
  },
);

test(
  'frozen browser actual host death distinguishes pending, committed and acknowledged outcomes without replay',
  { timeout: 30000 },
  async (t) => {
    for (const phase of ['before-outcome-commit', 'after-outcome-commit', 'before-acknowledgment'])
      await t.test(phase, async (t) => {
        const f = await fixture(t);
        await f.validator.close();
        await f.store.close();
        const script = join(f.root, 'crash-host.mjs');
        await writeFile(
          script,
          `
      import { DatabaseSync } from 'node:sqlite';
      import { FrozenBrowserValidator, frozenBrowserRequest } from ${JSON.stringify(new URL('../src/frozen-browser.ts', import.meta.url).href)};
      import { WorkspaceStore, virtualPath } from ${JSON.stringify(new URL('../src/workspace.ts', import.meta.url).href)};
      let committing = '';
      const checkpoint = () => { process.stdout.write('checkpoint'); process.kill(process.pid, 'SIGSTOP'); };
      const originalPrepare = DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare = function(sql) {
        const stmt = Reflect.apply(originalPrepare, this, [sql]);
        if (!sql.startsWith('INSERT INTO runs')) return stmt;
        return new Proxy(stmt, { get(target, prop) {
          if (prop === 'run') return (...args) => {
            const value = JSON.parse(args[1]); committing = value.result.kind;
            if (${JSON.stringify(phase)} === 'before-outcome-commit' && committing === 'recorded') checkpoint();
            return Reflect.apply(target.run, target, args);
          };
          return Reflect.get(target, prop, target);
        }});
      };
      const originalExec = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function(sql) {
        const result = Reflect.apply(originalExec, this, [sql]);
        if (sql === 'COMMIT' && ((${JSON.stringify(phase)} === 'after-outcome-commit' && committing === 'recorded') ||
            (${JSON.stringify(phase)} === 'before-acknowledgment' && committing === 'settled'))) checkpoint();
        return result;
      };
      const store = await WorkspaceStore.open({directory:${JSON.stringify(join(f.root, 'workspace'))},regressionDirectory:virtualPath('test/regression')});
      const validator = await FrozenBrowserValidator.open({workspace:store,directory:${JSON.stringify(f.directory)}});
      await validator.validate(frozenBrowserRequest(${JSON.stringify(f.request)}), new AbortController().signal);
    `,
        );
        const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
        t.after(() => child.kill('SIGKILL'));
        await once(child.stdout, 'data');
        child.kill('SIGKILL');
        await once(child, 'close');
        const store = await WorkspaceStore.open({
          directory: join(f.root, 'workspace'),
          regressionDirectory: virtualPath('test/regression'),
        });
        const reopened = await FrozenBrowserValidator.open({
          workspace: store,
          directory: f.directory,
        });
        t.after(async () => {
          await reopened.close();
          await store.close();
        });
        const first = await reopened.validate(f.request, signal());
        assert.equal(
          first.outcome.kind,
          phase === 'before-outcome-commit' ? 'uncertain' : 'baseline-reproduced',
        );
        assert.equal(first.evidence === null, phase === 'before-outcome-commit');
        assert.deepEqual(first.cleanup, { kind: 'owned-removed', cache: 'retained' });
        const calls = (await f.state()).calls;
        assert.deepEqual(await reopened.validate(f.request, signal()), first);
        assert.deepEqual((await f.state()).calls, calls);
      });
  },
);

test('frozen browser committed observation survives failed cleanup and exact repeats do not rerun', async (t) => {
  const f = await fixture(t, 'cleanup-fail');
  const first = await f.validator.validate(f.request, signal());
  assert.equal(first.outcome.kind, 'baseline-reproduced');
  assert.deepEqual(first.cleanup, {
    kind: 'incomplete',
    cache: 'retained',
    code: 'owned-cleanup-unconfirmed',
  });
  await f.validator.close();
  const reopened = await FrozenBrowserValidator.open({
    workspace: f.store,
    directory: f.directory,
  });
  t.after(() => reopened.close());
  const calls = (await f.state()).calls;
  assert.deepEqual(await reopened.validate(f.request, signal()), first);
  assert.deepEqual((await f.state()).calls, calls);
});

test('frozen browser lost create response does not misreport a still-pending named effect as removed', async (t) => {
  const f = await fixture(t, 'create-hang');
  const controller = new AbortController();
  const running = f.validator.validate(f.request, controller.signal);
  await waitFor(async () => {
    const state = await f.state();
    return (
      Array.isArray(state.calls) &&
      state.calls.some((call: unknown) => Array.isArray(call) && call[0] === 'create')
    );
  });
  controller.abort();
  const report = await running;
  assert.equal(report.outcome.kind, 'cancelled');
  assert.deepEqual(report.cleanup, {
    kind: 'incomplete',
    cache: 'retained',
    code: 'owned-cleanup-unconfirmed',
  });
  await f.validator.close();
  const reopened = await FrozenBrowserValidator.open({
    workspace: f.store,
    directory: f.directory,
  });
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.validate(f.request, signal()), report);
});

test('frozen browser refuses an eligible committed outcome without its complete durable evidence', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.validator.validate(f.request, signal())).outcome.kind,
    'baseline-reproduced',
  );
  await f.validator.close();
  const marker = await readFile(join(f.directory, 'owner.json'));
  const db = new DatabaseSync(join(f.directory, 'journal.sqlite'));
  try {
    const row = db.prepare('SELECT body FROM runs WHERE id=1').get();
    const value = JSON.parse(String(row?.body));
    value.result.report.evidence = null;
    db.prepare('UPDATE runs SET body=?,digest=? WHERE id=1').run(
      JSON.stringify(value),
      digest(value),
    );
  } finally {
    db.close();
  }
  await assert.rejects(
    FrozenBrowserValidator.open({ workspace: f.store, directory: f.directory }),
    /missing-committed-evidence/,
  );
  assert.deepEqual(await readFile(join(f.directory, 'owner.json')), marker);
});
