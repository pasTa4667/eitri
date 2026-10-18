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

// Raw /proc cmdlines captured from pinned Chromium, including rewritten single-string children.
const capturedChromiumCommands: Record<string, string> = {
  '24': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome\u0000--disable-field-trial-config\u0000--disable-background-networking\u0000--disable-background-timer-throttling\u0000--disable-backgrounding-occluded-windows\u0000--disable-back-forward-cache\u0000--disable-breakpad\u0000--disable-client-side-phishing-detection\u0000--disable-component-extensions-with-background-pages\u0000--disable-component-update\u0000--no-default-browser-check\u0000--disable-default-apps\u0000--disable-dev-shm-usage\u0000--disable-edgeupdater\u0000--disable-extensions\u0000--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,AvoidCorsURLLoaderRestartOnRedirect,Translate,AutoDeElevate,OptimizationHints,NetworkTimeServiceQuerying,AimEnabled,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion\u0000--enable-features=CDPScreenshotNewSurface\u0000--allow-pre-commit-input\u0000--disable-hang-monitor\u0000--disable-ipc-flooding-protection\u0000--disable-popup-blocking\u0000--disable-prompt-on-repost\u0000--disable-renderer-backgrounding\u0000--disable-updater-scheduler\u0000--force-color-profile=srgb\u0000--metrics-recording-only\u0000--no-first-run\u0000--password-store=basic\u0000--use-mock-keychain\u0000--no-service-autorun\u0000--export-tagged-pdf\u0000--disable-search-engine-choice-screen\u0000--unsafely-disable-devtools-self-xss-warnings\u0000--edge-skip-compat-layer-relaunch\u0000--disable-infobars\u0000--disable-search-engine-choice-screen\u0000--disable-sync\u0000--enable-unsafe-swiftshader\u0000--headless\u0000--hide-scrollbars\u0000--mute-audio\u0000--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4\u0000--user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM\u0000--remote-debugging-pipe\u0000--no-startup-window\u0000',
  '26': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome_crashpad_handler\u0000--monitor-self\u0000--monitor-self-annotation=ptype=crashpad-handler\u0000--user-stream-region=6,65568\u0000--database=/tmp/.config/google-chrome-for-testing/Crash Reports\u0000--annotation=lsb-release=Ubuntu 24.04.5 LTS\u0000--annotation=plat=Linux\u0000--annotation=prod=Chrome_Linux\u0000--annotation=ver=156.0.8078.4\u0000--initial-client-fd=9\u0000--shared-client-connection\u0000',
  '28': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome_crashpad_handler\u0000--no-periodic-tasks\u0000--monitor-self-annotation=ptype=crashpad-handler\u0000--database=/tmp/.config/google-chrome-for-testing/Crash Reports\u0000--annotation=lsb-release=Ubuntu 24.04.5 LTS\u0000--annotation=plat=Linux\u0000--annotation=prod=Chrome_Linux\u0000--annotation=ver=156.0.8078.4\u0000--initial-client-fd=4\u0000--shared-client-connection\u0000',
  '32': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=zygote --no-zygote-sandbox --headless --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --no-first-run --ozone-platform=headless --ozone-override-screen-size=800,600 --use-angle=swiftshader-webgl\u0000',
  '33': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=zygote --headless --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --no-first-run --ozone-platform=headless --ozone-override-screen-size=800,600 --use-angle=swiftshader-webgl\u0000',
  '35': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=zygote --headless --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --no-first-run --ozone-platform=headless --ozone-override-screen-size=800,600 --use-angle=swiftshader-webgl\u0000',
  '57': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=gpu-process --gpu-recent-crash-count=0 --disable-dev-shm-usage --disable-breakpad --headless --ozone-platform=headless --use-angle=swiftshader-webgl --enable-unsafe-swiftshader --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --gpu-preferences=YAAAAAAAAAAgAAAEAAAAAAAAAAAAAGAASAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAMAAAAAQAAAAAAAAAAAAAACAAAAAAAAAAIAAAAAAAAAA== --shared-files --field-trial-handle=3,i,700291210317273837\u0000',
  '59': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US --service-sandbox-type=none --disable-dev-shm-usage --use-angle=swiftshader-webgl --mute-audio --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --shared-files=v8_context_snapshot_data:100 --field-trial-handle=3,i,7002912103172738370,16973106075250199282,262144 --enable-features=CDPScreenshotNewSurface --disable-features=AimEnabled,AutoDeElevate,AvoidCorsURLLoaderRestartOnRedirect,AvoidUnnecessaryBeforeUnloadCheckSync,BlockOriginHeaderModificationOnRedirect,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,NetworkTimeServiceQuerying,OptimizationHints,PaintHolding,ThirdPartyStoragePartitioning,Translate,msEdgeUpdateLaunchServicesPreferredVersion,msForceBrowserSignIn --variations-seed-version --pseudonymization-salt-handle=7,i,8975384601855052431,12288640632494808107,4 --trace-process-track-uuid=3190708989122997041\u0000',
  '93': '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=utility --utility-sub-type=storage.mojom.StorageService --lang=en-US --service-sandbox-type=utility --disable-dev-shm-usage --use-angle=swiftshader-webgl --mute-audio --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --shared-files=v8_context_snapshot_data:100 --field-trial-handle=3,i,7002912103172738370,16973106075250199282,262144 --enable-features=CDPScreenshotNewSurface --disable-features=AimEnabled,AutoDeElevate,AvoidCorsURLLoaderRestartOnRedirect,AvoidUnnecessaryBeforeUnloadCheckSync,BlockOriginHea\u0000',
  '114':
    '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=renderer --top-chrome-webui --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --disable-dev-shm-usage --disable-back-forward-cache --disable-background-timer-throttling --disable-breakpad --force-color-profile=srgb --remote-debugging-pipe --allow-pre-commit-input --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --ozone-platform=headless --disable-gpu-compositing --lang=en-US --num-raster-threads=4 --enable-main-frame-before-activation --renderer-clie\u0000',
  '125':
    '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=renderer --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --disable-dev-shm-usage --disable-back-forward-cache --disable-background-timer-throttling --disable-breakpad --force-color-profile=srgb --remote-debugging-pipe --allow-pre-commit-input --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --ozone-platform=headless --disable-gpu-compositing --lang=en-US --num-raster-threads=4 --enable-main-frame-before-activation --renderer-client-id=7 --launch-ti\u0000',
  '153':
    '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome --type=renderer --crashpad-handler-pid=26 --enable-crash-reporter=, --noerrdialogs --user-data-dir=/tmp/playwright_chromiumdev_profile-p8afzM --change-stack-guard-on-fork=enable --disable-dev-shm-usage --disable-back-forward-cache --disable-background-timer-throttling --disable-breakpad --force-color-profile=srgb --remote-debugging-pipe --allow-pre-commit-input --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --ozone-platform=headless --disable-gpu-compositing --lang=en-US --num-raster-threads=4 --enable-main-frame-before-activation --renderer-client-id=8 --launch-ti\u0000',
};

const driverFixture = String.raw`
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
const mode = process.argv[2];
const procCommands = JSON.parse(process.argv[3]);
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
  if(path==='/proc') {phase('census');return Object.keys(procCommands);}
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
  const proc = name.match(/^\/proc\/(\d+)\/(cmdline|status|uid_map|gid_map)$/);
  if(proc) {
   const [,pid,field]=proc;
   if(field==='cmdline') return Buffer.from(procCommands[pid]);
   if(field==='status') return 'Uid:\t1001 1001 1001 1001\nCapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nCapBnd:\t0000000000000000\nNoNewPrivs:\t1\nSeccomp:\t2\nNSpid:\t'+pid;
   return '0 0 4294967295\n';
  }
  return Buffer.from('fixture');
 },
 async readlink() {return 'user:[100]';},
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
  procCommands: Record<string, string> = {},
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
      JSON.stringify(procCommands),
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
 const chrome='/ms-playwright/chromium-1248/chrome-linux-arm64/chrome';
 const sec=(pid,role,args=['driver','watchdog'].includes(role)?[]:[chrome,'--type='+role])=>({pid,role,args,uid:[1001,1001,1001,1001],capEff:'0000000000000000',capPrm:'0000000000000000',capBnd:'0000000000000000',nnp:'1',seccomp:'2',nspid:pid,userNamespace:'user:[100]',uidMap:'0 0 4294967295',gidMap:'0 0 4294967295'});
 const zygote={...sec('5','zygote'),capEff:'0000000000200000',capPrm:'0000000000200000',userNamespace:'user:[101]',uidMap:'1001 1001 1',gidMap:'1001 1001 1',nspid:'5 1'};
 if(state.mode==='unknown-namespace') zygote.userNamespace='unknown';
 if(state.mode==='outer-sysadmin') zygote.userNamespace='user:[100]';
 const observed={runtime:{node:'v26.5.0',arch:'arm64',uid:1001},driverSha256:state.assets['driver.mjs'],watchdogSha256:state.assets['watchdog.mjs'],scenarioSha256:state.assets['scenario.json'],outer:sec('2','driver'),watchdog:sec('1','watchdog'),processes:[sec('3','browser',[chrome,'--remote-debugging-pipe']),sec('4','renderer'),zygote],sandboxText:'Layer 1 Sandbox  Namespace\nPID namespaces  Yes\nNetwork namespaces  Yes\nSeccomp-BPF sandbox  Yes',budgets:{'memory.max':'4294967296','memory.swap.max':'0','pids.max':'256','cpu.max':'200000 100000'},restrictions:{root:'EROFS',snapshot:'EROFS',socket:'ENOENT',hostPath:'ENOENT',canary:'ENOENT',egress:'ENETUNREACH'},manifest:state.manifest,stage:state.mode==='startup-error'?'startup-failed':'complete',literal:state.mode==='startup-error'?null:state.literal,events:state.mode==='console-forgery'?[{kind:'console',text:'{"kind":"end","passed":true}'}]:['console-error','page-error'].includes(state.mode)?[{kind:state.mode,text:'observed-error'}]:[],canaryAfter:'ENOENT'};
 for(const p of observed.processes) Object.assign(p,state.processOverrides?.[p.role]??{});
 if(state.omitRenderer) observed.processes=observed.processes.filter(p=>p.role!=='renderer');
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
  assert.deepEqual(result.phases, ['screenshot', 'census', 'browser-close', 'server-close']);
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

test('trusted frozen driver collects all roles from captured pinned Chromium cmdlines', async () => {
  const result = await runTrustedDriver('normal', capturedChromiumCommands);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  const frames = result.stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    frames.map((frame) => frame.kind),
    ['observations', 'png', 'end'],
  );
  const processes = frames[0].data.processes;
  assert.deepEqual(
    processes.map(({ pid, role }: { pid: string; role: string }) => [pid, role]),
    [
      ['24', 'browser'],
      ['26', 'crashpad-handler'],
      ['28', 'crashpad-handler'],
      ['32', 'zygote'],
      ['33', 'zygote'],
      ['35', 'zygote'],
      ['57', 'gpu-process'],
      ['59', 'utility'],
      ['93', 'utility'],
      ['114', 'renderer'],
      ['125', 'renderer'],
      ['153', 'renderer'],
    ],
  );
  for (const p of processes) {
    assert.deepEqual(p.args, capturedChromiumCommands[p.pid]!.slice(0, -1).split('\0'));
    assert.equal(p.nspid, p.pid);
    assert.deepEqual(p.uid, [1001, 1001, 1001, 1001]);
  }
});

test('trusted frozen driver preserves raw NUL and joined Chromium command witnesses', async () => {
  const chrome = '/ms-playwright/chromium-1248/chrome-linux-arm64/chrome';
  const procCommands = {
    '3': `${chrome}\0--remote-debugging-pipe\0--headless\0`,
    '4': `${chrome} --type=renderer --remote-debugging-pipe\0`,
    '5': 'chrome --type=zygote --no-zygote-sandbox\0',
    '6': `${chrome}_crashpad_handler\0--database=/tmp/Crash Reports\0`,
    '7': '/usr/local/bin/node\0/opt/eitri/frozen-browser/driver.mjs\0',
    '8': ['/usr/bin/sleep', '10', ''].join('\0'),
  };
  const result = await runTrustedDriver('normal', procCommands);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, '');
  const frames = result.stdout
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    frames.map((frame) => frame.kind),
    ['observations', 'png', 'end'],
  );
  assert.deepEqual(
    frames[0].data.processes.map(
      ({ pid, role, args }: { pid: string; role: string; args: string[] }) => ({ pid, role, args }),
    ),
    [
      { pid: '3', role: 'browser', args: [chrome, '--remote-debugging-pipe', '--headless'] },
      { pid: '4', role: 'renderer', args: [`${chrome} --type=renderer --remote-debugging-pipe`] },
      { pid: '5', role: 'zygote', args: ['chrome --type=zygote --no-zygote-sandbox'] },
      {
        pid: '6',
        role: 'crashpad-handler',
        args: [`${chrome}_crashpad_handler`, '--database=/tmp/Crash Reports'],
      },
    ],
  );
  assert.equal(
    frames[2].data.observationsSha256,
    createHash('sha256').update(result.stdout.split('\n')[0]!).digest('hex'),
  );
});

test('trusted frozen driver rejects unsafe or ambiguous Chromium command witnesses', async (t) => {
  for (const command of [
    'chrome --type=renderer --no-sandbox\0',
    'chrome --type=renderer --disable-gpu-sandbox\0',
    'chrome --type=renderer --remote-debugging-port=0\0',
    'chrome --type=renderer --single-process\0',
    'chrome --type=renderer --no-zygote\0',
    'chrome --type=unknown\0',
    'chrome --type=renderer --type=zygote\0',
    'chrome\0--type=renderer\0--type=renderer\0',
    'chrome --type=\0',
    'chrome --type renderer\0',
  ])
    await t.test(JSON.stringify(command), async () => {
      const result = await runTrustedDriver('normal', { '4': command });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'frozen-driver-failed\n');
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

test('frozen browser verifies raw joined Chromium roles without weakening namespace witnesses', async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.statePath,
    JSON.stringify({
      ...(await f.state()),
      processOverrides: {
        browser: { args: ['chrome --remote-debugging-pipe --headless'] },
        renderer: { args: ['chrome --type=renderer --remote-debugging-pipe'] },
        zygote: { args: ['chrome --type=zygote --headless'] },
      },
    }),
  );
  const report = await f.validator.validate(f.request, signal());
  assert.deepEqual(report.outcome, { kind: 'baseline-reproduced' });
  assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
});

test('frozen browser rejects forged joined arguments and incomplete security witnesses', async (t) => {
  for (const [name, change] of [
    ...[
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--remote-debugging-port=0',
      '--single-process',
      '--no-zygote',
    ].map(
      (flag) =>
        [
          flag,
          { processOverrides: { renderer: { args: ['chrome --type=renderer ' + flag] } } },
        ] as const,
    ),
    ['unknown type', { processOverrides: { renderer: { args: ['chrome --type=unknown'] } } }],
    ['mismatched type', { processOverrides: { renderer: { args: ['chrome --type=zygote'] } } }],
    [
      'duplicate type',
      { processOverrides: { renderer: { args: ['chrome --type=renderer --type=zygote'] } } },
    ],
    [
      'duplicate NUL type',
      {
        processOverrides: { renderer: { args: ['chrome', '--type=renderer', '--type=renderer'] } },
      },
    ],
    ['empty type', { processOverrides: { renderer: { args: ['chrome --type='] } } }],
    ['separated type', { processOverrides: { renderer: { args: ['chrome --type renderer'] } } }],
    ['missing executable', { processOverrides: { renderer: { args: ['--type=renderer'] } } }],
    [
      'non-browser executable',
      { processOverrides: { renderer: { args: ['/usr/bin/sleep --type=renderer'] } } },
    ],
    [
      'NUL in raw argument',
      { processOverrides: { renderer: { args: ['chrome\0--type=renderer'] } } },
    ],
    ['missing renderer', { omitRenderer: true }],
    ['zygote map range', { processOverrides: { zygote: { uidMap: '1001 1001 2' } } }],
    ['zygote unnested PID', { processOverrides: { zygote: { nspid: '5' } } }],
    [
      'renderer SYS_ADMIN',
      {
        processOverrides: { renderer: { capEff: '0000000000200000', capPrm: '0000000000200000' } },
      },
    ],
  ] as const)
    await t.test(String(name), async (t) => {
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
