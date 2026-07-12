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

const ranking = {
  schemaVersion: 'od-reference-ranking/v1',
  matchMode: 'all-concepts',
  tokenization: 'unicode-alphanumeric',
  weights: { title: 10, roles: 6, useCases: 5, tags: 4, visualTraits: 3, summary: 2, userWords: 2, libraryId: 1 },
  conceptGroups: [['控制台', 'console'], ['海报', 'poster'], ['营销', 'launch', 'campaign', 'marketing']],
};

async function fixture(
  payload: unknown = { schemaVersion: 'od-search-index/v1', ranking, records },
  assets: unknown = { schemaVersion: 'od-asset-catalog/v1', assets: records },
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'od-references-'));
  await writeFile(path.join(dir, 'search-index.json'), JSON.stringify(payload));
  await writeFile(path.join(dir, 'assets.json'), JSON.stringify(assets));
  return dir;
}

async function fixtureWithAssets(searchIndex: unknown, assets: unknown) {
  return fixture(searchIndex, assets);
}

describe('curated reference catalog', () => {
  it('loads only from the explicit directory and fails loud on use without blocking creation', async () => {
    const missing = await createReferenceCatalog(undefined);
    expect(missing.available).toBe(false);
    expect(() => missing.search({ query: 'poster' })).toThrow(ReferenceCatalogUnavailableError);
    const invalid = await createReferenceCatalog(await fixture({ nope: true }, { nope: true }));
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
    const candidates = [records[0], { ...records[1], useCases: ['launch'] }];
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', ranking, records: candidates },
      { schemaVersion: 'od-asset-catalog/v1', assets: candidates },
    ));
    const result = catalog.recommend({ profile: { goal: 'launch' }, limit: 2 });
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
    const all = [...records, ...payload];
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', ranking, records: all },
      { schemaVersion: 'od-asset-catalog/v1', assets: all },
    ));
    for (const item of payload) expect(catalog.get(item.id)).toBeNull();
  });

  it('uses constraints only as deterministic penalties before diversity selection', async () => {
    const constrained = [
      { ...records[0], id: 'poster:motion', title: 'Motion Poster', summary: 'Motion launch poster', tags: ['poster','motion'], libraryId: 'motion' },
      { ...records[1], id: 'poster:static', title: 'Static Poster', summary: 'Static launch poster', tags: ['poster','static'], libraryId: 'static' },
    ];
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', ranking, records: constrained },
      { schemaVersion: 'od-asset-catalog/v1', assets: constrained },
    ));
    const result = catalog.recommend({ profile: { goal: 'launch poster', constraints: ['motion'] }, limit: 2 });
    expect(result.results[0]?.id).toBe('poster:static');
    expect(result.results.find((hit) => hit.id === 'poster:motion')?.score).toBeLessThan(result.results[0]!.score);
  });

  it('applies negative constraints to the complete accepted candidate set before truncation', async () => {
    const motionCandidates = Array.from({ length: 21 }, (_, index) => ({
      ...records[0],
      id: `motion:${String(index).padStart(2, '0')}`,
      title: `Launch Poster Motion ${index}`,
      summary: 'Launch poster with motion',
      tags: ['launch', 'poster', 'motion'],
      libraryId: `motion-${index}`,
    }));
    const staticCandidate = {
      ...records[1],
      id: 'static:outside-top-twenty',
      title: 'Launch Poster Visual',
      summary: 'Static launch system',
      tags: ['launch', 'static'],
      libraryId: 'static',
    };
    const candidates = [...motionCandidates, staticCandidate];
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', ranking, records: candidates },
      { schemaVersion: 'od-asset-catalog/v1', assets: candidates },
    ));

    const result = catalog.recommend({ profile: { goal: 'launch poster', constraints: ['motion'] }, limit: 1 });

    expect(result.results[0]?.id).toBe('static:outside-top-twenty');
    expect(result.total).toBe(22);
  });

  it('uses the index ranking profile for token-exact concept AND matching', async () => {
    const profileRecords = [
      { ...records[0], id: 'console:exact', title: 'Workflow Console', summary: 'Editorial launch system', tags: ['tool'] },
      { ...records[0], id: 'console:prefix', title: 'Consolex', summary: 'Editorial launch system', tags: ['tool'] },
      { ...records[1], id: 'console:partial', title: 'Editorial Console', summary: 'Quiet system', tags: ['tool'] },
    ];
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', ranking, records: profileRecords },
      { schemaVersion: 'od-asset-catalog/v1', assets: profileRecords },
    ));

    expect(catalog.search({ query: '控制台 editorial launch' }).results.map((hit) => hit.id)).toEqual(['console:exact']);
    expect(catalog.search({ query: 'console' }).results.map((hit) => hit.id)).not.toContain('console:prefix');
  });

  it('falls back to the built-in v1 ranking only when searching normalized assets', async () => {
    const asset = { ...records[0], id: 'fallback:console', title: 'Workflow Console', summary: 'Operations tool' };
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', records: [{ ...asset, title: 'Unrelated index record' }] },
      { schemaVersion: 'od-asset-catalog/v1', assets: [asset] },
    ));
    expect(catalog.search({ query: '控制台' }).results[0]?.id).toBe('fallback:console');
  });

  it('does not use index records when the declared ranking profile is invalid', async () => {
    const asset = { ...records[0], id: 'fallback:invalid-ranking', title: 'Workflow Console' };
    const invalidRanking = { ...ranking, weights: { ...ranking.weights, title: 99 } };
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', ranking: invalidRanking, records: [{ ...asset, title: 'Unrelated index record' }] },
      { schemaVersion: 'od-asset-catalog/v1', assets: [asset] },
    ));
    expect(catalog.search({ query: '控制台' }).results[0]?.id).toBe('fallback:invalid-ranking');
  });

  it('returns the full normalized asset from detail while keeping search compact', async () => {
    const asset = {
      ...records[0],
      id: 'poster:full-detail',
      captureDepth: 'artifact-study',
      sourcePolicy: 'inspiration-only',
      sourceUrls: ['https://example.com/poster'],
      sourceUrlHashes: ['0123456789abcdef'],
      files: { catalog: 'poster/catalog.json', source: 'poster/source.json', preview: 'poster/example.html' },
    };
    const catalog = await createReferenceCatalog(await fixture(
      { schemaVersion: 'od-search-index/v1', ranking, records: [records[0]] },
      { schemaVersion: 'od-asset-catalog/v1', assets: [asset] },
    ));

    expect(catalog.get(asset.id)?.reference).toEqual(expect.objectContaining({
      captureDepth: 'artifact-study',
      useCases: ['launch'],
      visualTraits: ['grid'],
      sourceUrlHashes: ['0123456789abcdef'],
      files: asset.files,
    }));
    expect(catalog.search({ query: 'poster' }).results[0]).not.toHaveProperty('files');
  });
});
