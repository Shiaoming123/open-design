import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createReferenceCatalog, ReferenceCatalogUnavailableError } from '../../src/references/catalog.js';

const records = [
  { id: 'poster:swiss', kind: 'case-study', libraryId: 'poster', status: 'accepted', title: 'Swiss Poster', summary: 'Bold grid and typography', tags: ['poster','swiss'], useCases: ['launch'], visualTraits: ['grid'], roles: ['poster-reference'], previewPath: 'poster/example.html' },
  { id: 'editorial:quiet', kind: 'case-study', libraryId: 'editorial', status: 'accepted', title: 'Quiet Editorial', summary: 'Restrained magazine system', tags: ['editorial'], useCases: ['article'], visualTraits: ['serif'], roles: ['editorial-reference'] },
  { id: 'poster:lead', kind: 'case-study', libraryId: 'poster', status: 'lead', title: 'Lead Poster', summary: 'Unverified lead', tags: ['poster'], roles: [] },
];

async function fixture(payload: unknown = { schemaVersion: 'od-search-index/v1', records }) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-references-'));
  await writeFile(path.join(dir, 'search-index.json'), JSON.stringify(payload));
  return dir;
}

describe('curated reference catalog', () => {
  it('loads only from the explicit directory and fails loud on use without blocking creation', async () => {
    const missing = await createReferenceCatalog(undefined);
    expect(missing.available).toBe(false);
    expect(() => missing.search({ query: 'poster' })).toThrow(ReferenceCatalogUnavailableError);
    const invalid = await createReferenceCatalog(await fixture({ nope: true }));
    expect(invalid.error).toMatch(/invalid/i);
  });

  it('defaults to accepted, scores deterministically and keeps the compact top-eight envelope bounded', async () => {
    const catalog = await createReferenceCatalog(await fixture());
    const first = catalog.search({ query: 'swiss poster' });
    const second = catalog.search({ query: 'swiss poster' });
    expect(first).toEqual(second);
    expect(first.results.map((hit) => hit.id)).toEqual(['poster:swiss']);
    expect(first.results[0]).toEqual(expect.objectContaining({ score: expect.any(Number), matchedFields: expect.arrayContaining(['title']), snippet: expect.any(String) }));
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(12 * 1024);
    expect(catalog.search({ query: 'poster', status: 'lead' }).results[0]?.id).toBe('poster:lead');
  });

  it('recommends accepted references with deterministic library diversity', async () => {
    const catalog = await createReferenceCatalog(await fixture());
    const result = catalog.recommend({ profile: { goal: 'launch article', deliverable: 'poster', styleTraits: ['grid','serif'] }, limit: 2 });
    expect(result.results).toHaveLength(2);
    expect(new Set(result.results.map((hit) => hit.libraryId)).size).toBe(2);
    expect(catalog.recommend({ profile: result.profile, limit: 2 })).toEqual(result);
  });
});
