import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const harness = String.raw`
import json, sys, types
source = open('worker/frozen-browser/application-supervisor.py').read()
mode = sys.argv[1]
calls = []
statuses = [(77, 0), (55, 0 if mode != 'failure' else 256), (88, 0)]
class Child:
    pid = 55
    returncode = None
child = Child()
def prctl(*args):
    calls.append(['prctl', list(args)])
    return -1 if mode == 'denied' else 0
def popen(*args, **kwargs):
    calls.append(['spawn', list(args), kwargs])
    return child
def waitpid(pid, flags):
    calls.append(['wait', pid, flags])
    if not statuses:
        raise ChildProcessError()
    return statuses.pop(0)
sys.modules['ctypes'] = types.SimpleNamespace(CDLL=lambda *a, **kw: types.SimpleNamespace(prctl=prctl), get_errno=lambda: 1)
sys.modules['subprocess'] = types.SimpleNamespace(Popen=popen, DEVNULL=-3)
sys.modules['os'] = types.SimpleNamespace(waitpid=waitpid, waitstatus_to_exitcode=lambda status: status // 256)
sys.argv = ['supervisor.py', 'baseline-with-regressions']
try:
    exec(compile(source, 'supervisor.py', 'exec'), {'__name__':'__main__'})
    outcome = 'returned'
except SystemExit as error:
    outcome = error.code
except OSError:
    outcome = 'denied'
print(json.dumps({'outcome':outcome, 'calls':calls, 'returncode':child.returncode}))
`;
for (const mode of ['normal', 'failure', 'denied'])
  test(`application subreaper ${mode} reaps every adopted child without hiding the harness exit`, () => {
    const child = spawnSync('python3', ['-I', '-c', harness, mode], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.deepEqual(result.calls[0], ['prctl', [36, 1, 0, 0, 0]]);
    if (mode === 'denied') {
      assert.equal(result.outcome, 'denied');
      assert.equal(result.calls.length, 1);
    } else {
      assert.equal(result.outcome, mode === 'failure' ? 1 : 0);
      assert.equal(result.returncode, result.outcome);
      assert.deepEqual(result.calls[1], [
        'spawn',
        [['/usr/local/bin/node', '/opt/verify/run.mjs', 'baseline-with-regressions']],
        { stdin: -3 },
      ]);
      assert.deepEqual(result.calls.slice(2), Array(4).fill(['wait', -1, 0]));
    }
  });
