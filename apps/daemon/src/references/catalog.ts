import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CuratedReferenceDetailResponse,
  CuratedReferenceHit,
  CuratedReferenceRecommendRequest,
  CuratedReferenceRecommendResponse,
  CuratedReferenceSearchRequest,
  CuratedReferenceSearchResponse,
} from '@open-design/contracts';

interface CatalogRecord {
  id: string;
  kind: string;
  libraryId: string;
  status: string;
  title: string;
  summary?: string;
  tags?: string[];
  useCases?: string[];
  userWords?: string[];
  visualTraits?: string[];
  roles?: string[];
  sourcePath?: string;
  previewPath?: string;
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const FIELD_WEIGHTS: Array<[keyof CatalogRecord, number]> = [
  ['title', 12], ['tags', 8], ['useCases', 7], ['userWords', 5],
  ['visualTraits', 4], ['roles', 3], ['summary', 2], ['libraryId', 2],
];
const ALIASES: Record<string, string[]> = {
  海报: ['poster'], 编辑: ['editorial'], 杂志: ['magazine'], 动效: ['motion'],
  活动: ['campaign'], 产品: ['product'], 博客: ['blog'], 数据: ['data'], 图表: ['chart'],
};

export class ReferenceCatalogUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'ReferenceCatalogUnavailableError'; }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeRecord(value: unknown): CatalogRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  for (const key of ['id','kind','libraryId','status','title']) if (typeof item[key] !== 'string') return null;
  return {
    id: item.id as string, kind: item.kind as string, libraryId: item.libraryId as string,
    status: item.status as string, title: item.title as string,
    ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
    tags: strings(item.tags), useCases: strings(item.useCases), userWords: strings(item.userWords),
    visualTraits: strings(item.visualTraits), roles: strings(item.roles),
    ...(typeof item.sourcePath === 'string' ? { sourcePath: item.sourcePath } : {}),
    ...(typeof item.previewPath === 'string' ? { previewPath: item.previewPath } : {}),
  };
}

function terms(query: string): string[] {
  const base = query.toLocaleLowerCase().match(/[\p{L}\p{N}-]+/gu) ?? [];
  return [...new Set(base.flatMap((term) => [term, ...(ALIASES[term] ?? [])]))];
}

function fieldText(record: CatalogRecord, key: keyof CatalogRecord): string {
  const value = record[key];
  return (Array.isArray(value) ? value.join(' ') : String(value ?? '')).toLocaleLowerCase();
}

function toHit(record: CatalogRecord, score: number, matchedFields: string[]): CuratedReferenceHit {
  return {
    id: record.id, kind: record.kind, libraryId: record.libraryId, status: record.status,
    title: record.title.slice(0, 160), snippet: (record.summary || record.userWords?.[0] || '').slice(0, 360),
    tags: (record.tags ?? []).slice(0, 8).map((value) => value.slice(0, 100)),
    roles: (record.roles ?? []).slice(0, 5).map((value) => value.slice(0, 100)),
    ...(record.previewPath ? { previewPath: record.previewPath } : {}),
    ...(record.sourcePath ? { sourcePath: record.sourcePath } : {}),
    score: Math.round(score * 100) / 100,
    matchedFields,
  };
}

export interface ReferenceCatalog {
  available: boolean;
  error?: string;
  search(request: CuratedReferenceSearchRequest): CuratedReferenceSearchResponse;
  get(id: string): CuratedReferenceDetailResponse | null;
  recommend(request: CuratedReferenceRecommendRequest): CuratedReferenceRecommendResponse;
}

function unavailable(error: string): ReferenceCatalog {
  const fail = () => { throw new ReferenceCatalogUnavailableError(error); };
  return { available: false, error, search: fail, get: fail, recommend: fail };
}

export async function createReferenceCatalog(catalogDir: string | undefined): Promise<ReferenceCatalog> {
  if (!catalogDir?.trim()) return unavailable('OD_REFERENCE_CATALOG_DIR is not configured');
  const root = path.resolve(catalogDir);
  let parsed: unknown;
  let source = '';
  for (const name of ['search-index.json', 'assets.json']) {
    try { parsed = JSON.parse(await readFile(path.join(root, name), 'utf8')); source = name; break; } catch {}
  }
  if (!source || !parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return unavailable(`invalid reference catalog in ${root}: search-index.json/assets.json not readable`);
  }
  const container = parsed as Record<string, unknown>;
  const raw = source === 'search-index.json' ? container.records : container.assets;
  if (!Array.isArray(raw)) return unavailable(`invalid reference catalog ${source}: records array missing`);
  const records = raw.map(normalizeRecord).filter((record): record is CatalogRecord => record !== null);
  if (!records.length) return unavailable(`invalid reference catalog ${source}: no valid records`);
  const byId = new Map(records.map((record) => [record.id, record]));

  const search = (request: CuratedReferenceSearchRequest): CuratedReferenceSearchResponse => {
    const queryTerms = terms(request.query);
    const status = request.status ?? 'accepted';
    const allowedLibraries = request.libraryIds?.length ? new Set(request.libraryIds) : null;
    const scored = records.filter((record) => record.status === status && (!allowedLibraries || allowedLibraries.has(record.libraryId))).map((record) => {
      let score = 0; const matchedFields: string[] = [];
      for (const [field, weight] of FIELD_WEIGHTS) {
        const text = fieldText(record, field);
        const matches = queryTerms.filter((term) => text.includes(term)).length;
        if (matches) { score += matches * weight; matchedFields.push(String(field)); }
      }
      if (request.query.trim() && fieldText(record, 'title').includes(request.query.trim().toLocaleLowerCase())) score += 10;
      return { record, score, matchedFields };
    }).filter((item) => queryTerms.length === 0 || item.score > 0)
      .sort((a,b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(request.limit ?? DEFAULT_LIMIT)));
    return { query: request.query, results: scored.slice(0, limit).map((item) => toHit(item.record, item.score, item.matchedFields)), total: scored.length };
  };

  return {
    available: true,
    search,
    get(id) { const record = byId.get(id); return record ? { reference: toHit(record, 0, []) } : null; },
    recommend(request) {
      const profile = request.profile;
      const query = [profile.goal, profile.audience, profile.deliverable, ...(profile.styleTraits ?? []), ...(profile.constraints ?? [])].filter(Boolean).join(' ');
      const candidate = search({ query, limit: MAX_LIMIT }).results;
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(request.limit ?? DEFAULT_LIMIT)));
      const diverse: CuratedReferenceHit[] = []; const used = new Set<string>();
      for (const hit of candidate) if (!used.has(hit.libraryId) && diverse.length < limit) { diverse.push(hit); used.add(hit.libraryId); }
      for (const hit of candidate) if (!diverse.includes(hit) && diverse.length < limit) diverse.push(hit);
      return { profile, results: diverse, total: candidate.length };
    },
  };
}
