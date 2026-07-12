import { execFile } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

function runCli(base: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', cliEntry, 'library', ...args, '--daemon-url', base, '--json'],
      { cwd: daemonRoot, env: { ...process.env } },
      (error, stdout, stderr) => resolve({
        stdout,
        stderr,
        code: typeof error?.code === 'number' ? error.code : 0,
      }),
    );
  });
}

describe('od library management CLI', () => {
  it('preserves existing tags and keeps every collection command on the shared JSON API', async () => {
    const seen: Array<{ method: string; url: string; body: unknown }> = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        const request = { method: req.method ?? '', url: req.url ?? '', body: raw ? JSON.parse(raw) : null };
        seen.push(request);
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (request.method === 'GET' && request.url === '/api/library/assets/asset-1') {
          return send(200, { asset: { id: 'asset-1', tags: ['existing'], updatedAt: 42 } });
        }
        if (request.method === 'PATCH' && request.url === '/api/library/assets/asset-1') {
          return send(200, { asset: { id: 'asset-1', displayName: 'Hero' } });
        }
        if (request.method === 'GET' && request.url === '/api/library/collections') {
          return send(200, { collections: [{ id: 'collection-1', name: 'Refs', assetCount: 0 }] });
        }
        if (request.method === 'POST' && request.url === '/api/library/collections') {
          return send(201, { collection: { id: 'collection-1', name: 'Refs', assetCount: 0 } });
        }
        if (request.method === 'PATCH' && request.url === '/api/library/collections/collection-1') {
          return send(200, { collection: { id: 'collection-1', name: 'Renamed', assetCount: 0 } });
        }
        if (request.method === 'DELETE' && request.url === '/api/library/collections/collection-1') {
          return send(200, { ok: true });
        }
        if (request.url === '/api/library/collections/collection-1/assets') {
          return send(200, { updated: 1, failures: [] });
        }
        return send(404, { error: { message: 'not found' } });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const base = `http://127.0.0.1:${address.port}`;

    try {
      const update = await runCli(base, [
        'update', 'asset-1', '--name', 'Hero', '--favorite', '--tag', 'new',
        '--expected-updated-at', '42',
      ]);
      expect(update.code).toBe(0);
      expect(JSON.parse(update.stdout)).toMatchObject({ asset: { id: 'asset-1' } });

      for (const args of [
        ['collection', 'list'],
        ['collection', 'create', 'Refs'],
        ['collection', 'rename', 'collection-1', 'Renamed'],
        ['collection', 'add', 'collection-1', 'asset-1'],
        ['collection', 'remove', 'collection-1', 'asset-1'],
        ['collection', 'rm', 'collection-1'],
      ]) {
        const result = await runCli(base, args);
        expect(result.code, `${args.join(' ')}: ${result.stderr}`).toBe(0);
        expect(() => JSON.parse(result.stdout)).not.toThrow();
      }

      expect(seen).toEqual([
        { method: 'GET', url: '/api/library/assets/asset-1', body: null },
        {
          method: 'PATCH',
          url: '/api/library/assets/asset-1',
          body: {
            patch: { displayName: 'Hero', favorite: true, tags: ['existing', 'new'] },
            expectedUpdatedAt: 42,
          },
        },
        { method: 'GET', url: '/api/library/collections', body: null },
        { method: 'POST', url: '/api/library/collections', body: { name: 'Refs' } },
        { method: 'PATCH', url: '/api/library/collections/collection-1', body: { name: 'Renamed' } },
        {
          method: 'POST',
          url: '/api/library/collections/collection-1/assets',
          body: { assetIds: ['asset-1'] },
        },
        {
          method: 'DELETE',
          url: '/api/library/collections/collection-1/assets',
          body: { assetIds: ['asset-1'] },
        },
        { method: 'DELETE', url: '/api/library/collections/collection-1', body: null },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('prints structured partial-failure JSON and exits non-zero for HTTP 207', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(207, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        updated: 1,
        failures: [{ assetId: 'missing', code: 'NOT_FOUND', message: 'asset not found' }],
      }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');

    try {
      const result = await runCli(`http://127.0.0.1:${address.port}`, [
        'batch', 'asset-1', 'missing', '--favorite',
      ]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({
        updated: 1,
        failures: [{ assetId: 'missing', code: 'NOT_FOUND', message: 'asset not found' }],
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('surfaces a stale tag merge as a structured conflict', async () => {
    const requests: string[] = [];
    const server = http.createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') {
          res.end(JSON.stringify({ asset: { id: 'asset-1', tags: ['existing'], updatedAt: 42 } }));
          return;
        }
        res.statusCode = 409;
        res.end(JSON.stringify({ error: { code: 'CONFLICT', message: 'asset was modified' } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');

    try {
      const result = await runCli(`http://127.0.0.1:${address.port}`, [
        'update', 'asset-1', '--tag', 'new', '--expected-updated-at', '42',
      ]);
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: { code: 'CONFLICT', message: 'asset was modified' },
      });
      expect(requests).toEqual([
        'GET /api/library/assets/asset-1',
        'PATCH /api/library/assets/asset-1',
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
