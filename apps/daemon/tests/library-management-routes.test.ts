import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('library management routes', () => {
  let server: http.Server;
  let baseUrl: string;
  const assetIds: string[] = [];
  const collectionIds: string[] = [];
  const projectIds: string[] = [];

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(async () => {
    for (const id of assetIds) {
      await fetch(`${baseUrl}/api/library/assets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    for (const id of collectionIds) {
      await fetch(`${baseUrl}/api/library/collections/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    for (const id of projectIds) {
      await fetch(`${baseUrl}/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function ingest(label: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/library/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text', text: `route-${label}-${Date.now()}`, sourceTitle: label }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { asset: { id: string } };
    assetIds.push(body.asset.id);
    return body.asset.id;
  }

  it('updates metadata, manages collections, and exposes membership through list/detail', async () => {
    const assetId = await ingest('managed');
    const before = (await (await fetch(`${baseUrl}/api/library/assets/${assetId}`)).json()) as {
      asset: { updatedAt: number };
    };
    const create = await fetch(`${baseUrl}/api/library/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Route references' }),
    });
    expect(create.status).toBe(201);
    const collection = (await create.json()) as { collection: { id: string; name: string } };
    collectionIds.push(collection.collection.id);

    const patch = await fetch(`${baseUrl}/api/library/assets/${encodeURIComponent(assetId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patch: { displayName: 'Managed asset', note: 'Keep', favorite: true },
        expectedUpdatedAt: before.asset.updatedAt,
      }),
    });
    expect(patch.status).toBe(200);

    const add = await fetch(
      `${baseUrl}/api/library/collections/${encodeURIComponent(collection.collection.id)}/assets`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetIds: [assetId] }),
      },
    );
    expect(add.status).toBe(200);

    const detail = await fetch(`${baseUrl}/api/library/assets/${encodeURIComponent(assetId)}`);
    expect(await detail.json()).toEqual({
      asset: expect.objectContaining({
        id: assetId,
        displayName: 'Managed asset',
        note: 'Keep',
        favorite: true,
        collectionIds: [collection.collection.id],
      }),
    });

    const stale = await fetch(`${baseUrl}/api/library/assets/${encodeURIComponent(assetId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ patch: { note: 'stale write' }, expectedUpdatedAt: before.asset.updatedAt }),
    });
    expect(stale.status).toBe(409);

    const duplicate = await fetch(`${baseUrl}/api/library/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'route REFERENCES' }),
    });
    expect(duplicate.status).toBe(409);

    const second = await fetch(`${baseUrl}/api/library/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Another collection' }),
    });
    const secondBody = (await second.json()) as { collection: { id: string } };
    collectionIds.push(secondBody.collection.id);
    const renameConflict = await fetch(
      `${baseUrl}/api/library/collections/${encodeURIComponent(secondBody.collection.id)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ROUTE REFERENCES' }),
      },
    );
    expect(renameConflict.status).toBe(409);
  });

  it('returns a partial-failure batch result and rejects invalid collections', async () => {
    const assetId = await ingest('batch');
    const before = (await (await fetch(`${baseUrl}/api/library/assets/${assetId}`)).json()) as {
      asset: { updatedAt: number };
    };
    const batch = await fetch(`${baseUrl}/api/library/assets/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetIds: [assetId, 'does-not-exist'],
        operation: { type: 'favorite.set', favorite: true },
      }),
    });
    expect(batch.status).toBe(207);
    expect(await batch.json()).toEqual({
      updated: 1,
      failures: [{ assetId: 'does-not-exist', code: 'NOT_FOUND', message: 'asset not found' }],
    });

    const conflict = await fetch(`${baseUrl}/api/library/assets/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetIds: [assetId],
        operation: { type: 'tags.add', tags: ['stale'] },
        expectedUpdatedAt: { [assetId]: before.asset.updatedAt },
      }),
    });
    expect(conflict.status).toBe(207);
    expect(await conflict.json()).toEqual({
      updated: 0,
      failures: [{ assetId, code: 'CONFLICT', message: 'asset was modified' }],
    });

    const invalid = await fetch(`${baseUrl}/api/library/assets/batch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetIds: [assetId],
        operation: { type: 'collection.add', collectionId: 'missing' },
      }),
    });
    expect(invalid.status).toBe(400);
  });

  it.each(['0', '-1', '1.5', 'not-a-number'])('rejects invalid list limit %s', async (limit) => {
    const response = await fetch(`${baseUrl}/api/library/assets?limit=${encodeURIComponent(limit)}`);
    expect(response.status).toBe(400);
  });

  it('rejects traversal when applying an asset to a project subdirectory', async () => {
    const assetId = await ingest('path-safe');
    const projectId = `library-path-${randomUUID()}`;
    projectIds.push(projectId);
    const create = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Library path safety' }),
    });
    expect(create.status).toBe(200);

    const apply = await fetch(`${baseUrl}/api/library/assets/${encodeURIComponent(assetId)}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, dir: '../escape' }),
    });
    expect(apply.status).toBe(400);
    expect(await apply.json()).toMatchObject({
      error: { code: 'INVALID_PATH' },
    });

    const files = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(projectId)}/files`);
    expect(files.status).toBe(200);
    expect((await files.json()) as { files: unknown[] }).toMatchObject({ files: [] });
  });

  it('rejects invalid collection operations and reports missing members without hiding successes', async () => {
    const missing = `missing-${randomUUID()}`;
    const invalidRequests: Array<[string, RequestInit]> = [
      [`/api/library/collections/${missing}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Nope' }),
      }],
      [`/api/library/collections/${missing}`, { method: 'DELETE' }],
      [`/api/library/collections/${missing}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetIds: ['asset'] }),
      }],
      [`/api/library/collections/${missing}/assets`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetIds: ['asset'] }),
      }],
    ];
    for (const [url, init] of invalidRequests) {
      const response = await fetch(`${baseUrl}${url}`, init);
      expect(response.status, `${init.method} ${url}`).toBe(404);
    }
    const blank = await fetch(`${baseUrl}/api/library/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blank.status).toBe(400);

    const assetId = await ingest('collection-partial');
    const create = await fetch(`${baseUrl}/api/library/collections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Partial ${randomUUID()}` }),
    });
    const collection = (await create.json()) as { collection: { id: string } };
    collectionIds.push(collection.collection.id);
    const partial = await fetch(
      `${baseUrl}/api/library/collections/${encodeURIComponent(collection.collection.id)}/assets`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetIds: [assetId, missing] }),
      },
    );
    expect(partial.status).toBe(207);
    expect(await partial.json()).toEqual({
      updated: 1,
      failures: [{ assetId: missing, code: 'NOT_FOUND', message: 'asset not found' }],
    });
  });
});
