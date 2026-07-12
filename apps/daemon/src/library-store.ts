// SQLite persistence for the OD Library (global asset registry).
//
// One logical asset per content hash. An asset may carry many source records
// (1 asset : N sources) so the same bytes captured/used in several places
// collapse to one row with several back-links. Owned assets keep their bytes
// under LIBRARY_DIR (content-addressed); referenced assets only point at a
// file already living inside a project / design system.
//
// This module is pure persistence — no filesystem writes, no hashing, no HTTP.
// Higher-level orchestration (storage, enrichment) lives in `library.ts`.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  LibraryAsset,
  LibraryBatchOperation,
  LibraryBatchResponse,
  LibraryCollection,
  LibraryAssetFilter,
  LibraryAssetKind,
  LibraryAssetSource,
  LibrarySourceKind,
  LibraryStorage,
  LibraryTask,
  LibraryTaskError,
  LibraryTaskStatus,
} from '@open-design/contracts';

type SqliteDb = Database.Database;

export function migrateLibrary(db: SqliteDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS library_assets (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      storage TEXT NOT NULL DEFAULT 'owned',
      source_url TEXT,
      source_title TEXT,
      source_domain TEXT,
      captured_at INTEGER NOT NULL,
      archived_date TEXT NOT NULL,
      file_path TEXT,
      origin_project_id TEXT,
      rel_path TEXT,
      mime TEXT,
      width INTEGER,
      height INTEGER,
      size INTEGER,
      content_hash TEXT NOT NULL,
      display_name TEXT,
      note TEXT,
      favorite INTEGER NOT NULL DEFAULT 0,
      caption TEXT,
      ocr_text TEXT,
      palette_json TEXT,
      tags_json TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(content_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_library_assets_archived
      ON library_assets(archived_date DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_library_assets_page
      ON library_assets(archived_date DESC, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_library_assets_kind
      ON library_assets(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_library_assets_domain
      ON library_assets(source_domain);
    CREATE INDEX IF NOT EXISTS idx_library_assets_origin
      ON library_assets(origin_project_id);
    CREATE TABLE IF NOT EXISTS library_asset_sources (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      project_id TEXT,
      conversation_id TEXT,
      run_id TEXT,
      design_system_id TEXT,
      rel_path TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES library_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_library_sources_asset
      ON library_asset_sources(asset_id);
    CREATE INDEX IF NOT EXISTS idx_library_sources_project
      ON library_asset_sources(project_id);
    CREATE INDEX IF NOT EXISTS idx_library_sources_ds
      ON library_asset_sources(design_system_id);

    CREATE TABLE IF NOT EXISTS library_embeddings (
      asset_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      indexed_text TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES library_assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_tasks (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress_json TEXT NOT NULL DEFAULT '[]',
      error_json TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      FOREIGN KEY(asset_id) REFERENCES library_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_library_tasks_asset
      ON library_tasks(asset_id);

    CREATE TABLE IF NOT EXISTS library_tokens (
      token_hash TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      extension_origin TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_digests (
      date TEXT PRIMARY KEY,
      project_id TEXT,
      artifact_path TEXT,
      summary TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS library_collection_assets (
      collection_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(collection_id, asset_id),
      FOREIGN KEY(collection_id) REFERENCES library_collections(id) ON DELETE CASCADE,
      FOREIGN KEY(asset_id) REFERENCES library_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_library_collection_assets_asset
      ON library_collection_assets(asset_id, collection_id);
    CREATE INDEX IF NOT EXISTS idx_library_collection_assets_collection
      ON library_collection_assets(collection_id, created_at DESC, asset_id);
  `);

  // Existing databases predate editable metadata. SQLite has no portable
  // `ADD COLUMN IF NOT EXISTS`, so inspect first to keep startup migrations
  // repeatable while preserving every existing row.
  const columns = new Set(
    (db.prepare('PRAGMA table_info(library_assets)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has('display_name')) db.exec('ALTER TABLE library_assets ADD COLUMN display_name TEXT');
  if (!columns.has('note')) db.exec('ALTER TABLE library_assets ADD COLUMN note TEXT');
  if (!columns.has('favorite')) {
    db.exec('ALTER TABLE library_assets ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_library_assets_favorite
      ON library_assets(favorite, archived_date DESC, created_at DESC, id DESC)
  `);
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

const ASSET_COLS = `id, kind, storage, source_url AS sourceUrl,
  source_title AS sourceTitle, source_domain AS sourceDomain,
  captured_at AS capturedAt, archived_date AS archivedDate,
  file_path AS filePath, origin_project_id AS originProjectId,
  rel_path AS relPath, mime, width, height, size,
  content_hash AS contentHash, display_name AS displayName, note, favorite,
  caption, ocr_text AS ocrText,
  palette_json AS paletteJson, tags_json AS tagsJson,
  metadata_json AS metadataJson, created_at AS createdAt,
  updated_at AS updatedAt`;

interface RawAssetRow {
  id: string;
  kind: string;
  storage: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourceDomain: string | null;
  capturedAt: number;
  archivedDate: string;
  filePath: string | null;
  originProjectId: string | null;
  relPath: string | null;
  mime: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  contentHash: string;
  displayName: string | null;
  note: string | null;
  favorite: number;
  caption: string | null;
  ocrText: string | null;
  paletteJson: string | null;
  tagsJson: string | null;
  metadataJson: string | null;
  createdAt: number;
  updatedAt: number;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Internal projection that also exposes the on-disk path for raw serving. */
export interface LibraryAssetRecord extends LibraryAsset {
  /** Absolute path for owned assets; project-relative resolution otherwise. */
  filePath?: string;
}

function normalizeAsset(
  raw: RawAssetRow,
  sources: LibraryAssetSource[],
  collectionIds: string[] = [],
): LibraryAssetRecord {
  // Build with required fields, then add optionals only when present — the
  // daemon compiles under exactOptionalPropertyTypes, which rejects an
  // explicit `undefined` on an optional property.
  const asset: LibraryAssetRecord = {
    id: raw.id,
    kind: raw.kind as LibraryAssetKind,
    storage: raw.storage as LibraryStorage,
    capturedAt: Number(raw.capturedAt),
    archivedDate: raw.archivedDate,
    contentHash: raw.contentHash,
    favorite: Boolean(raw.favorite),
    collectionIds,
    tags: parseJson<string[]>(raw.tagsJson, []),
    sources,
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
  };
  if (raw.sourceUrl != null) asset.sourceUrl = raw.sourceUrl;
  if (raw.sourceTitle != null) asset.sourceTitle = raw.sourceTitle;
  if (raw.sourceDomain != null) asset.sourceDomain = raw.sourceDomain;
  if (raw.displayName != null) asset.displayName = raw.displayName;
  if (raw.note != null) asset.note = raw.note;
  if (raw.mime != null) asset.mime = raw.mime;
  if (raw.width != null) asset.width = raw.width;
  if (raw.height != null) asset.height = raw.height;
  if (raw.size != null) asset.size = raw.size;
  if (raw.caption != null) asset.caption = raw.caption;
  if (raw.ocrText != null) asset.ocrText = raw.ocrText;
  const palette = parseJson<string[]>(raw.paletteJson, []);
  if (palette.length) asset.palette = palette;
  const metadata = parseJson<Record<string, unknown> | undefined>(raw.metadataJson, undefined);
  if (metadata) asset.metadata = metadata;
  if (raw.originProjectId != null) asset.originProjectId = raw.originProjectId;
  if (raw.relPath != null) asset.relPath = raw.relPath;
  if (raw.filePath != null) asset.filePath = raw.filePath;
  return asset;
}

export interface InsertLibraryAssetInput {
  id: string;
  kind: LibraryAssetKind;
  storage: LibraryStorage;
  sourceUrl?: string | undefined;
  sourceTitle?: string | undefined;
  sourceDomain?: string | undefined;
  capturedAt: number;
  archivedDate: string;
  filePath?: string | undefined;
  originProjectId?: string | undefined;
  relPath?: string | undefined;
  mime?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  size?: number | undefined;
  contentHash: string;
  caption?: string | undefined;
  ocrText?: string | undefined;
  palette?: string[] | undefined;
  tags?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export function insertLibraryAsset(db: SqliteDb, input: InsertLibraryAssetInput): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO library_assets
       (id, kind, storage, source_url, source_title, source_domain,
        captured_at, archived_date, file_path, origin_project_id, rel_path,
        mime, width, height, size, content_hash, caption, ocr_text,
        palette_json, tags_json, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.kind,
    input.storage,
    input.sourceUrl ?? null,
    input.sourceTitle ?? null,
    input.sourceDomain ?? null,
    input.capturedAt,
    input.archivedDate,
    input.filePath ?? null,
    input.originProjectId ?? null,
    input.relPath ?? null,
    input.mime ?? null,
    input.width ?? null,
    input.height ?? null,
    input.size ?? null,
    input.contentHash,
    input.caption ?? null,
    input.ocrText ?? null,
    input.palette ? JSON.stringify(input.palette) : null,
    JSON.stringify(input.tags ?? []),
    input.metadata ? JSON.stringify(input.metadata) : null,
    now,
    now,
  );
}

export interface LibraryAssetPatch {
  displayName?: string | null;
  note?: string | null;
  favorite?: boolean;
  caption?: string | null;
  ocrText?: string | null;
  palette?: string[] | null;
  width?: number | null;
  height?: number | null;
  size?: number | null;
  mime?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
}

export function updateLibraryAsset(
  db: SqliteDb,
  id: string,
  patch: LibraryAssetPatch,
  expectedUpdatedAt?: number,
): boolean {
  const sets: string[] = [];
  const args: unknown[] = [];
  const assign = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    args.push(value);
  };
  if ('displayName' in patch) assign('display_name', patch.displayName ?? null);
  if ('note' in patch) assign('note', patch.note ?? null);
  if ('favorite' in patch) assign('favorite', patch.favorite ? 1 : 0);
  if ('caption' in patch) assign('caption', patch.caption ?? null);
  if ('ocrText' in patch) assign('ocr_text', patch.ocrText ?? null);
  if ('palette' in patch) assign('palette_json', patch.palette ? JSON.stringify(patch.palette) : null);
  if ('width' in patch) assign('width', patch.width ?? null);
  if ('height' in patch) assign('height', patch.height ?? null);
  if ('size' in patch) assign('size', patch.size ?? null);
  if ('mime' in patch) assign('mime', patch.mime ?? null);
  if ('tags' in patch) assign('tags_json', JSON.stringify(patch.tags ?? []));
  if ('metadata' in patch) assign('metadata_json', patch.metadata ? JSON.stringify(patch.metadata) : null);
  if (sets.length === 0) return Boolean(getLibraryAsset(db, id));
  sets.push('updated_at = MAX(updated_at + 1, ?)');
  args.push(Date.now());
  args.push(id);
  let where = 'id = ?';
  if (expectedUpdatedAt !== undefined) {
    where += ' AND updated_at = ?';
    args.push(expectedUpdatedAt);
  }
  return db.prepare(`UPDATE library_assets SET ${sets.join(', ')} WHERE ${where}`).run(...args).changes > 0;
}

export function findLibraryAssetByHash(db: SqliteDb, contentHash: string): LibraryAssetRecord | null {
  const raw = db
    .prepare(`SELECT ${ASSET_COLS} FROM library_assets WHERE content_hash = ?`)
    .get(contentHash) as RawAssetRow | undefined;
  if (!raw) return null;
  return normalizeAsset(raw, listLibraryAssetSources(db, raw.id), listLibraryAssetCollectionIds(db, raw.id));
}

export function getLibraryAsset(db: SqliteDb, id: string): LibraryAssetRecord | null {
  const raw = db
    .prepare(`SELECT ${ASSET_COLS} FROM library_assets WHERE id = ?`)
    .get(id) as RawAssetRow | undefined;
  if (!raw) return null;
  return normalizeAsset(raw, listLibraryAssetSources(db, raw.id), listLibraryAssetCollectionIds(db, raw.id));
}

/**
 * The referenced asset that already mirrors a project file, keyed by its origin
 * (`origin_project_id` + `rel_path`). The reconcile sync uses this to skip files
 * it has already indexed *without* reading/hashing their bytes — the cheap guard
 * that keeps auto-reconcile-on-open near-free on a large workspace. Rides the
 * existing `idx_library_assets_origin` index.
 */
export function findReferencedAssetByOrigin(
  db: SqliteDb,
  originProjectId: string,
  relPath: string,
): LibraryAssetRecord | null {
  const raw = db
    .prepare(
      `SELECT ${ASSET_COLS} FROM library_assets
        WHERE origin_project_id = ? AND rel_path = ? LIMIT 1`,
    )
    .get(originProjectId, relPath) as RawAssetRow | undefined;
  if (!raw) return null;
  return normalizeAsset(raw, listLibraryAssetSources(db, raw.id), listLibraryAssetCollectionIds(db, raw.id));
}

/**
 * Whether a `design-system` source row already exists for a design system id.
 * The reconcile sync registers exactly one card per design system, so this is
 * its "already synced?" short-circuit (no manifest read / preview hashing).
 */
export function hasDesignSystemSource(db: SqliteDb, designSystemId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM library_asset_sources
        WHERE design_system_id = ? AND source_kind = 'design-system' LIMIT 1`,
    )
    .get(designSystemId);
  return Boolean(row);
}

export function deleteLibraryAsset(db: SqliteDb, id: string): void {
  db.prepare(`DELETE FROM library_assets WHERE id = ?`).run(id);
}

export interface LibraryAssetPage {
  assets: LibraryAssetRecord[];
  nextCursor?: string;
}

interface LibraryCursor {
  archivedDate: string;
  createdAt: number;
  id: string;
}

function encodeLibraryCursor(cursor: LibraryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeLibraryCursor(value: string | undefined): LibraryCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<LibraryCursor>;
    if (
      typeof parsed.archivedDate !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      !Number.isFinite(parsed.createdAt) ||
      typeof parsed.id !== 'string'
    ) return undefined;
    return { archivedDate: parsed.archivedDate, createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return undefined;
  }
}

export function listLibraryAssetsPage(db: SqliteDb, filter: LibraryAssetFilter = {}): LibraryAssetPage {
  const where: string[] = [];
  const args: unknown[] = [];
  if (filter.kind) {
    where.push('a.kind = ?');
    args.push(filter.kind);
  }
  if (filter.domain) {
    where.push('a.source_domain = ?');
    args.push(filter.domain);
  }
  if (filter.date) {
    where.push('a.archived_date = ?');
    args.push(filter.date);
  }
  if (filter.q) {
    const like = `%${filter.q}%`;
    where.push(
      '(a.display_name LIKE ? OR a.note LIKE ? OR a.caption LIKE ? OR a.ocr_text LIKE ? OR a.source_title LIKE ? OR a.tags_json LIKE ? OR a.source_url LIKE ?)',
    );
    args.push(like, like, like, like, like, like, like);
  }
  if (filter.tag) {
    where.push('a.tags_json LIKE ?');
    args.push(`%"${filter.tag}"%`);
  }
  if (filter.source) {
    where.push('EXISTS (SELECT 1 FROM library_asset_sources s WHERE s.asset_id = a.id AND s.source_kind = ?)');
    args.push(filter.source);
  }
  if (filter.projectId) {
    where.push(
      '(a.origin_project_id = ? OR EXISTS (SELECT 1 FROM library_asset_sources s WHERE s.asset_id = a.id AND s.project_id = ?))',
    );
    args.push(filter.projectId, filter.projectId);
  }
  if (filter.designSystemId) {
    where.push('EXISTS (SELECT 1 FROM library_asset_sources s WHERE s.asset_id = a.id AND s.design_system_id = ?)');
    args.push(filter.designSystemId);
  }
  if (filter.favorite !== undefined) {
    where.push('a.favorite = ?');
    args.push(filter.favorite ? 1 : 0);
  }
  if (filter.collectionId) {
    where.push('EXISTS (SELECT 1 FROM library_collection_assets ca WHERE ca.asset_id = a.id AND ca.collection_id = ?)');
    args.push(filter.collectionId);
  }
  if (filter.unsorted) {
    where.push('NOT EXISTS (SELECT 1 FROM library_collection_assets ca WHERE ca.asset_id = a.id)');
  }
  const cursor = decodeLibraryCursor(filter.cursor);
  if (cursor) {
    where.push(`(a.archived_date < ? OR
      (a.archived_date = ? AND a.created_at < ?) OR
      (a.archived_date = ? AND a.created_at = ? AND a.id < ?))`);
    args.push(
      cursor.archivedDate,
      cursor.archivedDate,
      cursor.createdAt,
      cursor.archivedDate,
      cursor.createdAt,
      cursor.id,
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Number.isFinite(filter.limit)
    ? Math.max(1, Math.min(Math.trunc(Number(filter.limit)), 1000))
    : 80;
  const raws = db
    .prepare(
      // Order by archive date first so the grid/timeline reflect when an
      // artifact was made (synced rows carry the file's own mtime as
      // archived_date), with created_at as the within-day tiebreak. Matches
      // idx_library_assets_archived.
      `SELECT ${ASSET_COLS} FROM library_assets a
       ${whereSql}
       ORDER BY a.archived_date DESC, a.created_at DESC, a.id DESC
       LIMIT ${limit + 1}`,
    )
    .all(...args) as RawAssetRow[];
  const hasMore = raws.length > limit;
  const pageRows = hasMore ? raws.slice(0, limit) : raws;
  if (pageRows.length === 0) return { assets: [] };
  const ids = pageRows.map((row) => row.id);
  const sourcesByAsset = listLibraryAssetSourcesFor(db, ids);
  const collectionsByAsset = listLibraryAssetCollectionIdsFor(db, ids);
  const assets = pageRows.map((raw) =>
    normalizeAsset(raw, sourcesByAsset.get(raw.id) ?? [], collectionsByAsset.get(raw.id) ?? []),
  );
  if (!hasMore) return { assets };
  const last = pageRows[pageRows.length - 1]!;
  return {
    assets,
    nextCursor: encodeLibraryCursor({
      archivedDate: last.archivedDate,
      createdAt: Number(last.createdAt),
      id: last.id,
    }),
  };
}

export function listLibraryAssets(db: SqliteDb, filter: LibraryAssetFilter = {}): LibraryAssetRecord[] {
  // Internal callers historically consume a bounded snapshot rather than an
  // API page. Preserve that behavior while the HTTP list defaults to 80.
  return listLibraryAssetsPage(db, filter.limit === undefined ? { ...filter, limit: 500 } : filter).assets;
}

// ---------------------------------------------------------------------------
// Collections + user metadata batch operations
// ---------------------------------------------------------------------------

interface RawCollectionRow {
  id: string;
  name: string;
  assetCount: number;
  createdAt: number;
  updatedAt: number;
}

function normalizeCollection(row: RawCollectionRow): LibraryCollection {
  return {
    id: row.id,
    name: row.name,
    assetCount: Number(row.assetCount),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function listLibraryCollections(db: SqliteDb): LibraryCollection[] {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.created_at AS createdAt, c.updated_at AS updatedAt,
      COUNT(ca.asset_id) AS assetCount
    FROM library_collections c
    LEFT JOIN library_collection_assets ca ON ca.collection_id = c.id
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE ASC, c.id ASC
  `).all() as RawCollectionRow[];
  return rows.map(normalizeCollection);
}

export function getLibraryCollection(db: SqliteDb, id: string): LibraryCollection | null {
  const row = db.prepare(`
    SELECT c.id, c.name, c.created_at AS createdAt, c.updated_at AS updatedAt,
      COUNT(ca.asset_id) AS assetCount
    FROM library_collections c
    LEFT JOIN library_collection_assets ca ON ca.collection_id = c.id
    WHERE c.id = ? GROUP BY c.id
  `).get(id) as RawCollectionRow | undefined;
  return row ? normalizeCollection(row) : null;
}

export function createLibraryCollection(db: SqliteDb, name: string): LibraryCollection {
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO library_collections (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
  return { id, name, assetCount: 0, createdAt: now, updatedAt: now };
}

export function renameLibraryCollection(db: SqliteDb, id: string, name: string): boolean {
  return db.prepare('UPDATE library_collections SET name = ?, updated_at = ? WHERE id = ?')
    .run(name, Date.now(), id).changes > 0;
}

export function deleteLibraryCollection(db: SqliteDb, id: string): boolean {
  return db.prepare('DELETE FROM library_collections WHERE id = ?').run(id).changes > 0;
}

export function addLibraryAssetsToCollection(db: SqliteDb, collectionId: string, assetIds: string[]): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO library_collection_assets (collection_id, asset_id, created_at)
    VALUES (?, ?, ?)
  `);
  const run = db.transaction((ids: string[]) => {
    let changed = 0;
    for (const assetId of new Set(ids)) changed += stmt.run(collectionId, assetId, Date.now()).changes;
    return changed;
  });
  return run(assetIds);
}

export function removeLibraryAssetsFromCollection(db: SqliteDb, collectionId: string, assetIds: string[]): number {
  if (assetIds.length === 0) return 0;
  const stmt = db.prepare('DELETE FROM library_collection_assets WHERE collection_id = ? AND asset_id = ?');
  const run = db.transaction((ids: string[]) => {
    let changed = 0;
    for (const assetId of new Set(ids)) changed += stmt.run(collectionId, assetId).changes;
    return changed;
  });
  return run(assetIds);
}

function listLibraryAssetCollectionIds(db: SqliteDb, assetId: string): string[] {
  return (db.prepare(`
    SELECT collection_id AS collectionId FROM library_collection_assets
    WHERE asset_id = ? ORDER BY collection_id ASC
  `).all(assetId) as Array<{ collectionId: string }>).map((row) => row.collectionId);
}

function listLibraryAssetCollectionIdsFor(db: SqliteDb, assetIds: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (assetIds.length === 0) return out;
  const placeholders = assetIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT asset_id AS assetId, collection_id AS collectionId
    FROM library_collection_assets WHERE asset_id IN (${placeholders})
    ORDER BY collection_id ASC
  `).all(...assetIds) as Array<{ assetId: string; collectionId: string }>;
  for (const row of rows) out.set(row.assetId, [...(out.get(row.assetId) ?? []), row.collectionId]);
  return out;
}

export function applyLibraryBatchOperation(
  db: SqliteDb,
  assetIds: string[],
  operation: LibraryBatchOperation,
  expectedUpdatedAt: Record<string, number> = {},
): LibraryBatchResponse {
  const uniqueIds = [...new Set(assetIds)];
  if (
    (operation.type === 'collection.add' || operation.type === 'collection.remove') &&
    !getLibraryCollection(db, operation.collectionId)
  ) {
    return {
      updated: 0,
      failures: uniqueIds.map((assetId) => ({
        assetId,
        code: 'INVALID_COLLECTION' as const,
        message: 'collection not found',
      })),
    };
  }
  const run = db.transaction((): LibraryBatchResponse => {
    let updated = 0;
    const failures: LibraryBatchResponse['failures'] = [];
    for (const assetId of uniqueIds) {
      const asset = getLibraryAsset(db, assetId);
      if (!asset) {
        failures.push({ assetId, code: 'NOT_FOUND', message: 'asset not found' });
        continue;
      }
      const expected = expectedUpdatedAt[assetId];
      if (expected !== undefined && asset.updatedAt !== expected) {
        failures.push({ assetId, code: 'CONFLICT', message: 'asset was modified' });
        continue;
      }
      switch (operation.type) {
        case 'tags.add':
          updateLibraryAsset(db, assetId, { tags: [...new Set([...asset.tags, ...operation.tags])] });
          break;
        case 'tags.remove': {
          const removed = new Set(operation.tags);
          updateLibraryAsset(db, assetId, { tags: asset.tags.filter((tag) => !removed.has(tag)) });
          break;
        }
        case 'favorite.set':
          updateLibraryAsset(db, assetId, { favorite: operation.favorite });
          break;
        case 'collection.add':
          if (addLibraryAssetsToCollection(db, operation.collectionId, [assetId])) {
            db.prepare('UPDATE library_assets SET updated_at = MAX(updated_at + 1, ?) WHERE id = ?')
              .run(Date.now(), assetId);
          }
          break;
        case 'collection.remove':
          if (removeLibraryAssetsFromCollection(db, operation.collectionId, [assetId])) {
            db.prepare('UPDATE library_assets SET updated_at = MAX(updated_at + 1, ?) WHERE id = ?')
              .run(Date.now(), assetId);
          }
          break;
      }
      updated += 1;
    }
    return { updated, failures };
  });
  return run();
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SOURCE_COLS = `id, asset_id AS assetId, source_kind AS sourceKind,
  project_id AS projectId, conversation_id AS conversationId,
  run_id AS runId, design_system_id AS designSystemId,
  rel_path AS relPath, created_at AS createdAt`;

interface RawSourceRow {
  id: string;
  assetId: string;
  sourceKind: string;
  projectId: string | null;
  conversationId: string | null;
  runId: string | null;
  designSystemId: string | null;
  relPath: string | null;
  createdAt: number;
}

function normalizeSource(raw: RawSourceRow): LibraryAssetSource {
  const source: LibraryAssetSource = {
    id: raw.id,
    assetId: raw.assetId,
    sourceKind: raw.sourceKind as LibrarySourceKind,
    createdAt: Number(raw.createdAt),
  };
  if (raw.projectId != null) source.projectId = raw.projectId;
  if (raw.conversationId != null) source.conversationId = raw.conversationId;
  if (raw.runId != null) source.runId = raw.runId;
  if (raw.designSystemId != null) source.designSystemId = raw.designSystemId;
  if (raw.relPath != null) source.relPath = raw.relPath;
  return source;
}

export function listLibraryAssetSources(db: SqliteDb, assetId: string): LibraryAssetSource[] {
  const raws = db
    .prepare(`SELECT ${SOURCE_COLS} FROM library_asset_sources WHERE asset_id = ? ORDER BY created_at ASC`)
    .all(assetId) as RawSourceRow[];
  return raws.map(normalizeSource);
}

function listLibraryAssetSourcesFor(db: SqliteDb, assetIds: string[]): Map<string, LibraryAssetSource[]> {
  const out = new Map<string, LibraryAssetSource[]>();
  if (assetIds.length === 0) return out;
  const placeholders = assetIds.map(() => '?').join(', ');
  const raws = db
    .prepare(
      `SELECT ${SOURCE_COLS} FROM library_asset_sources WHERE asset_id IN (${placeholders}) ORDER BY created_at ASC`,
    )
    .all(...assetIds) as RawSourceRow[];
  for (const raw of raws) {
    const normalized = normalizeSource(raw);
    const list = out.get(raw.assetId) ?? [];
    list.push(normalized);
    out.set(raw.assetId, list);
  }
  return out;
}

export interface AddLibrarySourceInput {
  assetId: string;
  sourceKind: LibrarySourceKind;
  projectId?: string | undefined;
  conversationId?: string | undefined;
  runId?: string | undefined;
  designSystemId?: string | undefined;
  relPath?: string | undefined;
}

/**
 * Append a source record, skipping an exact duplicate (same kind + same
 * project/conversation/run/design-system/relPath) so re-ingesting the same
 * asset from the same place does not multiply back-links.
 */
export function addLibraryAssetSource(db: SqliteDb, input: AddLibrarySourceInput): void {
  const existing = db
    .prepare(
      `SELECT id FROM library_asset_sources
        WHERE asset_id = ?
          AND source_kind = ?
          AND IFNULL(project_id,'') = IFNULL(?, '')
          AND IFNULL(conversation_id,'') = IFNULL(?, '')
          AND IFNULL(run_id,'') = IFNULL(?, '')
          AND IFNULL(design_system_id,'') = IFNULL(?, '')
          AND IFNULL(rel_path,'') = IFNULL(?, '')`,
    )
    .get(
      input.assetId,
      input.sourceKind,
      input.projectId ?? null,
      input.conversationId ?? null,
      input.runId ?? null,
      input.designSystemId ?? null,
      input.relPath ?? null,
    );
  if (existing) return;
  db.prepare(
    `INSERT INTO library_asset_sources
       (id, asset_id, source_kind, project_id, conversation_id, run_id,
        design_system_id, rel_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.assetId,
    input.sourceKind,
    input.projectId ?? null,
    input.conversationId ?? null,
    input.runId ?? null,
    input.designSystemId ?? null,
    input.relPath ?? null,
    Date.now(),
  );
}

// ---------------------------------------------------------------------------
// Enrichment tasks
// ---------------------------------------------------------------------------

interface RawTaskRow {
  id: string;
  assetId: string;
  status: string;
  progressJson: string | null;
  errorJson: string | null;
  startedAt: number;
  endedAt: number | null;
}

function normalizeTask(raw: RawTaskRow): LibraryTask {
  return {
    id: raw.id,
    assetId: raw.assetId,
    status: raw.status as LibraryTaskStatus,
    progress: parseJson<string[]>(raw.progressJson, []),
    error: parseJson<LibraryTaskError | null>(raw.errorJson, null),
    startedAt: Number(raw.startedAt),
    endedAt: raw.endedAt == null ? null : Number(raw.endedAt),
  };
}

const TASK_COLS = `id, asset_id AS assetId, status, progress_json AS progressJson,
  error_json AS errorJson, started_at AS startedAt, ended_at AS endedAt`;

export function insertLibraryTask(db: SqliteDb, task: LibraryTask): void {
  db.prepare(
    `INSERT INTO library_tasks (id, asset_id, status, progress_json, error_json, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    task.id,
    task.assetId,
    task.status,
    JSON.stringify(task.progress ?? []),
    task.error ? JSON.stringify(task.error) : null,
    task.startedAt,
    task.endedAt ?? null,
  );
}

export function getLibraryTask(db: SqliteDb, id: string): LibraryTask | null {
  const raw = db.prepare(`SELECT ${TASK_COLS} FROM library_tasks WHERE id = ?`).get(id) as
    | RawTaskRow
    | undefined;
  return raw ? normalizeTask(raw) : null;
}

export function updateLibraryTask(
  db: SqliteDb,
  id: string,
  patch: Partial<Pick<LibraryTask, 'status' | 'progress' | 'error' | 'endedAt'>>,
): void {
  const existing = getLibraryTask(db, id);
  if (!existing) return;
  const next = { ...existing, ...patch };
  db.prepare(
    `UPDATE library_tasks SET status = ?, progress_json = ?, error_json = ?, ended_at = ? WHERE id = ?`,
  ).run(
    next.status,
    JSON.stringify(next.progress ?? []),
    next.error ? JSON.stringify(next.error) : null,
    next.endedAt ?? null,
    id,
  );
}

// ---------------------------------------------------------------------------
// Tokens (browser-extension pairing)
// ---------------------------------------------------------------------------

export interface LibraryTokenRow {
  tokenHash: string;
  label: string;
  extensionOrigin: string;
  createdAt: number;
  lastUsedAt: number;
}

export function insertLibraryToken(db: SqliteDb, row: LibraryTokenRow): void {
  db.prepare(
    `INSERT OR REPLACE INTO library_tokens (token_hash, label, extension_origin, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(row.tokenHash, row.label, row.extensionOrigin, row.createdAt, row.lastUsedAt);
}

export function findLibraryTokenByHash(db: SqliteDb, tokenHash: string): LibraryTokenRow | null {
  const raw = db
    .prepare(
      `SELECT token_hash AS tokenHash, label, extension_origin AS extensionOrigin,
              created_at AS createdAt, last_used_at AS lastUsedAt
         FROM library_tokens WHERE token_hash = ?`,
    )
    .get(tokenHash) as LibraryTokenRow | undefined;
  return raw ?? null;
}

export function touchLibraryToken(db: SqliteDb, tokenHash: string): void {
  db.prepare(`UPDATE library_tokens SET last_used_at = ? WHERE token_hash = ?`).run(Date.now(), tokenHash);
}

export function listLibraryTokens(db: SqliteDb): LibraryTokenRow[] {
  return db
    .prepare(
      `SELECT token_hash AS tokenHash, label, extension_origin AS extensionOrigin,
              created_at AS createdAt, last_used_at AS lastUsedAt
         FROM library_tokens ORDER BY created_at DESC`,
    )
    .all() as LibraryTokenRow[];
}

export function listLibraryTokenOrigins(db: SqliteDb): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT extension_origin AS origin FROM library_tokens`)
    .all() as Array<{ origin: string }>;
  return rows.map((r) => r.origin).filter(Boolean);
}
