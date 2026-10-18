import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Controller } from './controller.ts';
import { ControlError, fail } from './domain.ts';
import type { Selection, Snapshot } from './domain.ts';

export const controllerPort = 43127;
export async function serve(factory: () => Promise<Controller>) {
  const port = controllerPort;
  const capability = randomBytes(32).toString('hex');
  const token = Buffer.from(`Bearer ${capability}`);
  let controller: Controller | undefined;
  let stopping = false;
  let wireSequence = 0;
  const streams = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const send = (status: number, value: unknown) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(JSON.stringify(value));
    };
    try {
      const host = `127.0.0.1:${port}`;
      const headerCount = (name: string) =>
        request.rawHeaders.filter(
          (_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === name,
        ).length;
      if (
        headerCount('host') !== 1 ||
        request.headers.host !== host ||
        (request.headers.origin !== undefined && request.headers.origin !== `http://${host}`)
      ) {
        send(403, { error: 'origin-denied' });
        return;
      }
      const supplied = Buffer.from(request.headers.authorization ?? '');
      if (
        headerCount('authorization') !== 1 ||
        supplied.length !== token.length ||
        !timingSafeEqual(supplied, token)
      ) {
        send(401, { error: 'unauthorized' });
        return;
      }
      if (!controller || stopping) {
        send(503, { error: 'controller-unavailable' });
        return;
      }
      const url = new URL(request.url ?? '/', `http://${host}`);
      if (
        [...url.searchParams.keys()].some((k) => !['selected', 'before', 'limit'].includes(k)) ||
        [...url.searchParams.keys()].some((k) => url.searchParams.getAll(k).length !== 1)
      )
        fail('invalid-query');
      const selection: Selection = {
        ...(url.searchParams.has('selected')
          ? { selected: url.searchParams.get('selected')! }
          : {}),
        ...(url.searchParams.has('before') ? { before: url.searchParams.get('before')! } : {}),
        ...(url.searchParams.has('limit') ? { limit: Number(url.searchParams.get('limit')) } : {}),
      };
      if (
        request.method === 'GET' &&
        (url.pathname === '/v1/snapshot' || url.pathname === '/v1/messages')
      ) {
        send(200, await controller.snapshot(selection));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/events') {
        await controller.snapshot(selection);
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          'x-content-type-options': 'nosniff',
        });
        response.flushHeaders();
        streams.add(response);
        let blocked = false;
        let pending: Snapshot | null = null;
        const frame = (snapshot: Snapshot) => {
          if (response.destroyed) return;
          if (blocked) {
            pending = snapshot;
            return;
          }
          const payload = JSON.stringify({
            protocol: 1,
            bootId: controller!.bootId,
            sequence: ++wireSequence,
            snapshot,
          });
          if (Buffer.byteLength(payload) > 512_000) {
            response.destroy();
            return;
          }
          blocked = !response.write(`event: snapshot\ndata: ${payload}\n\n`);
        };
        const unwatch = controller.watch(selection, frame, () => response.destroy());
        response.on('drain', () => {
          blocked = false;
          if (pending) {
            const next = pending;
            pending = null;
            frame(next);
          }
        });
        const heartbeat = setInterval(() => {
          if (!blocked) response.write(': heartbeat\n\n');
          else if (response.writableLength > 512_000) response.destroy();
        }, 1_000);
        response.on('close', () => {
          clearInterval(heartbeat);
          unwatch();
          streams.delete(response);
          pending = null;
        });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/commands') {
        if (
          !/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')
        ) {
          send(415, { error: 'json-required' });
          return;
        }
        const pieces: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 32768) {
            send(413, { error: 'body-too-large' });
            request.resume();
            return;
          }
          pieces.push(Buffer.from(chunk));
        }
        const input = JSON.parse(Buffer.concat(pieces).toString('utf8'));
        send(200, await controller.command(input));
        return;
      }
      send(404, { error: 'not-found' });
    } catch (error) {
      const code =
        error instanceof ControlError
          ? error.code
          : error instanceof SyntaxError
            ? 'invalid-json'
            : 'internal-error';
      send(
        code === 'internal-error'
          ? 500
          : code === 'stale-control-version' || code === 'request-id-conflict'
            ? 409
            : 400,
        { error: code },
      );
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  let connectionPath: string | undefined;
  try {
    controller = await factory();
    connectionPath = join(controller.directory, 'connection.json');
    const temporary = `${connectionPath}.${randomUUID()}`;
    await writeFile(
      temporary,
      `${JSON.stringify({ protocol: 1, bootId: controller.bootId, url: `http://127.0.0.1:${port}`, capability })}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await rename(temporary, connectionPath);
    return {
      controller,
      port,
      async close() {
        stopping = true;
        for (const stream of streams) stream.destroy();
        try {
          await controller!.close();
        } finally {
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
          });
          await unlink(connectionPath!).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      },
    };
  } catch (error) {
    await controller?.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    throw error;
  }
}
