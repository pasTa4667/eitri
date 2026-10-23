import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';

const recipe = fileURLToPath(new URL('../scripts/profile-reconciliation/', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const origin = 'http://127.0.0.1:4173';
const proofTitle = 'built assets serve the rendered application';
const regressionTitle = 'profile caller renders Anonymous after clearing the user';
const unitTitles = [
  'getUserDisplayName formats profile name "ada" as ada',
  'getUserDisplayName formats profile name "  Ada Lovelace  " as Ada Lovelace',
  'getUserDisplayName formats profile name "gRaCe Hopper" as gRaCe Hopper',
  'getUserDisplayName formats profile name " \\t " as Anonymous',
  'getUserDisplayName formats profile name undefined as Anonymous',
  'getUserDisplayName formats profile name null as Anonymous',
  'getUserDisplayName falls back for a missing name',
  'parseConfig parses valid JSON',
  'parseConfig throws a SyntaxError for invalid JSON',
  'fetchOrder returns the json body on success',
  'fetchOrder throws on a non-ok response',
  'App shows navigation to the three error pages',
  'App render error page initially shows the profile name',
  'App click error page throws from the handler',
];
const helperTitles = ['missing-profile', 'null-profile', 'null-user', 'undefined-user'].map(
  (id) => `profile fallback regression ${id} returns Anonymous`,
);
const callerTitle = 'profile caller regression renders Anonymous after clearing the user';
const html = '<html><script type="module" src="/assets/app.js"></script></html>';
const js = 'document.body.textContent = "Hello, ada";';
const css = 'body { color: black; }';
const builtFiles = [
  { path: 'index.html', body: html },
  { path: 'assets/app.js', body: js },
  { path: 'assets/app.css', body: css },
];

function scenario(variant = 'baseline') {
  const red = variant === 'baseline-with-regressions';
  const titles =
    variant === 'baseline' ? unitTitles : [...unitTitles, ...helperTitles, callerTitle];
  const browserTitles = [
    'render error page initially shows the profile name',
    'click error page raises an uncaught error',
    'async error page raises an unhandled rejection',
    proofTitle,
    ...(variant === 'baseline' ? [] : [regressionTitle]),
  ];
  return {
    variant,
    files: builtFiles,
    unitExit: red ? 1 : 0,
    browserExit: red ? 1 : 0,
    unit: {
      numPendingTests: 0,
      numTodoTests: 0,
      testResults: [
        {
          assertionResults: titles.map((fullName) => ({
            fullName,
            status: red && [...helperTitles, callerTitle].includes(fullName) ? 'failed' : 'passed',
            failureMessages:
              red && [...helperTitles, callerTitle].includes(fullName)
                ? [
                    fullName === callerTitle
                      ? 'Hello, Anonymous'
                      : 'TypeError: Cannot read properties',
                  ]
                : [],
          })),
        },
      ],
    },
    browser: {
      errors: [],
      suites: [
        {
          title: 'spec.js',
          specs: browserTitles.map((title) => ({
            title,
            tests: [
              {
                expectedStatus: 'passed',
                results: [
                  {
                    retry: 0,
                    status: red && title === regressionTitle ? 'failed' : 'passed',
                    errors:
                      red && title === regressionTitle
                        ? [
                            {
                              message: `Error: expect(locator).toHaveText(expected) failed\nLocator: getByTestId('badge')\nExpected string: "Hello, Anonymous"\nReceived: <element(s) not found>`,
                            },
                          ]
                        : [],
                  },
                ],
              },
            ],
          })),
        },
      ],
    },
  };
}

async function harness(root, mode) {
  const data = JSON.parse(await fs.readFile(join(root, 'case.json'), 'utf8'));
  const remap = (path) =>
    typeof path !== 'string'
      ? path
      : path.startsWith('/opt/verify/')
        ? join(recipe, path.slice('/opt/verify/'.length))
        : path.startsWith('/opt/inputs/')
          ? join(root, 'inputs', path.slice('/opt/inputs/'.length))
          : path.startsWith('/home/pwuser/')
            ? join(root, 'home', path.slice('/home/pwuser/'.length))
            : path.startsWith('/tmp/')
              ? join(root, path.slice('/tmp/'.length))
              : path;
  const filesystem = { ...fs };
  for (const name of [
    'cp',
    'lstat',
    'mkdir',
    'opendir',
    'readFile',
    'readdir',
    'rm',
    'symlink',
    'writeFile',
  ]) {
    filesystem[name] = (...args) =>
      fs[name](
        ...args.map((arg, index) =>
          index === 0 || (index === 1 && ['cp', 'symlink'].includes(name)) ? remap(arg) : arg,
        ),
      );
  }
  let body;
  const page = new EventEmitter();
  const frame = {};
  page.mainFrame = () => frame;
  page.getByTestId = () => 'badge';
  page.locator = () => ({ evaluateAll: async () => data.scripts ?? [`${origin}/assets/app.js`] });
  page.goto = async () => {
    for (const item of data.responses ?? [
      { path: '/render-error', type: 'document', mime: 'text/html', body: html },
      { path: '/assets/app.js', type: 'script', mime: 'text/javascript', body: js },
      { path: '/assets/app.css', type: 'stylesheet', mime: 'text/css', body: css },
    ]) {
      const request = {
        url: () => item.url ?? `${origin}${item.path}`,
        resourceType: () => item.type,
        frame: () => frame,
      };
      page.emit('request', request);
      page.emit('response', {
        url: request.url,
        request: () => request,
        status: () => item.status ?? 200,
        fromServiceWorker: () => item.serviceWorker ?? false,
        headerValue: async (name) =>
          name === 'content-type' ? item.mime : String(item.length ?? Buffer.byteLength(item.body)),
        body: async () => Buffer.from(item.body),
      });
    }
    return { status: () => 200 };
  };
  const playwrightTest = (title, callback) => {
    assert.equal(title, proofTitle);
    body = callback;
  };
  playwrightTest.setTimeout = () => {};
  const runtime = {
    argv: ['node', 'run.mjs', data.variant],
    getuid: () => 1001,
    getgid: () => 1001,
    env: {
      ...process.env,
      CASE_ROOT: root,
      PATH: `${root}/bin:${dirname(process.execPath)}:${process.env.PATH}`,
    },
  };
  const context = vm.createContext({
    process: runtime,
    console,
    Buffer,
    URL,
    setTimeout,
    clearTimeout,
  });
  const subject = new vm.SourceTextModule(
    await fs.readFile(
      join(
        recipe,
        mode === 'runner'
          ? 'run.mjs'
          : mode === 'proof'
            ? 'built-assets.spec.js'
            : 'playwright.config.mjs',
      ),
      'utf8',
    ),
    { context },
  );
  await subject.link(async (specifier) => {
    const exports =
      specifier === 'node:fs/promises'
        ? filesystem
        : specifier === 'node:child_process'
          ? {
              spawnSync: (program, args, options) =>
                spawnSync(program, args, { ...options, cwd: remap(options.cwd) }),
            }
          : specifier === 'node:net'
            ? {
                connect: () => {
                  const socket = new EventEmitter();
                  socket.setTimeout = () => {};
                  socket.destroy = () => {};
                  queueMicrotask(() =>
                    data.previewLeftRunning
                      ? socket.emit('connect')
                      : socket.emit('error', { code: 'ECONNREFUSED' }),
                  );
                  return socket;
                },
              }
            : specifier === './playwright.config.js'
              ? {
                  default: {
                    webServer: [{ command: 'npm run dev' }],
                    use: { baseURL: 'http://localhost:5173' },
                  },
                }
              : specifier === '@playwright/test'
                ? {
                    test: playwrightTest,
                    expect: () => ({
                      toHaveText: async (expected) =>
                        assert.equal(data.badge ?? 'Hello, ada', expected),
                    }),
                    defineConfig: (config) => config,
                  }
                : await import(specifier);
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
      },
      { context },
    );
  });
  await subject.evaluate();
  if (mode === 'runner') process.exitCode = runtime.exitCode ?? 0;
  else if (mode === 'config') console.log(JSON.stringify(subject.namespace.default));
  else {
    try {
      await body({ page, baseURL: origin });
      console.log(
        JSON.stringify({
          verdict: 'passed',
          proof: JSON.parse(await fs.readFile(join(root, 'built-proof.json'), 'utf8')),
        }),
      );
    } catch (error) {
      console.log(JSON.stringify({ verdict: 'blocked', error: error.message }));
      process.exitCode = 1;
    }
  }
}

const fakeNpm = `#!${process.execPath}
import * as fs from 'node:fs/promises';
import { join, dirname } from 'node:path';
const root = process.env.CASE_ROOT;
const data = JSON.parse(await fs.readFile(join(root, 'case.json'), 'utf8'));
const args = process.argv.slice(2);
if (args[0] === 'test') {
  await fs.writeFile(join(root, 'unit.json'), JSON.stringify(data.unit));
  await fs.mkdir('dist', { recursive: true });
  await fs.writeFile('dist/stale.js', 'stale build');
  process.exitCode = data.unitExit;
} else if (args[1] === 'build') {
  for (const file of data.files) {
    const path = join('dist', file.path);
    await fs.mkdir(dirname(path), { recursive: true });
    if (file.link) await fs.symlink(file.link, path);
    else if (file.directory) await fs.mkdir(path);
    else await fs.writeFile(path, file.size ? Buffer.alloc(file.size, 120) : file.body);
  }
  process.exitCode = data.buildExit ?? 0;
} else {
  await fs.writeFile(join(root, 'browser.json'), JSON.stringify(data.browser));
  const manifest = JSON.parse(await fs.readFile(join(root, 'built-manifest.json'), 'utf8'));
  const proof = {
    version: 1, server: 'vite-preview', origin: '${origin}',
    manifestDigest: manifest.digest, proofPassed: true,
    observed: manifest.files.map(file => ({ ...file, status: 200, kind: file.path === 'index.html' ? 'document' : file.path.endsWith('.css') ? 'stylesheet' : 'javascript' })),
    ...data.proof,
  };
  if (!data.missingProof) await fs.writeFile(join(root, 'built-proof.json'), data.proofText ?? JSON.stringify(proof));
  console.error('<launching> chromium --enable-sandbox');
  process.exitCode = data.browserExit;
}
`;

async function execute(data, mode = 'runner') {
  const root = await fs.mkdtemp(join(tmpdir(), 'profile-built-'));
  try {
    await fs.writeFile(join(root, 'case.json'), JSON.stringify(data));
    await fs.mkdir(join(root, 'bin'));
    await fs.writeFile(join(root, 'bin/npm'), fakeNpm, { mode: 0o755 });
    await fs.mkdir(join(root, 'inputs', data.variant, 'e2e'), { recursive: true });
    await fs.mkdir(join(root, 'home/node_modules'), { recursive: true });
    if (mode === 'proof') {
      const files = builtFiles.map(({ path, body }) => ({
        path,
        size: Buffer.byteLength(body),
        sha256: sha256(body),
      }));
      await fs.writeFile(
        join(root, 'built-manifest.json'),
        JSON.stringify({ version: 1, files, digest: sha256(JSON.stringify(files)) }),
      );
    }
    const result = spawnSync(
      process.execPath,
      ['--experimental-vm-modules', fileURLToPath(import.meta.url), '--harness', root, mode],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.ifError(result.error);
    assert.equal(result.signal, null, result.stderr);
    const report = JSON.parse(result.stdout);
    return { ...result, report };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--harness') {
  await harness(process.argv[3], process.argv[4]);
} else {
  test('profile reconciliation preview replaces the inherited development server', async () => {
    const { status, report } = await execute(scenario(), 'config');
    assert.equal(status, 0);
    assert.equal(
      report.webServer.command,
      'VITE_SENTRY_DSN= npm run preview -- --host 127.0.0.1 --port 4173 --strictPort --outDir dist',
    );
    assert.equal(report.webServer.url, report.use.baseURL);
    assert.equal(report.use.baseURL, origin);
    assert.equal(report.webServer.reuseExistingServer, false);
    assert.equal(report.webServer.cwd, '/tmp/work');
    assert.equal(report.forbidOnly, true);
    assert.equal(report.workers, 1);
    assert.equal(report.retries, 0);
    assert.equal(report.use.serviceWorkers, 'block');
    assert.equal(report.use.launchOptions.chromiumSandbox, true);
  });

  test('profile reconciliation runner composes unit, fresh build and browser subprocesses for all variants', async () => {
    for (const variant of ['baseline', 'baseline-with-regressions', 'scripted-candidate']) {
      const { status, report } = await execute(scenario(variant));
      assert.equal(status, 0, report.error);
      assert.equal(report.verdict, 'passed');
      assert.deepEqual(
        report.commands.map((command) => command.args.slice(0, 2)),
        [
          ['test', '--'],
          ['run', 'build'],
          ['run', 'test:e2e'],
        ],
      );
      assert.equal(report.builtBundle.manifest.files.length, 3);
      assert.equal(report.builtBundle.proofPassed, true);
      assert.equal(report.previewStopped, true);
    }
  });

  test('profile reconciliation fresh inventory gates browser startup', async () => {
    const cases = [
      { buildExit: 1 },
      { files: [] },
      { files: [{ path: 'index.html', body: html }] },
      { files: [...builtFiles, { path: 'linked.js', link: 'assets/app.js' }] },
      { files: [...builtFiles, { path: 'bad name.js', body: js }] },
      { files: [...builtFiles, { path: 'a/b/c/d/e/f/g/h/deep.js', body: js }] },
      {
        files: [
          ...builtFiles,
          ...Array.from({ length: 254 }, (_, index) => ({ path: `dir-${index}`, directory: true })),
        ],
      },
      { files: [...builtFiles, { path: 'huge.js', size: 8 * 1024 ** 2 + 1 }] },
      {
        files: [
          ...builtFiles,
          ...Array.from({ length: 126 }, (_, index) => ({ path: `extra-${index}.js`, body: js })),
        ],
      },
      {
        files: [
          ...builtFiles,
          ...Array.from({ length: 4 }, (_, index) => ({
            path: `large-${index}.js`,
            size: 8 * 1024 ** 2,
          })),
        ],
      },
    ];
    for (const change of cases) {
      const { status, report } = await execute({ ...scenario(), ...change });
      assert.equal(status, 1);
      assert.equal(report.verdict, 'blocked');
      assert.equal(report.commands.length, 2, report.error);
    }
  });

  test('profile reconciliation rejects missing, malformed and mismatched response proof', async () => {
    for (const change of [
      { missingProof: true },
      { proofText: '{' },
      { proofText: 'x'.repeat(64 * 1024 + 1) },
      { proof: { manifestDigest: '0'.repeat(64) } },
      { proof: { observed: [] } },
      { proof: { observed: Array(129).fill({}) } },
      { proof: { proofPassed: false } },
      { proof: { origin: 'http://localhost:5173' } },
      { previewLeftRunning: true },
    ]) {
      const { status, report } = await execute({ ...scenario(), ...change });
      assert.equal(status, 1);
      assert.equal(report.verdict, 'blocked');
      assert.equal(report.commands.length, 3);
    }
  });

  test('profile reconciliation rejects skipped, retried, renamed and unexpected red results', async () => {
    const cases = [];
    for (const change of [
      (spec) => {
        spec.tests[0].results[0].status = 'skipped';
      },
      (spec) => {
        spec.tests[0].expectedStatus = 'failed';
      },
      (spec) => {
        spec.tests[0].results[0].retry = 1;
      },
      (spec) => {
        spec.tests[0].results.push(spec.tests[0].results[0]);
      },
      (spec) => {
        spec.title = 'substituted title';
      },
      (spec) => {
        spec.tests[0].results[0].status = 'failed';
      },
    ]) {
      const data = scenario('baseline-with-regressions');
      change(data.browser.suites[0].specs.find((spec) => spec.title === proofTitle));
      cases.push(data);
    }
    const nested = scenario('baseline-with-regressions');
    nested.browser.suites[0].suites = [
      { title: 'unexpected describe', specs: nested.browser.suites[0].specs },
    ];
    nested.browser.suites[0].specs = [];
    cases.push(nested);
    const unexpected = scenario('baseline-with-regressions');
    unexpected.browser.suites[0].specs[0].tests[0].results[0].status = 'failed';
    cases.push(unexpected);
    const skippedUnit = scenario('baseline-with-regressions');
    skippedUnit.unit.testResults[0].assertionResults[0].status = 'pending';
    cases.push(skippedUnit);
    const unit = scenario('baseline-with-regressions');
    unit.unit.testResults[0].assertionResults[0].fullName = 'substituted unit';
    cases.push(unit);
    const startup = scenario('baseline-with-regressions');
    startup.browser.suites[0].specs.at(-1).tests[0].results[0].errors = [
      { message: 'Test timeout while waiting for Hello, Anonymous' },
    ];
    cases.push(startup);
    for (const data of cases) {
      const { status, report } = await execute(data);
      assert.equal(status, 1);
      assert.equal(report.verdict, 'blocked');
    }
  });

  test('profile reconciliation provenance observes actual built bodies despite passing DOM text', async () => {
    const pass = await execute(scenario(), 'proof');
    assert.equal(pass.status, 0, pass.report.error);
    assert.equal(pass.report.proof.observed.length, 3);
    assert.equal(
      pass.report.proof.observed.find((response) => response.kind === 'javascript').sha256,
      sha256(js),
    );
    const document = { path: '/render-error', type: 'document', mime: 'text/html', body: html };
    const script = { path: '/assets/app.js', type: 'script', mime: 'text/javascript', body: js };
    for (const responses of [
      [document, { ...script, body: js.replace('Hello', 'Jello') }],
      [{ ...document, body: '<script type="module" src="/src/main.jsx"></script>' }, script],
      [document, { ...script, path: '/src/main.jsx' }],
      [document, { ...script, path: '/@vite/client' }],
      [document, { ...script, url: 'http://other.invalid/assets/app.js' }],
      [document, { ...script, mime: 'text/html', body: html }],
      [document, { ...script, status: 404 }],
      [document, { ...script, path: '/assets/absent.js' }],
      [document, { ...script, length: 8 * 1024 ** 2 + 1 }],
      [document, { ...script, serviceWorker: true }],
      [
        document,
        script,
        {
          path: '/assets/app.css',
          type: 'stylesheet',
          mime: 'text/css',
          body: css.replace('black', 'white'),
        },
      ],
      [document],
      [document, ...Array(128).fill(script)],
    ]) {
      const { status, report } = await execute({ ...scenario(), responses }, 'proof');
      assert.equal(status, 1);
      assert.equal(report.verdict, 'blocked');
    }
  });
}
