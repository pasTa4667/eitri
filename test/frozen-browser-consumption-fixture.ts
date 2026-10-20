import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../src/frozen-browser.ts';
import type {
  FrozenBrowserConsumptionJournal,
  FrozenBrowserJournal,
} from '../src/frozen-browser.ts';
import { WorkspaceStore, caseId, repositoryId, virtualPath, sha256 } from '../src/workspace.ts';
import { journalRows } from './controller-worker-association-fixture.ts';

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
export const transcript = String.raw`
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
const hash = b => createHash('sha256').update(b).digest('hex');
const path = process.argv[2];
const args = process.argv.slice(3);
if (args.shift() !== '--context' || args.shift() !== 'orbstack') throw Error('context');
const state = JSON.parse(readFileSync(path));
state.calls.push(args);
const save = () => {
 writeFileSync(path+'.next', JSON.stringify(state));
 renameSync(path+'.next', path);
};
const output = value => { save(); process.stdout.write(JSON.stringify(value)); };
const plain = value => { save(); process.stdout.write(value); };
const baseId = 'sha256:57911b2d47725e1d19e25203b82d7c90a3160da1815f78a9c66b42a89dd1ddff';
const derived = 'sha256:' + 'd'.repeat(64), cid = 'c'.repeat(64);
const base = { Id: baseId, Architecture: 'arm64', Os: 'linux', RootFS: {Type: 'layers', Layers: ['sha256:'+'b'.repeat(64)]}, Config: {Env:['HOME=/tmp','PATH=/usr/local/bin:/usr/bin:/bin'], OnBuild:null} };
const opt = name => args[args.indexOf(name)+1];
if (args[0] === 'version') output({Version:'29.4.0', Arch:'arm64', GitCommit:'daa0cb7f'});
else if (args[0] === 'info') output(['name=seccomp,profile=builtin']);
else if (args[0] === 'build') {
 const chunks=[]; let total=0;
 for await (const b of process.stdin) {
  total+=b.length; if(total>40*1024**2) throw Error('context-overflow');
  chunks.push(b);
 }
 const tar=Buffer.concat(chunks); state.contextBytes=tar.length;
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
 state.image=true; plain('COPY complete\n');
} else if (args[0] === 'image' && args[1] === 'inspect') {
 if (args[2].startsWith('eitri-chromium-probe:')) output([base]);
 else if (state.image) output([{...base,Id:derived,RepoTags:[state.tag],RootFS:{Type:'layers',Layers:[...base.RootFS.Layers,'sha256:'+'e'.repeat(64)]},Config:{...base.Config,Labels:state.labels,Entrypoint:['/usr/local/bin/node','/opt/eitri/frozen-browser/watchdog.mjs'],Cmd:[],User:'1001:1001',WorkingDir:'/opt/eitri'}}]);
 else {save(); process.exitCode=1;}
} else if (args[0]==='create') {
 const env=args.flatMap((v,i)=>v==='--env'?[args[i+1]]:[]);
 const policyArg=args.flatMap((v,i)=>v==='--security-opt'?[args[i+1]]:[]).find(v=>v.startsWith('seccomp='));
 state.container={Id:cid,Name:'/'+opt('--name'),Image:derived,Mounts:[],State:{Status:'created',ExitCode:0,OOMKilled:false},
  Config:{Labels:state.labels,User:'1001:1001',WorkingDir:'/opt/eitri',Entrypoint:['/usr/local/bin/node','/opt/eitri/frozen-browser/watchdog.mjs'],Cmd:[],StopTimeout:2,OpenStdin:false,Tty:false,Env:[...base.Config.Env,...env].reverse()},
  HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:null,Memory:4294967296,MemorySwap:4294967296,NanoCpus:2e9,PidsLimit:256,IpcMode:'private',ShmSize:268435456,PublishAllPorts:false,AutoRemove:false,Runtime:'runc',CgroupnsMode:'private',RestartPolicy:{Name:'no',MaximumRetryCount:0},Tmpfs:{'/tmp':'rw,exec,nosuid,size=256m,uid=1001,gid=1001'},Ulimits:[{Name:'core',Hard:0,Soft:0}],SecurityOpt:['no-new-privileges','seccomp='+readFileSync(policyArg.slice(8),'utf8')]}};
 plain(cid+'\n');
} else if(args[0]==='container' && args[1]==='inspect') {
 if(state.container) {
  if(state.container.State.Status==='created') state.appliedInspection={config:state.container.Config,hostConfig:state.container.HostConfig,mounts:state.container.Mounts};
  output([state.container]);
 } else {save();process.exitCode=1;}
} else if(args[0]==='start') {
 state.started=true; state.container.State.Status='exited';
 const bindings=Object.fromEntries(state.container.Config.Env.map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
 const sec=(pid,ppid,nested=false)=>({pid,ppid,startTicks:String(Number(pid)*100),state:'live',uid:[1001,1001,1001,1001],capEff:'0000000000000000',capPrm:'0000000000000000',capBnd:nested?'000001ffffffffff':'0000000000000000',nnp:'1',seccomp:'2',nspid:nested?pid+' 3':pid,userNamespace:nested?'user:[101]':'user:[100]',uidMap:nested?'1001 1001 1':'0 0 4294967295',gidMap:nested?'1001 1001 1':'0 0 4294967295'});
 const parent={...sec('35','33',true),capEff:'0000000000200000',capPrm:'0000000000200000'};
 const processes=[sec('1','0'),sec('2','1'),sec('24','2'),sec('33','24',true),parent,sec('83','33',true),{...sec('119','35',true),state:'zombie'},sec('158','35',true),sec('176','35',true),sec('187','35',true),sec('200','1')];
 const labels=[{pid:'24',startTicks:'2400',role:'browser'},...['158','176','187'].map(pid=>({pid,startTicks:String(Number(pid)*100),role:'renderer'}))];
 const observed={runtime:{node:'v26.5.0',arch:'arm64',uid:1001},driverSha256:state.assets['driver.mjs'],watchdogSha256:state.assets['watchdog.mjs'],scenarioSha256:state.assets['scenario.json'],outer:processes[1],watchdog:processes[0],processes,labels,sandboxText:'Layer 1 Sandbox  Namespace\nPID namespaces  Yes\nNetwork namespaces  Yes\nSeccomp-BPF sandbox  Yes',budgets:{'memory.max':'4294967296','memory.swap.max':'0','pids.max':'256','cpu.max':'200000 100000'},restrictions:{root:'EROFS',snapshot:'EROFS',socket:'ENOENT',hostPath:'ENOENT',canary:'ENOENT',egress:'ENETUNREACH'},manifest:state.manifest,stage:'complete',literal:'A',events:[],canaryAfter:'ENOENT'};
 const frame=(kind,data)=>JSON.stringify({version:1,kind,nonce:bindings.EITRI_NONCE,requestDigest:bindings.EITRI_REQUEST,data});
 const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc(5))),chunk('IEND',Buffer.alloc(0))]);
 const control=frame('observations',observed), artifact=frame('png',{mime:'image/png',base64:png.toString('base64')});
 const wire=control+'\n'+artifact+'\n'+frame('end',{observationsSha256:hash(control),pngSha256:hash(png)})+'\n';
 plain(wire);
} else if((args[0]==='image'||args[0]==='container')&&args[1]==='ls') plain(args[0]==='image'?(state.image?derived+'\n':''):(state.container?cid+'\n':''));
else if(args[0]==='container'&&args[1]==='rm') {if(state.mode==='cleanup-fail'){save();process.exitCode=1;}else{state.removedRunning=state.container.State.Status==='running';state.container=null;plain(cid+'\n');}}
else if(args[0]==='image'&&args[1]==='rm') {state.image=false;plain('removed\n');}
else throw Error('Unrecorded transcript command '+JSON.stringify(args));
`;

export async function consumptionFixture(t: TestContext, mode = 'normal') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eitri-worker-consumption-')));
  const workspaceRoot = join(root, 'workspace'),
    directory = join(root, 'validator'),
    bin = join(root, 'bin');
  for (const path of [workspaceRoot, directory, bin]) await mkdir(path, { mode: 0o700 });
  const statePath = join(root, 'transcript.json');
  await writeFile(statePath, JSON.stringify({ mode, calls: [] }));
  const script = join(bin, 'transcript.mjs');
  await writeFile(script, transcript);
  await writeFile(
    join(bin, 'docker'),
    `#!${process.execPath}\nprocess.argv.splice(2,0,${JSON.stringify(statePath)});await import(${JSON.stringify(new URL(`file://${script}`).href)});\n`,
  );
  await chmod(join(bin, 'docker'), 0o700);
  const previousPath = process.env.PATH;
  process.env.PATH = bin;
  const workspace = await WorkspaceStore.open({
    directory: workspaceRoot,
    regressionDirectory: virtualPath('test/regression'),
  });
  const cid = caseId(randomUUID());
  const provisioned = await workspace.provision({
    caseId: cid,
    repositoryId: repositoryId(randomUUID()),
    baseline: [
      {
        virtualPath: virtualPath('src/index.html'),
        bytes: Buffer.from('<button id="run">Run</button><output id="result"></output>'),
      },
    ],
  });
  assert.equal(provisioned.state, 'ready');
  if (provisioned.state !== 'ready') throw Error('not-ready');
  const frozen = await workspace.freeze(cid, provisioned.checkpoint.revision);
  const raw = await FrozenBrowserValidator.open({ workspace, directory });
  await raw.close();
  const { meta } = journalRows(directory);
  const expectedIdentity = {
    ownerId: String(meta.owner),
    configurationDigest: sha256(meta.configurationDigest),
  };
  const options = { directory, workspace, expectedIdentity, mode: 'consumption-only' as const };
  const request = frozenBrowserRequest({
    frozen,
    action: { caseId: cid, actionId: randomUUID(), epoch: 1 },
    scenarioId: 'synthetic-click-v1',
    role: 'baseline',
    allowanceMs: 60000,
  });
  const handles: FrozenBrowserJournal[] = [];
  t.after(async () => {
    try {
      await Promise.all(handles.map((h) => h.close()));
      await workspace.close();
    } finally {
      process.env.PATH = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  });
  const open = async (): Promise<FrozenBrowserConsumptionJournal> => {
    const handle = await FrozenBrowserValidator.open(options);
    handles.push(handle);
    return handle;
  };
  const journal = await open();
  const accepted = await journal.accept(request, () => true);
  return {
    root,
    directory,
    workspace,
    options,
    request,
    accepted,
    journal,
    open,
    async state(): Promise<{ calls: string[][]; image?: boolean; container?: unknown }> {
      return JSON.parse(await readFile(statePath, 'utf8'));
    },
  };
}
