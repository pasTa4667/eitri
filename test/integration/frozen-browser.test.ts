import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { channel } from 'node:diagnostics_channel';
import { ChildProcess } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { checksum, validateOutput } from '../../src/artifacts.ts';
import { FrozenBrowserValidator, frozenBrowserRequest } from '../../src/frozen-browser.ts';
import type { FrozenBrowserReport, FrozenBrowserRequest } from '../../src/frozen-browser.ts';
import {
  WorkspaceStore,
  caseId,
  repositoryId,
  requestId,
  virtualPath,
} from '../../src/workspace.ts';

if (process.env.EITRI_FROZEN_DOCKER_ACCEPTANCE !== '1')
  throw new Error(
    'Actual Docker acceptance requires fresh parent security review and EITRI_FROZEN_DOCKER_ACCEPTANCE=1. This suite never substitutes transcripts or skips.',
  );

const baseTag = 'eitri-chromium-probe:1.64.1-node26.5.0';
async function docker(args: string[]): Promise<string> {
  const child = spawn('docker', ['--context', 'orbstack', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [],
    stderr: Buffer[] = [];
  child.stdout.on('data', (b: Buffer) => stdout.push(b));
  child.stderr.on('data', (b: Buffer) => stderr.push(b));
  const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0, Buffer.concat(stderr).toString());
    return Buffer.concat(stdout).toString();
  } finally {
    clearTimeout(timer);
  }
}
const html = (value: string, extra = '') =>
  `<button id="run">Run</button><output id="result"></output><script>${extra};run.onclick=()=>result.textContent=${JSON.stringify(value)}</script>`;
async function fixture(t: TestContext, initial = html('A')) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'eitri-frozen-docker-'));
  const cleanups: Array<() => void | Promise<unknown>> = [];
  const defer = (cleanup: () => void | Promise<unknown>) => {
    cleanups.push(cleanup);
  };
  t.after(async () => {
    const failures: unknown[] = [];
    for (const cleanup of cleanups.toReversed()) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, 'fixture cleanup failed');
  });
  console.log(
    `Fixture state retained at ${temporaryRoot} (validator: ${join(temporaryRoot, 'validator')})`,
  );
  const root = await realpath(temporaryRoot);
  const directory = join(root, 'validator'),
    workspaceDirectory = join(root, 'workspace');
  await mkdir(directory, { mode: 0o700 });
  await mkdir(workspaceDirectory, { mode: 0o700 });
  const store = await WorkspaceStore.open({
    directory: workspaceDirectory,
    regressionDirectory: virtualPath('test/regression'),
  });
  defer(() => store.close());
  const cid = caseId(randomUUID());
  const workspace = await store.provision({
    caseId: cid,
    repositoryId: repositoryId(randomUUID()),
    baseline: [
      { virtualPath: virtualPath('src/index.html'), bytes: Buffer.from(initial) },
      {
        virtualPath: virtualPath('package.json'),
        bytes: Buffer.from(
          '{"scripts":{"preinstall":"node poison.cjs","test":"node poison.cjs","build":"node poison.cjs"}}',
        ),
      },
      {
        virtualPath: virtualPath('poison.cjs'),
        bytes: Buffer.from(
          'require("node:fs").writeFileSync("/tmp/project-node-executed","canary")',
        ),
      },
      {
        virtualPath: virtualPath('src/worker.js'),
        bytes: Buffer.from('console.error("worker-error"); throw Error("worker-unhandled")'),
      },
      {
        virtualPath: virtualPath('playwright.config.js'),
        bytes: Buffer.from('throw Error("source config executed")'),
      },
    ],
  });
  if (workspace.state !== 'ready') throw new Error('workspace-not-ready');
  const frozen = await store.freeze(cid, workspace.checkpoint.revision);
  const validator = await FrozenBrowserValidator.open({ workspace: store, directory });
  defer(() => validator.close());
  const request = frozenBrowserRequest({
    frozen,
    action: { caseId: cid, actionId: randomUUID(), epoch: 0 },
    scenarioId: 'synthetic-click-v1',
    role: 'baseline',
    allowanceMs: 60000,
  });
  async function revise(
    bytes: string,
    role: 'baseline' | 'candidate' = 'baseline',
  ): Promise<FrozenBrowserRequest> {
    const before = await store.read(cid, virtualPath('src/index.html'));
    const current = await store.inspect(cid);
    if (current.state !== 'ready') throw new Error('workspace-not-ready');
    const edited = await store.edit(cid, current.checkpoint.revision, {
      requestId: requestId(randomUUID()),
      virtualPath: virtualPath('src/index.html'),
      expectedHash: before.sha256,
      bytes: Buffer.from(bytes),
    });
    return frozenBrowserRequest({
      ...request,
      role,
      frozen: await store.freeze(cid, edited.checkpoint.revision),
      action: { ...request.action, actionId: randomUUID() },
    });
  }
  return {
    root,
    directory,
    workspaceDirectory,
    store,
    validator,
    request,
    revise,
    defer,
  };
}
async function auxiliaryContainer(
  f: Awaited<ReturnType<typeof fixture>>,
  purpose: 'sentinel' | 'dependent',
  image: string,
) {
  const name = `eitri-frozen-${purpose}-${randomUUID()}`;
  const owner = `unrelated-${purpose}`;
  assert.match(image, /^sha256:[0-9a-f]{64}$/);
  let acquiredId = '';
  const listing = [
    'container',
    'ls',
    '--all',
    '--no-trunc',
    '--quiet',
    '--filter',
    `name=^/${name}$`,
  ];
  const remove = async () => {
    const context = `Auxiliary container ${name}, fixture state retained at ${f.root}`;
    if (!acquiredId)
      console.error(
        `${context}. Create response unresolved. Delayed daemon effects remain possible.`,
      );
    const id = (await docker(listing)).trim();
    assert.match(id, /^(?:[0-9a-f]{64})?$/, context);
    if (id) {
      if (acquiredId) assert.equal(id, acquiredId, context);
      const inspected = JSON.parse(await docker(['container', 'inspect', id]));
      assert.equal(inspected.length, 1, context);
      const container = inspected[0];
      assert.equal(container.Id, id, context);
      assert.equal(container.Name, `/${name}`, context);
      assert.equal(container.Config.Labels['eitri.frozen-browser.owner'], owner, context);
      assert.equal(container.Image, image, context);
      await docker(['container', 'rm', container.Id]);
    }
    if (acquiredId)
      assert.equal(
        await docker([
          'container',
          'ls',
          '--all',
          '--no-trunc',
          '--quiet',
          '--filter',
          `id=${acquiredId}`,
        ]),
        '',
        context,
      );
    assert.equal(await docker(listing), '', context);
    assert.ok(
      acquiredId,
      `${context}. Lost create response remains unresolved despite an empty listing. Delayed daemon effects remain possible.`,
    );
  };
  f.defer(remove);
  console.log(`Auxiliary container ${name}, fixture state retained at ${f.root}`);
  const id = (
    await docker([
      'create',
      '--name',
      name,
      '--label',
      `eitri.frozen-browser.owner=${owner}`,
      '--network',
      'none',
      image,
    ])
  ).trim();
  assert.match(id, /^[0-9a-f]{64}$/);
  acquiredId = id;
  return { id, remove };
}
const signal = () => new AbortController().signal;

test(
  'actual Docker frozen A after B, protected classifications, PNG and containment provenance',
  { timeout: 300000 },
  async (t) => {
    const f = await fixture(t);
    const frozenBytes = await f.store.readFrozen(f.request.frozen, signal());
    const candidate = await f.revise(html('B'), 'candidate');
    const baseline = await f.validator.validate(f.request, signal());
    assert.equal(baseline.outcome.kind, 'baseline-reproduced');
    assert.deepEqual(baseline.cleanup, { kind: 'owned-removed', cache: 'retained' });
    const evidence = baseline.evidence;
    assert.ok(evidence);
    assert.equal(evidence.observations.literal, 'A');
    assert.equal(evidence.observations.canaryAfter, 'ENOENT');
    const png = validateOutput({
      label: 'Browser screenshot',
      mime: 'image/png',
      bytes: Buffer.from(evidence.png.base64, 'base64'),
    });
    assert.equal(checksum(png), evidence.png.sha256);
    assert.equal(png.length, evidence.png.size);
    assert.deepEqual(evidence.observations.restrictions, {
      root: 'EROFS',
      snapshot: 'EROFS',
      socket: 'ENOENT',
      hostPath: 'ENOENT',
      canary: 'ENOENT',
      egress: 'ENETUNREACH',
    });
    assert.equal(
      (await f.validator.validate(candidate, signal())).outcome.kind,
      'candidate-passed',
    );
    assert.equal(
      (
        await f.validator.validate(
          frozenBrowserRequest({
            ...candidate,
            role: 'baseline',
            action: { ...candidate.action, actionId: randomUUID() },
          }),
          signal(),
        )
      ).outcome.kind,
      'baseline-not-reproduced',
    );
    assert.equal(
      (await f.validator.validate(await f.revise(html('C')), signal())).outcome.kind,
      'unrelated-failure',
    );
    assert.equal(
      (await f.validator.validate(await f.revise(html('A', 'throw Error("startup")')), signal()))
        .outcome.kind,
      'unrelated-failure',
    );
    const forgery = await f.revise(
      html('A', 'console.log(JSON.stringify({kind:"end",passed:true,nonce:"forged"}))'),
    );
    const forged = await f.validator.validate(forgery, signal());
    assert.equal(forged.outcome.kind, 'baseline-reproduced');
    assert.match(JSON.stringify(forged.evidence?.observations.events), /forged/);
    const overflow = await f.revise(html('B', 'console.log("x".repeat(9000))'));
    assert.equal(
      (await f.validator.validate(overflow, signal())).outcome.kind,
      'infrastructure-failed',
    );
    assert.deepEqual(await f.store.readFrozen(f.request.frozen, signal()), frozenBytes);
    assert.equal(
      Buffer.from(
        (await f.store.read(candidate.frozen.caseId, virtualPath('src/index.html'))).bytes,
      ).toString(),
      html('B', 'console.log("x".repeat(9000))'),
    );
  },
);

const screenshotPreparation = (payload = '') => `
const editable = document.createElement('textarea');
document.body.append(editable);
const observer = new MutationObserver(() => {
  if (editable.style.getPropertyValue('caret-color') === 'transparent') {
    observer.disconnect();
    console.log('screenshot-preparation-observed');
    ${payload}
  }
});
observer.observe(editable, {attributes:true, attributeFilter:['style']});
`;

test(
  'actual Docker screenshot preparation is observed before late overflow rejects candidate B',
  { timeout: 150000 },
  async (t) => {
    const f = await fixture(t);
    const control = await f.validator.validate(
      await f.revise(html('B', screenshotPreparation()), 'candidate'),
      signal(),
    );
    assert.equal(control.outcome.kind, 'candidate-passed');
    assert.equal(control.evidence?.observations.literal, 'B');
    assert.deepEqual(control.evidence?.observations.events, [
      { kind: 'console', text: 'screenshot-preparation-observed' },
    ]);
    const overflow = await f.validator.validate(
      await f.revise(
        html('B', screenshotPreparation('console.log("x".repeat(9000));')),
        'candidate',
      ),
      signal(),
    );
    assert.equal(overflow.outcome.kind, 'infrastructure-failed');
    assert.equal(overflow.evidence, null);
    assert.deepEqual(overflow.cleanup, { kind: 'owned-removed', cache: 'retained' });
  },
);

test(
  'actual Docker popup console, errors and overflow cannot disappear before candidate B',
  { timeout: 300000 },
  async (t) => {
    const f = await fixture(t);
    for (const [name, payload, outcome, event] of [
      ['bounded console', '', 'candidate-passed', { kind: 'console', text: 'popup-before-B' }],
      [
        'console error',
        'console.error("popup-console-error")',
        'unrelated-failure',
        { kind: 'console-error', text: 'popup-console-error' },
      ],
      [
        'page error',
        'throw Error("popup-page-error")',
        'unrelated-failure',
        { kind: 'page-error', text: 'popup-page-error' },
      ],
      ['overflow', 'console.log("x".repeat(9000))', 'infrastructure-failed', null],
    ] as const)
      await t.test(name, async () => {
        const popupHtml = `<script>console.log("popup-before-B");${payload}</script>`;
        const popupLiteral = JSON.stringify(popupHtml).replaceAll('<', '\\u003c');
        const extra = `run.addEventListener('click', () => {
          const popup = window.open('about:blank');
          if (!popup) throw Error('popup-not-opened');
          popup.document.write(${popupLiteral});
          popup.document.close();
        })`;
        const report = await f.validator.validate(
          await f.revise(html('B', extra), 'candidate'),
          signal(),
        );
        assert.equal(report.outcome.kind, outcome);
        assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
        if (event) {
          assert.ok(report.evidence);
          assert.deepEqual(
            report.evidence.observations.events,
            event.kind === 'console'
              ? [event]
              : [{ kind: 'console', text: 'popup-before-B' }, event],
          );
        } else assert.equal(report.evidence, null);
      });
  },
);

test(
  'actual Docker dedicated and shared worker attempts cannot yield candidate success',
  { timeout: 150000 },
  async (t) => {
    const f = await fixture(t);
    for (const constructor of ['Worker', 'SharedWorker'])
      await t.test(constructor, async () => {
        const extra = `run.addEventListener('click', () => {
          try { new ${constructor}('worker.js'); } catch {}
        })`;
        const report = await f.validator.validate(
          await f.revise(html('B', extra), 'candidate'),
          signal(),
        );
        assert.equal(report.outcome.kind, 'unrelated-failure');
        assert.ok(report.evidence);
        const events = report.evidence.observations.events;
        assert.ok(Array.isArray(events));
        assert.ok(
          events.some(
            (value) =>
              value !== null &&
              typeof value === 'object' &&
              !Array.isArray(value) &&
              value.kind === 'console-error' &&
              typeof value.text === 'string' &&
              value.text.includes('worker-src'),
          ),
        );
        assert.deepEqual(report.cleanup, { kind: 'owned-removed', cache: 'retained' });
      });
  },
);

test(
  'actual Docker cancellation removes owned running work and preserves an unrelated container',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t, html('A', 'run.addEventListener("click",()=>{while(true){}})'));
    const sentinelImage = (
      await docker(['image', 'inspect', '--format', '{{.Id}}', baseTag])
    ).trim();
    const sentinelContainer = await auxiliaryContainer(f, 'sentinel', sentinelImage);
    const sentinelId = sentinelContainer.id;
    const abort = new AbortController();
    const running = f.validator.validate(f.request, abort.signal);
    void running.catch(() => {});
    let ownedId = '';
    let observedRunning = false;
    let report: FrozenBrowserReport | undefined;
    const failures: unknown[] = [];
    try {
      const deadline = Date.now() + 50000;
      while (Date.now() < deadline) {
        const db = new DatabaseSync(join(f.directory, 'journal.sqlite'), { readOnly: true });
        try {
          const row = db.prepare('SELECT body FROM runs LIMIT 1').get();
          if (row && typeof row.body === 'string') {
            const run = JSON.parse(row.body);
            if (run.ledger.container.kind === 'acquired') {
              ownedId = run.ledger.container.id;
              const state = JSON.parse(await docker(['container', 'inspect', ownedId]));
              assert.equal(state[0].Id, ownedId);
              if (state[0].State.Status === 'running') {
                observedRunning = true;
                break;
              }
            }
          }
        } finally {
          db.close();
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.match(ownedId, /^[0-9a-f]{64}$/);
      assert.ok(observedRunning, 'owned container was not observed running before cancellation');
    } catch (error) {
      failures.push(error);
    } finally {
      abort.abort();
      try {
        await f.validator.close();
      } catch (error) {
        failures.push(error);
      }
      try {
        report = await running;
      } catch (error) {
        if (!failures.includes(error)) failures.push(error);
      }
    }
    if (failures.length)
      throw new AggregateError(failures, 'cancellation or validation drain failed');
    assert.ok(report);
    assert.equal(report.outcome.kind, 'cancelled');
    assert.equal(report.cleanup.kind, 'owned-removed');
    assert.equal(
      await docker(['container', 'ls', '--all', '--quiet', '--filter', `id=${ownedId}`]),
      '',
    );
    const sentinel = JSON.parse(await docker(['container', 'inspect', sentinelId]));
    assert.equal(sentinel[0].Config.Labels['eitri.frozen-browser.owner'], 'unrelated-sentinel');
  },
);

test(
  'actual Docker host SIGKILL after container acquisition leaves watchdog-bounded work and never replays',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t, html('A', 'run.addEventListener("click",()=>{while(true){}})'));
    await f.validator.close();
    await f.store.close();
    const request = frozenBrowserRequest({ ...f.request, allowanceMs: 30000 });
    const childScript = join(f.root, 'owned-host.mjs');
    await writeFile(
      childScript,
      `
    import {channel} from 'node:diagnostics_channel';
    import {FrozenBrowserValidator,frozenBrowserRequest} from ${JSON.stringify(new URL('../../src/frozen-browser.ts', import.meta.url).href)};
    import {WorkspaceStore,virtualPath} from ${JSON.stringify(new URL('../../src/workspace.ts', import.meta.url).href)};
    channel('child_process').subscribe(({process:child})=>child.once('spawn',()=>{
      if(child.spawnargs.includes('start')) {process.stdout.write('started');process.kill(process.pid,'SIGSTOP');}
    }));
    const store=await WorkspaceStore.open({directory:${JSON.stringify(f.workspaceDirectory)},regressionDirectory:virtualPath('test/regression')});
    const validator=await FrozenBrowserValidator.open({workspace:store,directory:${JSON.stringify(f.directory)}});
    await validator.validate(frozenBrowserRequest(${JSON.stringify(request)}),new AbortController().signal);
  `,
    );
    const child = spawn(process.execPath, [childScript], { stdio: ['ignore', 'pipe', 'pipe'] });
    const childClosed = once(child, 'close');
    void childClosed.catch(() => {});
    f.defer(async () => {
      child.kill('SIGKILL');
      await childClosed;
    });
    await once(child.stdout, 'data');
    child.kill('SIGKILL');
    await childClosed;
    const db = new DatabaseSync(join(f.directory, 'journal.sqlite'), { readOnly: true });
    let run;
    try {
      run = JSON.parse(String(db.prepare('SELECT body FROM runs LIMIT 1').get()?.body));
    } finally {
      db.close();
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(1, run.intent.deadline - Date.now() + 1000)),
    );
    const stopped = JSON.parse(await docker(['container', 'inspect', run.ledger.container.id]));
    assert.equal(stopped[0].State.Status, 'exited');
    assert.equal(stopped[0].State.ExitCode, 124);
    const store = await WorkspaceStore.open({
      directory: f.workspaceDirectory,
      regressionDirectory: virtualPath('test/regression'),
    });
    f.defer(() => store.close());
    const validator = await FrozenBrowserValidator.open({
      workspace: store,
      directory: f.directory,
    });
    f.defer(() => validator.close());
    const report = await validator.validate(request, signal());
    assert.deepEqual(report.outcome, { kind: 'uncertain', code: 'interrupted-run-no-replay' });
    assert.equal(report.cleanup.kind, 'owned-removed');
    assert.deepEqual(await validator.validate(request, signal()), report);
    assert.equal((await readFile(join(f.directory, 'owner.json'), 'utf8')).includes('owner'), true);
  },
);

test(
  'actual Docker crash boundaries preserve only committed outcomes and never replay',
  { timeout: 300000 },
  async (t) => {
    for (const phase of [
      'intent',
      'before-outcome-commit',
      'after-outcome-commit',
      'before-acknowledgment',
    ])
      await t.test(phase, { timeout: 70000 }, async (t) => {
        const f = await fixture(t);
        await f.validator.close();
        await f.store.close();
        const script = join(f.root, 'crash-boundary.mjs');
        await writeFile(
          script,
          `
      import {DatabaseSync} from 'node:sqlite';
      import {FrozenBrowserValidator,frozenBrowserRequest} from ${JSON.stringify(new URL('../../src/frozen-browser.ts', import.meta.url).href)};
      import {WorkspaceStore,virtualPath} from ${JSON.stringify(new URL('../../src/workspace.ts', import.meta.url).href)};
      const phase=${JSON.stringify(phase)};
      const checkpoint=()=>{process.stdout.write('checkpoint');process.kill(process.pid,'SIGSTOP');};
      let committing='';
      const prepare=DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare=function(sql){
        const stmt=Reflect.apply(prepare,this,[sql]);
        if(!sql.startsWith('INSERT INTO runs'))return stmt;
        return new Proxy(stmt,{get(target,key){
          if(key==='run')return(...args)=>{
            committing=JSON.parse(args[1]).result.kind;
            if(phase==='before-outcome-commit'&&committing==='recorded')checkpoint();
            return Reflect.apply(target.run,target,args);
          };
          return Reflect.get(target,key,target);
        }});
      };
      const exec=DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec=function(sql){
        const value=Reflect.apply(exec,this,[sql]);
        if(sql==='COMMIT'&&((phase==='intent'&&committing==='pending')||
          (phase==='after-outcome-commit'&&committing==='recorded')||
          (phase==='before-acknowledgment'&&committing==='settled')))checkpoint();
        return value;
      };
      const store=await WorkspaceStore.open({directory:${JSON.stringify(f.workspaceDirectory)},regressionDirectory:virtualPath('test/regression')});
      const validator=await FrozenBrowserValidator.open({workspace:store,directory:${JSON.stringify(f.directory)}});
      await validator.validate(frozenBrowserRequest(${JSON.stringify(f.request)}),new AbortController().signal);
    `,
        );
        const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
        const childClosed = once(child, 'close');
        void childClosed.catch(() => {});
        f.defer(async () => {
          child.kill('SIGKILL');
          await childClosed;
        });
        await once(child.stdout, 'data');
        let dependent = '';
        let removeDependent: (() => Promise<void>) | undefined;
        if (phase === 'after-outcome-commit') {
          const db = new DatabaseSync(join(f.directory, 'journal.sqlite'), { readOnly: true });
          let image = '';
          try {
            image = JSON.parse(String(db.prepare('SELECT body FROM runs LIMIT 1').get()?.body))
              .ledger.image.id;
          } finally {
            db.close();
          }
          const container = await auxiliaryContainer(f, 'dependent', image);
          dependent = container.id;
          removeDependent = container.remove;
        }
        child.kill('SIGKILL');
        await childClosed;
        const store = await WorkspaceStore.open({
          directory: f.workspaceDirectory,
          regressionDirectory: virtualPath('test/regression'),
        });
        f.defer(() => store.close());
        const validator = await FrozenBrowserValidator.open({
          workspace: store,
          directory: f.directory,
        });
        f.defer(() => validator.close());
        const report = await validator.validate(f.request, signal());
        assert.equal(
          report.outcome.kind,
          phase === 'intent' || phase === 'before-outcome-commit'
            ? 'uncertain'
            : 'baseline-reproduced',
        );
        assert.equal(
          report.cleanup.kind,
          phase === 'intent' ? 'not-needed' : dependent ? 'incomplete' : 'owned-removed',
        );
        assert.deepEqual(await validator.validate(f.request, signal()), report);
        if (dependent) {
          const sentinel = JSON.parse(await docker(['container', 'inspect', dependent]));
          assert.equal(
            sentinel[0].Config.Labels['eitri.frozen-browser.owner'],
            'unrelated-dependent',
          );
          assert.ok(removeDependent);
          await removeDependent();
          await validator.close();
          const reconciled = await FrozenBrowserValidator.open({
            workspace: store,
            directory: f.directory,
          });
          f.defer(() => reconciled.close());
          const final = await reconciled.validate(f.request, signal());
          assert.equal(final.outcome.kind, 'baseline-reproduced');
          assert.equal(final.cleanup.kind, 'owned-removed');
        }
      });
  },
);

test(
  'actual Docker completed run does not refund the persistent 16-attempt reservation limit',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    assert.equal(
      (await f.validator.validate(f.request, signal())).outcome.kind,
      'baseline-reproduced',
    );
    for (let i = 1; i < 16; i++) {
      const invalid = frozenBrowserRequest({
        ...f.request,
        frozen: { ...f.request.frozen, revision: '1'.repeat(40) },
        action: { ...f.request.action, actionId: randomUUID() },
      });
      assert.equal(
        (await f.validator.validate(invalid, signal())).outcome.kind,
        'infrastructure-failed',
      );
    }
    await f.validator.close();
    const reopened = await FrozenBrowserValidator.open({
      workspace: f.store,
      directory: f.directory,
    });
    f.defer(() => reopened.close());
    await assert.rejects(
      reopened.validate(
        frozenBrowserRequest({
          ...f.request,
          action: { ...f.request.action, actionId: randomUUID() },
        }),
        signal(),
      ),
      /lifetime-limit/,
    );
  },
);

test(
  'actual Docker lost build client blocks further builds and retains unresolved ownership accounting',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    const listener = (message: unknown) => {
      if (
        !message ||
        typeof message !== 'object' ||
        !('process' in message) ||
        !(message.process instanceof ChildProcess)
      )
        return;
      const child = message.process;
      child.once('spawn', () => {
        if (child.spawnfile === 'docker' && child.spawnargs.includes('build'))
          child.kill('SIGKILL');
      });
    };
    channel('child_process').subscribe(listener);
    f.defer(() => {
      channel('child_process').unsubscribe(listener);
    });
    const report = await f.validator.validate(f.request, signal());
    assert.deepEqual(report.outcome, { kind: 'uncertain', code: 'daemon-build-unresolved' });
    assert.deepEqual(report.cleanup, {
      kind: 'incomplete',
      cache: 'retained',
      code: 'daemon-build-unresolved',
    });
    const owner = await readFile(join(f.directory, 'owner.json'), 'utf8');
    await f.validator.close();
    assert.equal(await readFile(join(f.directory, 'owner.json'), 'utf8'), owner);
    const reopened = await FrozenBrowserValidator.open({
      workspace: f.store,
      directory: f.directory,
    });
    f.defer(() => reopened.close());
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
  },
);

test(
  'actual Docker delayed start cannot reset the recorded absolute PID1 deadline',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    await f.validator.close();
    await f.store.close();
    const request = frozenBrowserRequest({ ...f.request, allowanceMs: 30000 });
    const script = join(f.root, 'late-start-host.mjs');
    await writeFile(
      script,
      `
    import {DatabaseSync} from 'node:sqlite';
    import {FrozenBrowserValidator,frozenBrowserRequest} from ${JSON.stringify(new URL('../../src/frozen-browser.ts', import.meta.url).href)};
    import {WorkspaceStore,virtualPath} from ${JSON.stringify(new URL('../../src/workspace.ts', import.meta.url).href)};
    let acquired=false;
    const prepare=DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare=function(sql){
      const stmt=Reflect.apply(prepare,this,[sql]);
      if(!sql.startsWith('INSERT INTO runs'))return stmt;
      return new Proxy(stmt,{get(target,key){
        if(key==='run')return(...args)=>{
          acquired=JSON.parse(args[1]).ledger.container.kind==='acquired';
          return Reflect.apply(target.run,target,args);
        };
        return Reflect.get(target,key,target);
      }});
    };
    const exec=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec=function(sql){
      const result=Reflect.apply(exec,this,[sql]);
      if(sql==='COMMIT'&&acquired){process.stdout.write('acquired');process.kill(process.pid,'SIGSTOP');}
      return result;
    };
    const store=await WorkspaceStore.open({directory:${JSON.stringify(f.workspaceDirectory)},regressionDirectory:virtualPath('test/regression')});
    const validator=await FrozenBrowserValidator.open({workspace:store,directory:${JSON.stringify(f.directory)}});
    await validator.validate(frozenBrowserRequest(${JSON.stringify(request)}),new AbortController().signal);
  `,
    );
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'pipe'] });
    const childClosed = once(child, 'close');
    void childClosed.catch(() => {});
    f.defer(async () => {
      child.kill('SIGKILL');
      await childClosed;
    });
    await once(child.stdout, 'data');
    child.kill('SIGKILL');
    await childClosed;
    const db = new DatabaseSync(join(f.directory, 'journal.sqlite'), { readOnly: true });
    let run;
    try {
      run = JSON.parse(String(db.prepare('SELECT body FROM runs LIMIT 1').get()?.body));
    } finally {
      db.close();
    }
    const id = String(run.ledger.container.id);
    const created = JSON.parse(await docker(['container', 'inspect', id]));
    assert.equal(created[0].State.Status, 'created');
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(1, run.intent.deadline - Date.now() + 500)),
    );
    await docker(['start', id]);
    let state;
    const end = Date.now() + 5000;
    do {
      state = JSON.parse(await docker(['container', 'inspect', id]))[0].State;
      if (state.Status === 'exited') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < end);
    assert.equal(state.Status, 'exited');
    assert.equal(state.ExitCode, 124);
    const store = await WorkspaceStore.open({
      directory: f.workspaceDirectory,
      regressionDirectory: virtualPath('test/regression'),
    });
    f.defer(() => store.close());
    const validator = await FrozenBrowserValidator.open({
      workspace: store,
      directory: f.directory,
    });
    f.defer(() => validator.close());
    const report = await validator.validate(request, signal());
    assert.equal(report.outcome.kind, 'uncertain');
    assert.equal(report.cleanup.kind, 'owned-removed');
  },
);
