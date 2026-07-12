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

export interface CuratedReferenceDetailResponse {
  reference: CuratedReferenceHit;
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
