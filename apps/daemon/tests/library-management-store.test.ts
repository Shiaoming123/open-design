import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addLibraryAssetsToCollection,
  applyLibraryBatchOperation,
  createLibraryCollection,
  getLibraryAsset,
  insertLibraryAsset,
  listLibraryAssetsPage,
  listLibraryCollections,
  migrateLibrary,
  updateLibraryAsset,
} from '../src/library-store.js';
import { registerLibraryAsset } from '../src/library.js';

let db: Database.Database;

function insertAsset(id: string, capturedAt = 1_700_000_000_000): void {
  insertLibraryAsset(db, {
    id,
    kind: 'image',
    storage: 'owned',
    capturedAt,
    archivedDate: '2024-01-01',
    contentHash: `hash-${id}`,
    tags: ['existing'],
    metadata: { preserved: true },
  });
  // Force identical sort timestamps to exercise the id tiebreaker.
  db.prepare('UPDATE library_assets SET created_at = 100, updated_at = 100 WHERE id = ?').run(id);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrateLibrary(db);
});

afterEach(() => db.close());

describe('library management persistence', () => {
  it('migrates an existing library idempotently without losing assets', () => {
    db.close();
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE library_assets (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, storage TEXT NOT NULL DEFAULT 'owned',
        source_url TEXT, source_title TEXT, source_domain TEXT,
        captured_at INTEGER NOT NULL, archived_date TEXT NOT NULL, file_path TEXT,
        origin_project_id TEXT, rel_path TEXT, mime TEXT, width INTEGER, height INTEGER,
        size INTEGER, content_hash TEXT NOT NULL, caption TEXT, ocr_text TEXT,
        palette_json TEXT, tags_json TEXT, metadata_json TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(content_hash)
      )
    `);
    insertAsset('legacy');

    migrateLibrary(db);
    migrateLibrary(db);

    const asset = getLibraryAsset(db, 'legacy');
    expect(asset).toMatchObject({
      favorite: false,
      collectionIds: [],
      metadata: { preserved: true },
    });
    expect(asset).not.toHaveProperty('displayName');
    expect(asset).not.toHaveProperty('note');
    const columns = db.prepare('PRAGMA table_info(library_assets)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['display_name', 'note', 'favorite']),
    );
    const pageIndex = db.prepare("PRAGMA index_info('idx_library_assets_page')").all() as Array<{
      seqno: number;
      name: string;
    }>;
    expect(pageIndex.sort((a, b) => a.seqno - b.seqno).map((column) => column.name)).toEqual([
      'archived_date',
      'created_at',
      'id',
    ]);
  });

  it('returns a stable cursor page when every timestamp is identical', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) insertAsset(id);

    const first = listLibraryAssetsPage(db, { limit: 2 });
    expect(first.nextCursor).toBeTruthy();
    const second = listLibraryAssetsPage(db, { limit: 2, cursor: first.nextCursor! });
    expect(second.nextCursor).toBeTruthy();
    const third = listLibraryAssetsPage(db, { limit: 2, cursor: second.nextCursor! });

    expect(first.assets.map((asset) => asset.id)).toEqual(['e', 'd']);
    expect(second.assets.map((asset) => asset.id)).toEqual(['c', 'b']);
    expect(third.assets.map((asset) => asset.id)).toEqual(['a']);
    expect(third.nextCursor).toBeUndefined();
  });

  it('persists editable metadata and flat collection membership', () => {
    insertAsset('asset-1');
    const collection = createLibraryCollection(db, 'References');
    addLibraryAssetsToCollection(db, collection.id, ['asset-1', 'asset-1']);
    updateLibraryAsset(db, 'asset-1', {
      displayName: 'Hero reference',
      note: 'Use the spacing rhythm',
      favorite: true,
    });

    expect(getLibraryAsset(db, 'asset-1')).toMatchObject({
      displayName: 'Hero reference',
      note: 'Use the spacing rhythm',
      favorite: true,
      collectionIds: [collection.id],
      tags: ['existing'],
      metadata: { preserved: true },
    });
    expect(listLibraryCollections(db)).toEqual([
      expect.objectContaining({ id: collection.id, name: 'References', assetCount: 1 }),
    ]);
    expect(listLibraryAssetsPage(db, { favorite: true }).assets.map((asset) => asset.id)).toEqual([
      'asset-1',
    ]);
    expect(
      listLibraryAssetsPage(db, { collectionId: collection.id }).assets.map((asset) => asset.id),
    ).toEqual(['asset-1']);
    expect(listLibraryAssetsPage(db, { unsorted: true }).assets).toEqual([]);
  });

  it('applies batch operations transactionally per asset and reports missing ids', () => {
    insertAsset('one');
    insertAsset('two');

    const result = applyLibraryBatchOperation(db, ['one', 'missing', 'two'], {
      type: 'tags.add',
      tags: ['new', 'existing'],
    });

    expect(result).toEqual({
      updated: 2,
      failures: [{ assetId: 'missing', code: 'NOT_FOUND', message: 'asset not found' }],
    });
    expect(getLibraryAsset(db, 'one')).toMatchObject({
      tags: ['existing', 'new'],
      metadata: { preserved: true },
    });
  });

  it('preserves user metadata and memberships when ingest deduplicates bytes', async () => {
    const libraryDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-management-'));
    try {
      const first = await registerLibraryAsset({
        db,
        libraryDir,
        storage: 'owned',
        kind: 'text',
        text: 'same bytes',
        tags: ['first'],
        metadata: { captured: true },
        source: { sourceKind: 'manual-upload' },
      });
      const collection = createLibraryCollection(db, 'Dedupe');
      addLibraryAssetsToCollection(db, collection.id, [first.asset.id]);
      updateLibraryAsset(db, first.asset.id, {
        displayName: 'Keep me',
        note: 'User note',
        favorite: true,
      });

      const second = await registerLibraryAsset({
        db,
        libraryDir,
        storage: 'owned',
        kind: 'text',
        text: 'same bytes',
        tags: ['second'],
        source: { sourceKind: 'clipper' },
      });

      expect(second.deduped).toBe(true);
      expect(second.asset).toMatchObject({
        id: first.asset.id,
        displayName: 'Keep me',
        note: 'User note',
        favorite: true,
        collectionIds: [collection.id],
        tags: ['first', 'second'],
        metadata: { captured: true },
      });
      expect(second.asset.sources).toHaveLength(2);
    } finally {
      await rm(libraryDir, { recursive: true, force: true });
    }
  });
});
