import {expect,it} from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {AtelierStore} from './store';
import {AssetProductionService} from './asset-production';
import {prepareAssetJobCodexSession,startNewAssetJobCodexSession,type AssetJobSessionReaders} from './asset-job-codex-session';
import {AssetJobDataSchema} from '../shared/asset-production';

it('persists the previous verified job session when a new session replaces it',async()=>{
 const base=path.resolve('evidence/assets-production-20261029');fs.mkdirSync(base,{recursive:true});
 const root=fs.mkdtempSync(path.join(base,'session-persistence-')),key=path.join(root,'key'),previousCodexHome=process.env.CODEX_HOME;
 const codexHome=path.join(root,'codex-home');fs.mkdirSync(codexHome);process.env.CODEX_HOME=codexHome;
 let store:AtelierStore|undefined=new AtelierStore(root,key);
 try{
  const job=new AssetProductionService(store).create({name:'Session fixture',mode:'composite',target:'Fixture'}).job;
  const work=path.join(root,'work','assets',job.id);fs.mkdirSync(work,{recursive:true});
  const first=crypto.randomUUID(),second=crypto.randomUUID();let now=Date.now(),rows:any[]=[];
  const readers:AssetJobSessionReaders={now:()=>now,readAll:async()=>({available:true,threads:rows}),readById:async id=>({available:true,threads:rows.filter(row=>row.id===id)}),findNew:async query=>{const matches=rows.filter(row=>row.cwd===query.cwd&&!query.baselineIds.includes(row.id));return {index:{available:true,threads:matches},thread:matches.length===1?matches[0]:null};}};
  const launched=await prepareAssetJobCodexSession(store,job,work,readers);
  rows=[{id:first,cwd:work,source:'cli',archived:false,createdAtMs:launched.pending!.startedAtMs+1}];
  await prepareAssetJobCodexSession(store,store.get('assetJob',job.id)!,work,readers);
  const original=AssetJobDataSchema.parse(store.get('assetJob',job.id)!.data).codexSession!.current!;
  expect(original.sessionId).toBe(first);
  now+=2000;const next=await startNewAssetJobCodexSession(store,job.id,work,readers);
  rows.push({id:second,cwd:work,source:'cli',archived:false,createdAtMs:next.pending!.startedAtMs+1});
  await prepareAssetJobCodexSession(store,store.get('assetJob',job.id)!,work,readers);
  store.db.close();store=undefined;
  store=new AtelierStore(root,key);
  const saved=AssetJobDataSchema.parse(store.get('assetJob',job.id)!.data).codexSession!;
  expect(saved.current?.sessionId).toBe(second);
  expect(saved.history).toHaveLength(1);
  expect(saved.history[0]).toMatchObject({sessionId:original.sessionId,scope:original.scope});
  expect(Date.parse(saved.history[0].verifiedAt)).toBeGreaterThanOrEqual(Date.parse(original.verifiedAt));
  expect(saved.current?.scope).toEqual(original.scope);
 }finally{store?.db.close();if(previousCodexHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousCodexHome;fs.rmSync(root,{recursive:true,force:true});}
});
