import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { ControlError } from '../src/domain.ts';

const [mode, root] = process.argv.slice(2);
const path = join(root, 'src/lib/errors.js');
const original = { ...fs };
const trace = {
  opens: [] as string[],
  metadata: [] as string[],
  reads: [] as { position: number; requested: number; returned: number }[],
  largestBuffer: 0,
  closes: 0,
  stats: 0,
  hooks: 0,
};
let injected = false;
const ioError = () => Object.assign(new Error(`private path ${root}`), { code: 'EIO' });
fs.readdir = async () => {
  throw new Error('unexpected directory enumeration');
};
fs.readFile = async () => {
  throw new Error('unexpected unbounded read');
};
fs.lstat = new Proxy(original.lstat, {
  apply(target, receiver, args) {
    trace.metadata.push(String(args[0]));
    return Reflect.apply(target, receiver, args);
  },
});
fs.realpath = new Proxy(original.realpath, {
  apply(target, receiver, args) {
    trace.metadata.push(String(args[0]));
    return Reflect.apply(target, receiver, args);
  },
});
fs.open = async (...args: Parameters<typeof fs.open>) => {
  trace.opens.push(String(args[0]));
  assert.equal(String(args[0]), path);
  assert.equal(args[1], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const file = await original.open(...args);
  const read = file.read.bind(file);
  const stat = file.stat.bind(file);
  const close = file.close.bind(file);
  file.close = async () => {
    await close();
    assert.equal(file.fd, -1);
    trace.closes++;
  };
  file.stat = new Proxy(stat, {
    apply(target, receiver, args) {
      trace.stats++;
      if (mode === 'stat-error' && trace.stats === 2) {
        trace.hooks++;
        throw ioError();
      }
      return Reflect.apply(target, receiver, args);
    },
  });
  file.read = new Proxy(read, {
    async apply(_target, _receiver, args) {
      const [buffer, offset, length, position] = args;
      assert.ok(Buffer.isBuffer(buffer));
      trace.largestBuffer = Math.max(trace.largestBuffer, buffer.length);
      assert.equal(typeof offset, 'number');
      assert.equal(typeof length, 'number');
      assert.equal(typeof position, 'number');
      if (!injected && mode !== 'trace' && mode !== 'stat-error') {
        injected = true;
        trace.hooks++;
        if (mode === 'grow') await original.appendFile(path, '!');
        if (mode === 'shrink') await original.truncate(path, 1);
        if (mode === 'replace') {
          await original.rename(path, `${path}.old`);
          await original.writeFile(path, 'abcdefgh');
        }
        if (mode === 'parent') {
          await original.rename(join(root, 'src/lib'), join(root, 'src/old'));
          await original.mkdir(join(root, 'src/lib'));
          await original.writeFile(path, 'abcdefgh');
        }
        if (mode === 'disappear') await original.unlink(path);
        if (mode === 'mode') await original.chmod(path, 0o600);
        if (mode === 'rewrite') await original.writeFile(path, 'ABCDEFGH');
        if (mode === 'read-error') throw ioError();
      }
      if (mode === 'eof') {
        trace.reads.push({ position, requested: length, returned: 0 });
        return { bytesRead: 0, buffer };
      }
      const result = await read(
        buffer,
        offset,
        mode === 'short' ? Math.min(2, length) : length,
        position,
      );
      trace.reads.push({ position, requested: length, returned: result.bytesRead });
      return result;
    },
  });
  return file;
};
syncBuiltinESMExports();
const { captureProfileNameFixture } = await import('../src/fixture-profile-name.ts');
try {
  const capture = await captureProfileNameFixture(root);
  process.stdout.write(JSON.stringify({ trace, bytes: capture.source.bytes.toString('hex') }));
} catch (error) {
  if (!(error instanceof ControlError)) throw error;
  process.stdout.write(JSON.stringify({ trace, code: error.code, message: error.message }));
}
