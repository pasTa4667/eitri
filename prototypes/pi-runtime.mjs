import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = '/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js';
const provider = 'openai-codex';
const model = 'gpt-6.1-sol';
const marker = 'EITRI_PI_RPC_OK';
const prompt = `Reply with exactly ${marker}.`;

// Disposable protocol probe, not a production RPC adapter or replacement agent loop.
export async function probePiRuntime({ cliPath = cli, timeoutMs = 60_000, signal } = {}) {
  const lifetime = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  const env = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    USER: process.env.USER,
    TMPDIR: process.env.TMPDIR,
    PI_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_TELEMETRY: '0',
  };
  const cwd = await mkdtemp(join(tmpdir(), 'eitri-pi-rpc-'));
  let stage = 'auth-check';
  try {
    await mkdir(join(cwd, '.pi'));
    await writeFile(
      join(cwd, '.pi', 'settings.json'),
      JSON.stringify({
        retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 45_000 } },
        compaction: { enabled: false },
      }),
      { mode: 0o600 },
    );
    const check = await promisify(execFile)(
      process.execPath,
      [cliPath, 'auth', 'check', '--provider', provider, '--json', '--no-refresh'],
      {
        cwd,
        env,
        timeout: Math.min(timeoutMs, 10_000),
        maxBuffer: 32_768,
        signal: lifetime,
      },
    );
    const auth = JSON.parse(check.stdout);
    if (auth.status !== 'ready' || auth.provider !== provider || auth.authType !== 'oauth')
      throw new Error();
    lifetime.throwIfAborted();
    const child = spawn(
      process.execPath,
      [
        cliPath,
        '--mode',
        'rpc',
        '--provider',
        provider,
        '--model',
        model,
        '--thinking',
        'off',
        '--no-session',
        '--no-tools',
        '--no-extensions',
        '--no-mcp',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        '--offline',
        '--approve',
        '--system-prompt',
        'This is a synthetic connectivity check. Return only the requested marker.',
        '--append-system-prompt',
        'No source files, existing conversations or tools are part of this check.',
      ],
      { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const failed = Promise.withResolvers();
    const finished = Promise.withResolvers();
    const closed = Promise.withResolvers();
    void failed.promise.catch(() => {});
    void finished.promise.catch(() => {});
    const fail = () => failed.reject(new Error());
    const aborted = () => fail();
    lifetime.addEventListener('abort', aborted, { once: true });
    if (lifetime.aborted) fail();
    const pending = new Map();
    let id = 0;
    let closing = false;
    let settled = false;
    let prompted = false;
    let agents = 0;
    let turns = 0;
    let assistantMessages = 0;
    let deltas = '';
    let deltaCount = 0;
    let finalText;
    let bytes = 0;
    let stderrBytes = 0;
    let buffer = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    function record(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      if (value.type === 'response') {
        const request = pending.get(value.id);
        if (!request || value.command !== request.command || value.success !== true)
          throw new Error();
        pending.delete(value.id);
        request.resolve(value.data);
        return;
      }
      if (
        [
          'tool_execution_start',
          'tool_execution_update',
          'tool_execution_end',
          'auto_retry_start',
          'compaction_start',
          'extension_error',
        ].includes(value.type)
      )
        throw new Error();
      if (value.type === 'agent_start' && (!prompted || settled || ++agents > 1)) throw new Error();
      if (value.type === 'turn_start' && (!prompted || ++turns > 1)) throw new Error();
      if (value.type === 'message_update') {
        const update = value.assistantMessageEvent;
        if (typeof update?.type !== 'string' || update.type.startsWith('toolcall_'))
          throw new Error();
        if (update.type === 'text_delta') {
          if (!prompted || typeof update.delta !== 'string') throw new Error();
          deltas += update.delta;
          deltaCount++;
          if (deltas.length > 256) throw new Error();
        }
      }
      if (value.type === 'message_end' && value.message?.role === 'assistant') {
        const message = value.message;
        if (
          ++assistantMessages !== 1 ||
          message.provider !== provider ||
          message.model !== model ||
          message.api !== 'openai-codex-responses' ||
          message.stopReason !== 'stop' ||
          !Array.isArray(message.content) ||
          message.content.some((block) => !['text', 'thinking'].includes(block.type))
        )
          throw new Error();
        finalText = message.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('')
          .trim();
        if (finalText !== marker) throw new Error();
      }
      if (value.type === 'agent_settled') {
        if (
          settled ||
          value.aborted !== false ||
          agents !== 1 ||
          turns !== 1 ||
          assistantMessages !== 1 ||
          deltaCount === 0 ||
          deltas.trim() !== marker ||
          finalText !== marker
        )
          throw new Error();
        settled = true;
        finished.resolve();
      }
    }
    child.stdout.on('data', (chunk) => {
      try {
        bytes += chunk.length;
        if (bytes > 1_048_576) throw new Error();
        buffer += decoder.decode(chunk, { stream: true });
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n');
          if (end > 262_144) throw new Error();
          record(JSON.parse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 1);
        }
        if (buffer.length > 262_144) throw new Error();
      } catch {
        fail();
      }
    });
    child.stdout.on('end', () => {
      try {
        if (decoder.decode() || buffer) throw new Error();
      } catch {
        fail();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65_536) fail();
    });
    child.once('error', fail);
    child.stdin.on('error', fail);
    child.once('close', (code, signal) => {
      closed.resolve({ code, signal });
      if (!closing) fail();
    });
    const wait = (promise) => Promise.race([promise, failed.promise]);
    async function request(type, data = {}) {
      const response = Promise.withResolvers();
      const requestId = `probe-${++id}`;
      pending.set(requestId, { command: type, resolve: response.resolve });
      child.stdin.write(`${JSON.stringify({ id: requestId, type, ...data })}\n`, (error) => {
        if (error) fail();
      });
      return wait(response.promise);
    }
    try {
      stage = 'state';
      const state = await request('get_state');
      if (
        state?.model?.provider !== provider ||
        state.model.id !== model ||
        state.model.api !== 'openai-codex-responses' ||
        state.model.baseUrl !== 'https://chatgpt.com/backend-api' ||
        state.sessionFile != null ||
        state.messageCount !== 0 ||
        state.pendingMessageCount !== 0 ||
        state.isStreaming !== false ||
        state.autoCompactionEnabled !== false
      )
        throw new Error();
      stage = 'resources';
      const commands = await request('get_commands');
      if (!Array.isArray(commands?.commands) || commands.commands.length !== 0) throw new Error();
      stage = 'prompt';
      prompted = true;
      const accepted = await request('prompt', { message: prompt });
      if (accepted?.disposition !== 'started') throw new Error();
      stage = 'stream';
      await wait(finished.promise);
      stage = 'shutdown';
      closing = true;
      child.stdin.end();
      const exit = await wait(closed.promise);
      if (exit.code !== 0 || exit.signal !== null) throw new Error();
      return {
        scope: 'pi-runtime-feasibility',
        transport: 'rpc',
        provider,
        model,
        verdict: 'passed',
        configuredAuthType: 'oauth',
        streamed: true,
        assistantTurns: turns,
        toolExecutions: 0,
        settled,
        childExitCode: exit.code,
      };
    } finally {
      closing = true;
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await closed.promise;
      clearTimeout(kill);
      lifetime.removeEventListener('abort', aborted);
    }
  } catch {
    throw Object.assign(new Error('pi-runtime-probe-failed'), { stage });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== '--run') {
    const help = args.length === 0 || (args.length === 1 && args[0] === '--help');
    (help ? console.log : console.error)(
      'Usage: npm run probe:pi-runtime -- --run\nUses the installed Pi and existing Pi-owned OAuth for one fixed, tools-disabled real inference.',
    );
    return help ? 0 : 1;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const metadata = JSON.parse(
      await readFile(new URL('../../package.json', `file://${cli}`), 'utf8'),
    );
    if (metadata.name !== '@earendil-works/pi-coding-agent' || metadata.version !== '1.4.0')
      throw new Error();
    console.log(
      JSON.stringify({
        ...(await probePiRuntime({ signal: controller.signal })),
        runtimeVersion: metadata.version,
      }),
    );
    return 0;
  } catch (error) {
    console.log(
      JSON.stringify({
        scope: 'pi-runtime-feasibility',
        verdict: 'failed',
        stage: ['auth-check', 'state', 'resources', 'prompt', 'stream', 'shutdown'].includes(
          error?.stage,
        )
          ? error.stage
          : 'runtime-preflight',
      }),
    );
    return 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await main();
