export type CuratedReferenceStatus = 'accepted' | 'lead' | 'backfill-needed' | string;

export interface CuratedReferenceHit {
  id: string;
  kind: string;
  libraryId: string;
  status: CuratedReferenceStatus;
  title: string;
  snippet: string;
  tags: string[];
  roles: string[];
  previewPath?: string;
  sourcePath?: string;
  score: number;
  matchedFields: string[];
}

export interface CuratedReferenceSearchRequest {
  query: string;
  limit?: number;
  status?: CuratedReferenceStatus;
  libraryIds?: string[];
}

export interface CuratedReferenceSearchResponse {
  query: string;
  results: CuratedReferenceHit[];
  total: number;
}

export interface CuratedReferenceDetail {
  id: string;
  kind: string;
  libraryId: string;
  status: CuratedReferenceStatus;
  title: string;
  summary: string;
  tags: string[];
  useCases: string[];
  userWords: string[];
  visualTraits: string[];
  roles: string[];
  sourcePolicy?: string;
  captureDepth?: string;
  sourcePath?: string;
  previewPath?: string;
  sourceUrls: string[];
  sourceUrlHashes: string[];
  files: Record<string, string>;
}

export interface CuratedReferenceDetailResponse {
  reference: CuratedReferenceDetail;
}

export interface CuratedReferenceProfile {
  goal: string;
  audience?: string;
  deliverable?: string;
  styleTraits?: string[];
  constraints?: string[];
}

export interface CuratedReferenceRecommendRequest {
  profile: CuratedReferenceProfile;
  limit?: number;
}

export interface CuratedReferenceRecommendResponse {
  profile: CuratedReferenceProfile;
  results: CuratedReferenceHit[];
  total: number;
}
