import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CuratedReferenceDetailResponse,
  CuratedReferenceDetail,
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

interface CatalogAsset extends CatalogRecord {
  summary: string;
  tags: string[];
  useCases: string[];
  userWords: string[];
  visualTraits: string[];
  roles: string[];
  sourcePolicy?: string;
  captureDepth?: string;
  sourceUrls: string[];
  sourceUrlHashes: string[];
  files: Record<string, string>;
}

type RankingField = 'title' | 'roles' | 'useCases' | 'tags' | 'visualTraits' | 'summary' | 'userWords' | 'libraryId';
interface RankingProfile {
  schemaVersion: 'od-reference-ranking/v1';
  matchMode: 'all-concepts';
  tokenization: 'unicode-alphanumeric';
  weights: Record<RankingField, number>;
  conceptGroups: string[][];
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const RANKING_FIELDS: RankingField[] = ['title', 'roles', 'useCases', 'tags', 'visualTraits', 'summary', 'userWords', 'libraryId'];
const V1_WEIGHTS: Record<RankingField, number> = {
  title: 10, roles: 6, useCases: 5, tags: 4, visualTraits: 3, summary: 2, userWords: 2, libraryId: 1,
};
const V1_CONCEPT_GROUPS = [
  ['仪表盘', 'dashboard', 'metrics'], ['控制台', 'console'], ['海报', 'poster'],
  ['编辑', 'editorial', 'magazine'], ['发布', 'launch', 'campaign', 'marketing'],
  ['动效', 'motion', 'animation'], ['交互', 'interaction'], ['博客', 'blog', 'digital garden'],
  ['应用', 'app', 'application'], ['设计系统', 'design-system', 'tokens'], ['模板', 'template'],
  ['数据可视化', 'data-visualization', 'chart'], ['移动端', 'mobile'],
];
const DEFAULT_RANKING: RankingProfile = {
  schemaVersion: 'od-reference-ranking/v1', matchMode: 'all-concepts', tokenization: 'unicode-alphanumeric',
  weights: V1_WEIGHTS, conceptGroups: V1_CONCEPT_GROUPS,
};

export class ReferenceCatalogUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'ReferenceCatalogUnavailableError'; }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function safeCatalogPath(value: string): boolean {
  return value.length > 0
    && !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.includes('\\')
    && !value.split('/').includes('..')
    && !/^[a-z][a-z0-9+.-]*:/i.test(value);
}

function normalizeRecord(value: unknown): CatalogRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  for (const key of ['id','kind','libraryId','status','title']) if (typeof item[key] !== 'string') return null;
  if (typeof item.sourcePath === 'string' && !safeCatalogPath(item.sourcePath)) return null;
  if (typeof item.previewPath === 'string' && !safeCatalogPath(item.previewPath)) return null;
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

function normalizeFiles(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value);
  if (entries.some(([, file]) => typeof file !== 'string' || !safeCatalogPath(file))) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function normalizeAsset(value: unknown): CatalogAsset | null {
  const record = normalizeRecord(value);
  if (!record || !value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const files = normalizeFiles(item.files);
  if (files === null) return null;
  return {
    ...record,
    summary: record.summary ?? '', tags: record.tags ?? [], useCases: record.useCases ?? [],
    userWords: record.userWords ?? [], visualTraits: record.visualTraits ?? [], roles: record.roles ?? [],
    ...(typeof item.sourcePolicy === 'string' ? { sourcePolicy: item.sourcePolicy } : {}),
    ...(typeof item.captureDepth === 'string' ? { captureDepth: item.captureDepth } : {}),
    sourceUrls: strings(item.sourceUrls), sourceUrlHashes: strings(item.sourceUrlHashes), files,
  };
}

function normalizeRanking(value: unknown): RankingProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 'od-reference-ranking/v1' || input.matchMode !== 'all-concepts' || input.tokenization !== 'unicode-alphanumeric') return null;
  if (!input.weights || typeof input.weights !== 'object' || Array.isArray(input.weights)) return null;
  const weights = input.weights as Record<string, unknown>;
  if (Object.keys(weights).length !== RANKING_FIELDS.length || RANKING_FIELDS.some((field) => weights[field] !== V1_WEIGHTS[field])) return null;
  if (!Array.isArray(input.conceptGroups) || !input.conceptGroups.length) return null;
  const conceptGroups = input.conceptGroups.map((group) => strings(group).map((term) => term.trim().toLocaleLowerCase()).filter(Boolean));
  if (conceptGroups.some((group, index) => !group.length || group.length !== (input.conceptGroups as unknown[][])[index]?.length)) return null;
  return { schemaVersion: input.schemaVersion, matchMode: input.matchMode, tokenization: input.tokenization, weights: { ...V1_WEIGHTS }, conceptGroups };
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function concepts(query: string, ranking: RankingProfile): string[][] {
  return tokens(query).map((token) => ranking.conceptGroups.find((group) => group.includes(token)) ?? [token]);
}

function matchesConcept(text: string, concept: string[]): boolean {
  const haystack = new Set(tokens(text));
  return concept.some((alternative) => tokens(alternative).every((token) => haystack.has(token)));
}

function fieldText(record: CatalogRecord, key: keyof CatalogRecord): string {
  const value = record[key];
  return (Array.isArray(value) ? value.join(' ') : String(value ?? '')).toLocaleLowerCase();
}

function toDetail(asset: CatalogAsset): CuratedReferenceDetail {
  return {
    id: asset.id, kind: asset.kind, libraryId: asset.libraryId, status: asset.status, title: asset.title,
    summary: asset.summary, tags: asset.tags, useCases: asset.useCases, userWords: asset.userWords,
    visualTraits: asset.visualTraits, roles: asset.roles,
    ...(asset.sourcePolicy ? { sourcePolicy: asset.sourcePolicy } : {}),
    ...(asset.captureDepth ? { captureDepth: asset.captureDepth } : {}),
    ...(asset.sourcePath ? { sourcePath: asset.sourcePath } : {}),
    ...(asset.previewPath ? { previewPath: asset.previewPath } : {}),
    sourceUrls: asset.sourceUrls, sourceUrlHashes: asset.sourceUrlHashes, files: asset.files,
  };
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
  let assets: CatalogAsset[] = [];
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'assets.json'), 'utf8')) as Record<string, unknown>;
    if (Array.isArray(parsed.assets)) assets = parsed.assets.map(normalizeAsset).filter((asset): asset is CatalogAsset => asset !== null);
  } catch {}
  if (!assets.length) return unavailable(`invalid reference catalog in ${root}: assets.json contains no valid records`);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  let records: CatalogRecord[] = assets;
  let ranking = DEFAULT_RANKING;
  try {
    const parsed = JSON.parse(await readFile(path.join(root, 'search-index.json'), 'utf8')) as Record<string, unknown>;
    const profile = normalizeRanking(parsed.ranking);
    const indexed = Array.isArray(parsed.records)
      ? parsed.records.map(normalizeRecord).filter((record): record is CatalogRecord => record !== null && byId.has(record.id))
      : [];
    if (profile && indexed.length) { ranking = profile; records = indexed; }
  } catch {}

  const rank = (request: CuratedReferenceSearchRequest) => {
    const queryConcepts = concepts(request.query, ranking);
    const status = request.status ?? 'accepted';
    const allowedLibraries = request.libraryIds?.length ? new Set(request.libraryIds) : null;
    return records.filter((record) => record.status === status && (!allowedLibraries || allowedLibraries.has(record.libraryId))).map((record) => {
      let score = 0; const matchedFields: string[] = [];
      for (const field of RANKING_FIELDS) {
        const weight = ranking.weights[field];
        const text = fieldText(record, field);
        const matches = queryConcepts.filter((concept) => matchesConcept(text, concept)).length;
        if (matches) { score += matches * weight; matchedFields.push(String(field)); }
      }
      return { record, score, matchedFields };
    }).filter((item) => {
      if (!queryConcepts.length) return true;
      const allText = RANKING_FIELDS.map((field) => fieldText(item.record, field)).join(' ');
      return item.score > 0 && queryConcepts.every((concept) => matchesConcept(allText, concept));
    })
      .sort((a,b) => b.score - a.score || a.record.id.localeCompare(b.record.id));
  };

  const search = (request: CuratedReferenceSearchRequest): CuratedReferenceSearchResponse => {
    const scored = rank(request);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(request.limit ?? DEFAULT_LIMIT)));
    return { query: request.query, results: scored.slice(0, limit).map((item) => toHit(item.record, item.score, item.matchedFields)), total: scored.length };
  };

  return {
    available: true,
    search,
    get(id) { const asset = byId.get(id); return asset ? { reference: toDetail(asset) } : null; },
    recommend(request) {
      const profile = request.profile;
      const query = [profile.goal, profile.audience, profile.deliverable, ...(profile.styleTraits ?? [])].filter(Boolean).join(' ');
      const constraintConcepts = concepts((profile.constraints ?? []).join(' '), ranking);
      const candidate = rank({ query }).map(({ record, score, matchedFields }) => {
        const hit = toHit(record, score, matchedFields);
        const haystack = RANKING_FIELDS.map((field) => fieldText(record, field)).join(' ');
        const penalty = constraintConcepts.filter((concept) => matchesConcept(haystack, concept)).length * 1_000;
        return penalty ? { ...hit, score: hit.score - penalty } : hit;
      }).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(request.limit ?? DEFAULT_LIMIT)));
      const diverse: CuratedReferenceHit[] = []; const used = new Set<string>();
      for (const hit of candidate) if (!used.has(hit.libraryId) && diverse.length < limit) { diverse.push(hit); used.add(hit.libraryId); }
      for (const hit of candidate) if (!diverse.includes(hit) && diverse.length < limit) diverse.push(hit);
      return { profile, results: diverse, total: candidate.length };
    },
  };
}
