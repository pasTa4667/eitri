import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { ControlError } from '../src/domain.ts';

const [mode, root, api = 'reconciliation'] = process.argv.slice(2);
const paths = ['src/lib/errors.js', 'src/lib/errors.test.js', 'src/App.test.jsx'].map((p) =>
  join(root, p),
);
const original = { ...fs };
const trace = {
  opens: [] as string[],
  closes: [] as number[],
  stats: [0, 0, 0],
  reads: [] as { file: number; position: number; requested: number; returned: number }[],
  hooks: 0,
  largestBuffer: 0,
};
const allowed = new Set([...paths, root, join(root, 'src'), join(root, 'src/lib')]);
for (let p = dirname(root); !allowed.has(p); p = dirname(p)) allowed.add(p);
const ioError = () => Object.assign(new Error(`private ${root}`), { code: 'EIO' });
fs.readdir = async () => {
  throw new Error('unexpected enumeration');
};
fs.readFile = async () => {
  throw new Error('unexpected unbounded read');
};
fs.lstat = new Proxy(original.lstat, {
  apply(target, receiver, args) {
    assert.ok(allowed.has(String(args[0])), String(args[0]));
    return Reflect.apply(target, receiver, args);
  },
});
fs.realpath = new Proxy(original.realpath, {
  apply(target, receiver, args) {
    assert.ok(allowed.has(String(args[0])), String(args[0]));
    return Reflect.apply(target, receiver, args);
  },
});
fs.open = async (...args: Parameters<typeof fs.open>) => {
  const index = paths.indexOf(String(args[0]));
  assert.equal(index, trace.opens.length);
  assert.equal(args[1], constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  assert.deepEqual(trace.closes, []);
  if (mode === 'open-disappear' && index === 1) {
    trace.hooks++;
    await original.unlink(paths[index]);
  }
  if (mode === 'open-error' && index === 1) {
    trace.hooks++;
    throw ioError();
  }
  const file = await original.open(...args);
  trace.opens.push(String(args[0]));
  const read = file.read.bind(file);
  const stat = file.stat.bind(file);
  const close = file.close.bind(file);
  file.close = async () => {
    await close();
    assert.equal(file.fd, -1);
    trace.closes.push(index);
    if (mode.includes('close-error') && index === 0) {
      trace.hooks++;
      throw ioError();
    }
  };
  file.stat = new Proxy(stat, {
    async apply(target, receiver, args) {
      trace.stats[index]++;
      if (mode === 'stat-error' && trace.stats[index] === 2) {
        trace.hooks++;
        throw ioError();
      }
      if (mode === 'unsafe-opened' && index === 0 && trace.stats[index] === 1) {
        trace.hooks++;
        await original.link(paths[0], join(root, 'linked'));
      }
      if (trace.stats[index] === 2) {
        assert.deepEqual(trace.closes, []);
        assert.equal(trace.opens.length, api === 'helper' ? 1 : 3);
      }
      return Reflect.apply(target, receiver, args);
    },
  });
  file.read = new Proxy(read, {
    async apply(_target, _receiver, args) {
      const [buffer, offset, length, position] = args;
      assert.ok(Buffer.isBuffer(buffer));
      assert.equal(typeof offset, 'number');
      assert.equal(typeof length, 'number');
      assert.equal(typeof position, 'number');
      assert.deepEqual(trace.closes, []);
      trace.largestBuffer = Math.max(trace.largestBuffer, buffer.length);
      const trigger = mode.endsWith('-second') ? 1 : api === 'helper' ? 0 : 2;
      if (
        index === trigger &&
        trace.hooks === 0 &&
        !['trace', 'short', 'stat-error', 'close-error', 'unsafe-opened'].includes(mode)
      ) {
        trace.hooks++;
        if (mode.startsWith('rewrite')) await original.writeFile(paths[0], 'ABCDEFGH');
        if (mode.startsWith('replace')) {
          await original.rename(paths[0], `${paths[0]}.old`);
          await original.writeFile(paths[0], 'abcdefgh');
        }
        if (mode.startsWith('parent')) {
          await original.rename(join(root, 'src/lib'), join(root, 'src/old'));
          await original.mkdir(join(root, 'src/lib'));
          await original.writeFile(paths[0], 'abcdefgh');
          await original.writeFile(paths[1], 'abcdefgh');
        }
        if (mode === 'disappear') await original.unlink(paths[0]);
        if (mode === 'grow') await original.appendFile(paths[index], '!');
        if (mode === 'shrink') await original.truncate(paths[index], 1);
        if (mode === 'read-error') throw ioError();
        if (mode === 'changed-close-error') await original.truncate(paths[index], 0);
      }
      const result =
        mode === 'eof' && index === trigger
          ? { bytesRead: 0, buffer }
          : await read(buffer, offset, mode === 'short' ? Math.min(2, length) : length, position);
      trace.reads.push({ file: index, position, requested: length, returned: result.bytesRead });
      return result;
    },
  });
  return file;
};
syncBuiltinESMExports();
const { captureProfileNameFixture, captureProfileNameReconciliationInput } =
  await import('../src/fixture-profile-name.ts');
try {
  const files =
    api === 'helper'
      ? [(await captureProfileNameFixture(root)).source]
      : (await captureProfileNameReconciliationInput(root)).files;
  process.stdout.write(
    JSON.stringify({ trace, bytes: files.map((file) => file.bytes.toString('hex')) }),
  );
} catch (error) {
  if (!(error instanceof ControlError)) throw error;
  process.stdout.write(JSON.stringify({ trace, code: error.code, message: error.message }));
}
