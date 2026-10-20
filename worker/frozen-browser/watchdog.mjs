import { spawn } from 'node:child_process';

const deadline = Number(process.env.EITRI_DEADLINE);
if (
  process.pid !== 1 ||
  !Number.isSafeInteger(deadline) ||
  deadline <= Date.now() ||
  deadline - Date.now() > 60000 ||
  process.execArgv.length
) {
  process.exit(124);
}

const child = spawn('/usr/local/bin/node', ['/opt/eitri/frozen-browser/driver.mjs'], {
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});
let stopped = false;
function stop(code) {
  if (stopped) return;
  stopped = true;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') process.stderr.write('watchdog-kill-failed\n');
  }
  process.exit(code);
}
const timer = setTimeout(() => stop(124), Math.max(1, deadline - Date.now()));
let stdout = 0;
let stderr = 0;
child.stdout.on('data', (bytes) => {
  stdout += bytes.length;
  if (stdout > 6 * 1024 * 1024) stop(125);
  else if (!process.stdout.write(bytes)) child.stdout.pause();
});
process.stdout.on('drain', () => child.stdout.resume());
child.stderr.on('data', (bytes) => {
  stderr += bytes.length;
  if (stderr > 64 * 1024) stop(125);
  else if (!process.stderr.write(bytes)) child.stderr.pause();
});
process.stderr.on('drain', () => child.stderr.resume());
child.on('error', () => stop(126));
child.on('close', (code, signal) => {
  clearTimeout(timer);
  process.exitCode = signal ? 126 : (code ?? 126);
});
process.on('SIGTERM', () => stop(143));
process.on('SIGINT', () => stop(130));
