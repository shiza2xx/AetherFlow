import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {AtelierStore} from './store';
import {AtelierDomain} from './domain-service';
import {generationSources,prepareGeneration} from './generation';
import {snapshotGenerationInputs} from './generation-inputs';
import {resolveCodexRuntime,preflightCodexRuntime} from './codex-launch';

const spec={title:'Character',target:'Head + Body reference set',views:['front','left','right','back'],parts:'',style:'Source design',asymmetry:true,background:'white',repairTarget:''};
describe('source-driven manual generation',()=>{
 it('keeps historical source reads available but refuses retired legacy generation without mutating records',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-generation-retired-')),store=new AtelierStore(root),domain=new AtelierDomain(store);
  try{
    const source=path.join(root,'source.gif');fs.writeFileSync(source,Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64'));const art=await store.ingest(source);
    const concept=store.put({kind:'concept',name:'Source',data:{referenceArtifactIds:[],referenceArtifactId:art.id}});
    expect(generationSources(store,concept.id).sources.map(item=>item!.id)).toEqual([art.id]);
    expect(()=>prepareGeneration(store,domain,{entityId:concept.id,referenceIds:[art.id],spec},async()=>{})).toThrow(/Legacy reference generation is retired/);
    expect(store.list({kind:'character'})).toHaveLength(0);expect(store.get('concept',concept.id)?.data.productionStarted).not.toBe(true);
  }finally{store.db.close();fs.rmSync(root,{recursive:true,force:true});}
 }); it('rejects missing or unrelated sources before creating records',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-generation-empty-')),store=new AtelierStore(root),domain=new AtelierDomain(store);
  try{const concept=store.put({kind:'concept',name:'Empty',data:{referenceArtifactIds:[]}});expect(()=>prepareGeneration(store,domain,{entityId:concept.id,referenceIds:[crypto.randomUUID()],spec},async()=>{})).toThrow(/retired/);expect(store.list({kind:'character'})).toHaveLength(0);}finally{store.db.close();fs.rmSync(root,{recursive:true,force:true});}
 });
 it('copies hash-named image sources with extensions, repairs edited working copies, and rebases portable paths',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'atelier-inputs-')),id=crypto.randomUUID(),bytes=Buffer.from('immutable image bytes'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  try{fs.mkdirSync(path.join(root,'objects'));const original=path.join(root,'objects',hash);fs.writeFileSync(original,bytes);const inputs=[{id:crypto.randomUUID(),hash,name:'源 арт.webp',logicalPath:'源 арт.webp'}];
    const first=snapshotGenerationInputs(root,root,id,inputs);expect(fs.readFileSync(first[0].path)).toEqual(bytes);fs.writeFileSync(first[0].path,'edited');const again=snapshotGenerationInputs(root,root,id,inputs);expect(fs.readFileSync(again[0].path)).toEqual(bytes);expect(fs.readFileSync(original)).toEqual(bytes);
    expect(snapshotGenerationInputs(root,path.join(root,'portable'),id,inputs)[0].path).toContain(path.join('portable','work','characters',id,'references'));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 it('rejects Electron as Node and runs non-inference probes strictly sequentially',async()=>{
  const exists=new Set(['C:\\Tools\\node.exe','C:\\Tools\\codex.cmd','C:\\Tools\\node_modules\\@openai\\codex\\bin\\codex.js','C:\\Tools\\powershell.exe']);
  const runtime=resolveCodexRuntime({codexPath:'codex',nodePath:'C:\\Electron\\electron.exe'},{platform:'win32',pathEnv:'C:\\Tools',exists:value=>exists.has(value)});
  expect(runtime.node).toBe('C:\\Tools\\node.exe');expect(runtime.cliPath).toBe('C:\\Tools\\codex.cmd');let active=0,max=0;
  const result=await preflightCodexRuntime(runtime,async(_file,args)=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,1));active--;return {code:0,stdout:args.includes('--version')?'codex version':'',stderr:args.includes('login')?'Logged in with ChatGPT':''};});
  expect(max).toBe(1);expect(result.available).toBe(true);expect(result.authenticated).toBe(true);expect(result.imagegen).toBe('unknown');
 });
});
