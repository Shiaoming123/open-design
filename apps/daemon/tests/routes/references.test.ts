import express from 'express';
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createToolRequestAuth } from '../../src/http/tool-request-auth.js';
import { registerReferenceRoutes } from '../../src/routes/references.js';
import type { ReferenceCatalog } from '../../src/references/catalog.js';
import { ToolTokenRegistry } from '../../src/tool-tokens.js';

describe('reference routes', () => {
  let server: http.Server; let baseUrl = '';
  const tokenRegistry = new ToolTokenRegistry();
  const hit = { id:'poster:one', kind:'case-study', libraryId:'poster', status:'accepted', title:'One', snippet:'Grid poster', tags:['poster'], roles:['reference'], score:12, matchedFields:['title'] };
  const detail = { id:hit.id, kind:hit.kind, libraryId:hit.libraryId, status:hit.status, title:hit.title, summary:hit.snippet, tags:hit.tags, useCases:['launch'], userWords:[], visualTraits:['grid'], roles:hit.roles, captureDepth:'artifact-study', sourceUrls:['https://example.com/poster'], sourceUrlHashes:['0123456789abcdef'], files:{source:'poster/one.json'} };
  const search = (request: {query:string}) => ({ query:request.query, results:[hit], total:1 });
  const catalog: ReferenceCatalog = { available:true, search, get:(id)=>id===hit.id?{reference:detail}:null, recommend:(request)=>({profile:request.profile,results:[hit],total:1}) };

  beforeAll(async () => {
    const app=express(); app.use(express.json());
    registerReferenceRoutes(app,{ catalog, sendApiError:(res,status,code,message)=>res.status(status).json({error:{code,message}}), authorizeToolRequest:createToolRequestAuth(tokenRegistry).authorizeToolRequest });
    server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',()=>r()));
    const address=server.address(); baseUrl=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}`;
  });
  afterAll(()=>new Promise<void>(r=>server.close(()=>{tokenRegistry.clear();r();})));

  it('serves search, detail, recommendation and tool wrapper parity', async () => {
    const searchResponse=await fetch(`${baseUrl}/api/references/search`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'poster'})});
    expect(searchResponse.status).toBe(200); const body=await searchResponse.json();
    const searchGrant=tokenRegistry.mint({runId:'search-parity',projectId:'p1',allowedEndpoints:['/api/tools/references/search'],allowedOperations:['references:search']});
    expect(await (await fetch(`${baseUrl}/api/tools/references/search`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${searchGrant.token}`},body:JSON.stringify({query:'poster'})})).json()).toEqual(body);
    expect(((await (await fetch(`${baseUrl}/api/references/${encodeURIComponent(hit.id)}`)).json()) as {reference:typeof detail}).reference).toEqual(detail);
    const detailPath=`/api/tools/references/${encodeURIComponent(hit.id)}`;
    const detailGrant=tokenRegistry.mint({runId:'detail-parity',projectId:'p1',allowedEndpoints:[detailPath],allowedOperations:['references:read']});
    expect(((await (await fetch(`${baseUrl}${detailPath}`,{headers:{authorization:`Bearer ${detailGrant.token}`}})).json()) as {reference:typeof detail}).reference).toEqual(detail);
    const recommend=await fetch(`${baseUrl}/api/references/recommend`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:{goal:'launch poster'}})});
    expect(recommend.status).toBe(200);
  });

  it('rejects malformed requests and reports missing references', async () => {
    expect((await fetch(`${baseUrl}/api/references/search`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/references/recommend`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:{}})})).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/references/missing`)).status).toBe(404);
  });

  it.each([
    { goal: 'x', audience: 1 },
    { goal: 'x', deliverable: [] },
    { goal: 'x', styleTraits: 'grid' },
    { goal: 'x', styleTraits: [1] },
    { goal: 'x', constraints: {} },
    { goal: 'x', constraints: ['ok', 2] },
  ])('rejects malformed structured recommendation profile %#', async (profile) => {
    const response=await fetch(`${baseUrl}/api/references/recommend`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile})});
    expect(response.status).toBe(400);
  });

  it('enforces bearer presence, endpoint grants and operation grants through the real authorizer', async () => {
    const request = (authorization?: string) => fetch(`${baseUrl}/api/tools/references/search`,{
      method:'POST',
      headers:{'content-type':'application/json',...(authorization?{authorization}:{})},
      body:JSON.stringify({query:'poster'}),
    });
    const missing=await request();
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({error:{code:'TOOL_TOKEN_MISSING'}});

    const endpointGrant=tokenRegistry.mint({runId:'wrong-endpoint',projectId:'p1',allowedEndpoints:['/api/tools/references/other'],allowedOperations:['references:search']});
    const endpointDenied=await request(`Bearer ${endpointGrant.token}`);
    expect(endpointDenied.status).toBe(403);
    expect(await endpointDenied.json()).toMatchObject({error:{code:'TOOL_ENDPOINT_DENIED'}});

    const operationGrant=tokenRegistry.mint({runId:'wrong-operation',projectId:'p1',allowedEndpoints:['/api/tools/references/search'],allowedOperations:['references:read']});
    const operationDenied=await request(`Bearer ${operationGrant.token}`);
    expect(operationDenied.status).toBe(403);
    expect(await operationDenied.json()).toMatchObject({error:{code:'TOOL_OPERATION_DENIED'}});
  });
});
