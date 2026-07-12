import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root=fileURLToPath(new URL('..',import.meta.url)); const cli=fileURLToPath(new URL('../src/cli.ts',import.meta.url));
function run(base:string,args:string[],input?:string){return new Promise<{code:number;stdout:string;stderr:string}>(resolve=>{const child=spawn(process.execPath,['--import','tsx',cli,'references',...args,'--daemon-url',base,'--json'],{cwd:root,env:{...process.env}});let stdout='';let stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('close',code=>resolve({code:code??0,stdout,stderr}));if(input!==undefined)child.stdin.end(input);else child.stdin.end();});}

describe('od references CLI',()=>{
  it('documents prompt-file for search',async()=>{
    const result=await run('http://127.0.0.1:1',['help']);
    expect(result.code,result.stderr).toBe(0);
    expect(result.stdout).toContain('search <query> [--prompt-file <path|->]');
  });

  it('keeps search/show/recommend on shared endpoints and supports prompt files',async()=>{
    const seen:Array<{method:string;url:string;body:unknown}>=[];
    const server=http.createServer((req,res)=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{seen.push({method:req.method||'',url:req.url||'',body:raw?JSON.parse(raw):null});res.setHeader('content-type','application/json');res.end(JSON.stringify(req.method==='GET'?{reference:{id:'poster:one'}}:{results:[{id:'poster:one'}],total:1}));});});
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',()=>r())); const address=server.address();if(!address||typeof address==='string')throw new Error('bind');const base=`http://127.0.0.1:${address.port}`;
    const dir=await mkdtemp(path.join(os.tmpdir(),'od-ref-cli-'));const prompt=path.join(dir,'prompt.txt');await writeFile(prompt,'Launch poster for designers');
    try{
      for(const args of [['search','swiss poster'],['search','--prompt-file',prompt],['show','poster:one'],['recommend','--prompt-file',prompt]]){const result=await run(base,args);expect(result.code,result.stderr).toBe(0);expect(()=>JSON.parse(result.stdout)).not.toThrow();}
      const stdinSearch=await run(base,['search','--prompt-file','-'],'Editorial grid from stdin');expect(stdinSearch.code,stdinSearch.stderr).toBe(0);
      expect(seen).toEqual([
        {method:'POST',url:'/api/references/search',body:{query:'swiss poster'}},
        {method:'POST',url:'/api/references/search',body:{query:'Launch poster for designers'}},
        {method:'GET',url:'/api/references/poster%3Aone',body:null},
        {method:'POST',url:'/api/references/recommend',body:{profile:{goal:'Launch poster for designers'}}},
        {method:'POST',url:'/api/references/search',body:{query:'Editorial grid from stdin'}},
      ]);
    }finally{await new Promise<void>(r=>server.close(()=>r()));}
  });
});
