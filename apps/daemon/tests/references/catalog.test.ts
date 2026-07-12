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

async function fixtureWithAssets(searchIndex: unknown, assets: unknown) {
  const dir = await fixture(searchIndex);
  await writeFile(path.join(dir, 'assets.json'), JSON.stringify(assets));
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

  it('falls back to assets when a parseable search index has no valid records', async () => {
    const dir = await fixtureWithAssets(
      { schemaVersion: 'od-search-index/v1', records: [{ nope: true }] },
      { schemaVersion: 'od-asset-catalog/v1', assets: records },
    );
    const catalog = await createReferenceCatalog(dir);
    expect(catalog.available).toBe(true);
    expect(catalog.search({ query: 'swiss' }).results[0]?.id).toBe('poster:swiss');
  });

  it('rejects records whose source or preview paths can escape the configured catalog', async () => {
    const unsafe = ['/absolute.html', 'https://example.com/a', '..\\escape', '../escape'];
    const payload = unsafe.map((previewPath, index) => ({ ...records[0], id: `unsafe:${index}`, previewPath }));
    const catalog = await createReferenceCatalog(await fixture({ schemaVersion: 'od-search-index/v1', records: [...records, ...payload] }));
    for (const item of payload) expect(catalog.get(item.id)).toBeNull();
  });

  it('uses constraints only as deterministic penalties before diversity selection', async () => {
    const constrained = [
      { ...records[0], id: 'poster:motion', title: 'Motion Poster', summary: 'Motion launch poster', tags: ['poster','motion'], libraryId: 'motion' },
      { ...records[1], id: 'poster:static', title: 'Static Poster', summary: 'Static launch poster', tags: ['poster','static'], libraryId: 'static' },
    ];
    const catalog = await createReferenceCatalog(await fixture({ schemaVersion: 'od-search-index/v1', records: constrained }));
    const result = catalog.recommend({ profile: { goal: 'launch poster', constraints: ['motion'] }, limit: 2 });
    expect(result.results[0]?.id).toBe('poster:static');
    expect(result.results.find((hit) => hit.id === 'poster:motion')?.score).toBeLessThan(result.results[0]!.score);
  });
});
