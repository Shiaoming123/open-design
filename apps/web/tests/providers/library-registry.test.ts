import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyLibraryBatch,
  createLibraryCollection,
  fetchLibraryAssets,
  fetchLibraryCollections,
  LibraryMutationError,
  updateLibraryAssetMetadata,
  searchCuratedReferences,
} from '../../src/providers/registry';

afterEach(() => vi.unstubAllGlobals());

describe('Resources registry mutations', () => {
  it('follows stable cursors so callers never receive a silently truncated library', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ assets: [{ id: 'a1' }], nextCursor: 'next' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ assets: [{ id: 'a2' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    expect((await fetchLibraryAssets()).map((asset) => asset.id)).toEqual(['a1', 'a2']);
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/library/assets?cursor=next');
  });

  it('uses the shared asset metadata patch endpoint with an optimistic timestamp', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ asset: { id: 'a1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await updateLibraryAssetMetadata('a1', { favorite: true, note: 'Keep' }, 42);

    expect(fetchMock).toHaveBeenCalledWith('/api/library/assets/a1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ patch: { favorite: true, note: 'Keep' }, expectedUpdatedAt: 42 }),
    }));
  });

  it('lists and creates flat collections through the library API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ collections: [{ id: 'c1', name: 'Mood' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ collection: { id: 'c2', name: 'Mobile' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await fetchLibraryCollections()).toHaveLength(1);
    expect((await createLibraryCollection('Mobile'))?.name).toBe('Mobile');
  });

  it('sends discriminated batch operations for the current selection', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ updated: 2, failures: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await applyLibraryBatch(['a1', 'a2'], { type: 'tags.add', tags: ['editorial'] });

    expect(fetchMock).toHaveBeenCalledWith('/api/library/assets/batch', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ assetIds: ['a1', 'a2'], operation: { type: 'tags.add', tags: ['editorial'] } }),
    }));
  });

  it('surfaces optimistic conflicts instead of reporting a silent success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'asset was modified' } }),
      { status: 409 },
    )));

    await expect(updateLibraryAssetMetadata('a1', { note: 'new' }, 42)).rejects.toEqual(
      expect.objectContaining<Partial<LibraryMutationError>>({ status: 409, message: 'asset was modified' }),
    );
  });

  it('searches curated references through the dedicated daemon surface', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ query: 'poster', results: [], total: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await searchCuratedReferences({ query: 'poster' });
    expect(fetchMock).toHaveBeenCalledWith('/api/references/search', expect.objectContaining({ method: 'POST', body: JSON.stringify({ query: 'poster' }) }));
  });
});
