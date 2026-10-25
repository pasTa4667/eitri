import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';

const scenario = globalThis.scenario;
const record = (value) => appendFileSync(globalThis.auditPath, `${JSON.stringify(value)}\n`);
const args = process.argv.slice(2);
record({
  args,
  pid: process.pid,
  cwd: process.cwd(),
  secretEnvironment: [
    'OPENAI_API_KEY',
    'OP_SERVICE_ACCOUNT_TOKEN',
    'NODE_OPTIONS',
    'PI_SESSION_FILE',
  ].some((key) => Boolean(process.env[key])),
});
if (args[0] === 'auth') {
  assert.deepEqual(args, ['auth', 'check', '--provider', 'openai-codex', '--json', '--no-refresh']);
  console.log(
    JSON.stringify({
      status: 'ready',
      provider: 'openai-codex',
      authType: scenario === 'key-auth' ? 'api_key' : 'oauth',
      private: 'private-auth-canary',
    }),
  );
  process.exit(0);
}
for (const flag of [
  '--no-tools',
  '--no-extensions',
  '--no-mcp',
  '--no-skills',
  '--no-prompt-templates',
  '--no-themes',
  '--no-context-files',
  '--no-session',
  '--offline',
  '--approve',
])
  assert.ok(args.includes(flag));
assert.equal(process.env.PI_OFFLINE, '1');
assert.equal(process.env.PI_TELEMETRY, '0');
const settings = JSON.parse(readFileSync('.pi/settings.json', 'utf8'));
assert.equal(settings.retry.enabled, false);
assert.equal(settings.retry.provider.maxRetries, 0);
assert.equal(settings.compaction.enabled, false);
assert.ok(args.includes('--system-prompt') && args.includes('--append-system-prompt'));
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  while (buffer.includes('\n')) {
    const end = buffer.indexOf('\n');
    const request = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    record({ command: request.type, message: request.message });
    if (scenario === 'hung') continue;
    if (request.type === 'get_state') {
      emit({
        type: 'response',
        id: request.id,
        command: request.type,
        success: true,
        data: {
          model: {
            provider: scenario === 'wrong-provider' ? 'openai' : 'openai-codex',
            id: 'gpt-6.1-sol',
            api: 'openai-codex-responses',
            baseUrl: 'https://chatgpt.com/backend-api',
            private: 'private-model-canary',
          },
          messageCount: 0,
          pendingMessageCount: 0,
          isStreaming: false,
          autoCompactionEnabled: false,
          ...(scenario === 'persistent' ? { sessionFile: '/private/session.jsonl' } : {}),
        },
      });
    } else if (request.type === 'get_commands') {
      emit({
        type: 'response',
        id: request.id,
        command: request.type,
        success: true,
        data: { commands: scenario === 'extension' ? [{ name: 'private-command' }] : [] },
      });
    } else if (request.type === 'prompt') {
      if (scenario === 'bad-json') {
        process.stdout.write('private-invalid-json\n');
        continue;
      }
      if (scenario === 'oversized') {
        process.stdout.write('x'.repeat(300_000));
        continue;
      }
      if (scenario === 'rejected') {
        emit({
          type: 'response',
          id: request.id,
          command: 'prompt',
          success: false,
          error: 'private-provider-error',
        });
        continue;
      }
      const response = {
        type: 'response',
        id: request.id,
        command: 'prompt',
        success: true,
        data: { disposition: scenario === 'handled' ? 'handled' : 'started' },
      };
      if (scenario !== 'fast') emit(response);
      emit({ type: 'agent_start' });
      emit({ type: 'turn_start' });
      if (scenario === 'tool')
        emit({
          type: 'tool_execution_start',
          toolName: 'bash',
          args: { command: 'private-canary' },
        });
      if (scenario === 'retry') emit({ type: 'auto_retry_start', errorMessage: 'private-error' });
      if (scenario === 'second-turn') emit({ type: 'turn_start' });
      if (scenario !== 'no-stream') {
        emit({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'EITRI_' },
        });
        emit({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', delta: 'PI_RPC_OK' },
        });
      }
      if (scenario === 'cancel-stream') continue;
      emit({
        type: 'message_end',
        message: {
          role: 'assistant',
          provider: 'openai-codex',
          model: 'gpt-6.1-sol',
          api: 'openai-codex-responses',
          stopReason: scenario === 'provider-error' ? 'error' : 'stop',
          errorMessage: 'private-error-canary',
          content: [{ type: 'text', text: 'EITRI_PI_RPC_OK' }],
        },
      });
      emit({ type: 'agent_end', willRetry: false, messages: [] });
      if (scenario === 'early-exit') process.exit(0);
      emit({ type: 'agent_settled', aborted: scenario === 'aborted' });
      if (scenario === 'late-start') emit({ type: 'agent_start' });
      if (scenario === 'fast') emit(response);
      if (scenario === 'stderr') process.stderr.write('private-stderr-canary');
    } else throw new Error('private-unexpected-command');
  }
});
if (scenario === 'uncooperative') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
