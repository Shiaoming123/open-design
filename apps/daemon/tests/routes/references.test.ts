import express from 'express';
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerReferenceRoutes } from '../../src/routes/references.js';
import type { ReferenceCatalog } from '../../src/references/catalog.js';

describe('reference routes', () => {
  let server: http.Server; let baseUrl = '';
  const hit = { id:'poster:one', kind:'case-study', libraryId:'poster', status:'accepted', title:'One', snippet:'Grid poster', tags:['poster'], roles:['reference'], score:12, matchedFields:['title'] };
  const search = (request: {query:string}) => ({ query:request.query, results:[hit], total:1 });
  const catalog: ReferenceCatalog = { available:true, search, get:(id)=>id===hit.id?{reference:{...hit,score:0,matchedFields:[]}}:null, recommend:(request)=>({profile:request.profile,results:[hit],total:1}) };

  beforeAll(async () => {
    const app=express(); app.use(express.json());
    registerReferenceRoutes(app,{ catalog, sendApiError:(res,status,code,message)=>res.status(status).json({error:{code,message}}), authorizeToolRequest:()=>({projectId:'p1'}) });
    server=app.listen(0,'127.0.0.1'); await new Promise<void>(r=>server.once('listening',()=>r()));
    const address=server.address(); baseUrl=`http://127.0.0.1:${typeof address==='object'&&address?address.port:0}`;
  });
  afterAll(()=>new Promise<void>(r=>server.close(()=>r())));

  it('serves search, detail, recommendation and tool wrapper parity', async () => {
    const searchResponse=await fetch(`${baseUrl}/api/references/search`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'poster'})});
    expect(searchResponse.status).toBe(200); const body=await searchResponse.json();
    expect(await (await fetch(`${baseUrl}/api/tools/references/search`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'poster'})})).json()).toEqual(body);
    expect(((await (await fetch(`${baseUrl}/api/references/${encodeURIComponent(hit.id)}`)).json()) as {reference:{id:string}}).reference.id).toBe(hit.id);
    expect(((await (await fetch(`${baseUrl}/api/tools/references/${encodeURIComponent(hit.id)}`)).json()) as {reference:{id:string}}).reference.id).toBe(hit.id);
    const recommend=await fetch(`${baseUrl}/api/references/recommend`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:{goal:'launch poster'}})});
    expect(recommend.status).toBe(200);
  });

  it('rejects malformed requests and reports missing references', async () => {
    expect((await fetch(`${baseUrl}/api/references/search`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/references/recommend`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile:{}})})).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/references/missing`)).status).toBe(404);
  });
});
