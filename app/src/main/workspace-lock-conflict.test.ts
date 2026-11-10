import {describe,expect,it} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtelierStore} from './store';

describe('workspace lock conflict handling',()=>{
 it('keeps the active workspace lock and rejects a second store',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aetherflow-workspace-lock-'));
  let active:AtelierStore|undefined;
  try{
   active=new AtelierStore(root,path.join(root,'backup-authenticator.key'));
   const lockPath=path.join(root,'.atelier.lock'),before=fs.readFileSync(lockPath,'utf8');
   expect(()=>new AtelierStore(root,path.join(root,'backup-authenticator.key'))).toThrow('Workspace is locked by another Atelier process.');
   expect(fs.readFileSync(lockPath,'utf8')).toBe(before);
  }finally{
   try{active?.db.close();}catch{}
   fs.rmSync(root,{recursive:true,force:true});
  }
 });
});
