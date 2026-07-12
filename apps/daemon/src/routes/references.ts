import type { Express, Request, Response } from 'express';
import type { CuratedReferenceRecommendRequest, CuratedReferenceSearchRequest } from '@open-design/contracts';
import { ReferenceCatalogUnavailableError, type ReferenceCatalog } from '../references/catalog.js';

export interface RegisterReferenceRoutesDeps {
  catalog: ReferenceCatalog;
  sendApiError: (res: Response, status: number, code: string, message: string) => unknown;
  authorizeToolRequest: (req: Request, res: Response, scope: string) => unknown;
}

function positiveLimit(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function optionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
}

export function registerReferenceRoutes(app: Express, deps: RegisterReferenceRoutesDeps): void {
  const { catalog, sendApiError, authorizeToolRequest } = deps;
  const unavailable = (res: Response, error: unknown) => {
    if (error instanceof ReferenceCatalogUnavailableError) return sendApiError(res, 503, 'REFERENCES_UNAVAILABLE', error.message);
    return sendApiError(res, 500, 'REFERENCES_FAILED', error instanceof Error ? error.message : String(error));
  };
  const parseSearch = (body: unknown): CuratedReferenceSearchRequest | null => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const input = body as Record<string, unknown>;
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    const limit = positiveLimit(input.limit);
    if (!query || limit === null) return null;
    if (input.libraryIds !== undefined && (!Array.isArray(input.libraryIds) || input.libraryIds.some((value) => typeof value !== 'string'))) return null;
    return { query, ...(limit ? { limit } : {}), ...(typeof input.status === 'string' ? { status: input.status } : {}), ...(Array.isArray(input.libraryIds) ? { libraryIds: input.libraryIds as string[] } : {}) };
  };
  const runSearch = (req: Request, res: Response) => {
    const request = parseSearch(req.body);
    if (!request) return sendApiError(res, 400, 'BAD_REQUEST', 'query is required and limit must be a positive integer');
    try { return res.json(catalog.search(request)); } catch (error) { return unavailable(res, error); }
  };
  const runGet = (req: Request, res: Response) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return sendApiError(res, 400, 'BAD_REQUEST', 'reference id is required');
    try { const result = catalog.get(id); return result ? res.json(result) : sendApiError(res, 404, 'NOT_FOUND', 'reference not found'); }
    catch (error) { return unavailable(res, error); }
  };

  app.post('/api/references/search', runSearch);
  app.get('/api/references/:id', runGet);
  app.post('/api/references/recommend', (req, res) => {
    const input = req.body as Partial<CuratedReferenceRecommendRequest> | undefined;
    const limit = positiveLimit(input?.limit);
    const profile = input?.profile;
    const allowed = new Set(['goal', 'audience', 'deliverable', 'styleTraits', 'constraints']);
    if (!profile || typeof profile.goal !== 'string' || !profile.goal.trim() || limit === null
      || Object.keys(profile).some((key) => !allowed.has(key))
      || !optionalString(profile.audience) || !optionalString(profile.deliverable)
      || !optionalStringArray(profile.styleTraits) || !optionalStringArray(profile.constraints)) {
      return sendApiError(res, 400, 'BAD_REQUEST', 'profile fields must use the curated reference contract');
    }
    const normalized = {
      goal: profile.goal.trim(),
      ...(profile.audience !== undefined ? { audience: profile.audience.trim() } : {}),
      ...(profile.deliverable !== undefined ? { deliverable: profile.deliverable.trim() } : {}),
      ...(profile.styleTraits !== undefined ? { styleTraits: profile.styleTraits.map((value) => value.trim()).filter(Boolean) } : {}),
      ...(profile.constraints !== undefined ? { constraints: profile.constraints.map((value) => value.trim()).filter(Boolean) } : {}),
    };
    try { return res.json(catalog.recommend({ profile: normalized, ...(limit ? { limit } : {}) })); }
    catch (error) { return unavailable(res, error); }
  });
  app.post('/api/tools/references/search', (req, res) => {
    if (!authorizeToolRequest(req, res, 'references:search')) return;
    return runSearch(req, res);
  });
  app.get('/api/tools/references/:id', (req, res) => {
    if (!authorizeToolRequest(req, res, 'references:read')) return;
    return runGet(req, res);
  });
}
