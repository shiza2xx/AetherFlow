import {afterEach,describe,expect,it} from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AtelierStore} from './store';

describe('portable workspace backup restore',()=>{
 const roots:string[]=[],stores:AtelierStore[]=[];
 afterEach(()=>{for(const store of stores.splice(0))try{store.db.close()}catch{}for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
 it('restores generated managed bytes and rejects a tampered object without activating or mutating the source workspace',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'aetherflow-restore-portable-')),key=path.join(root,'auth.key'),store=new AtelierStore(path.join(root,'source'),key);roots.push(root);stores.push(store);
  const bytes=Buffer.from('fully synthetic portable restore bytes'),blob=store.registerImmutableBytes(bytes,'application/octet-stream'),task=store.put({kind:'task',name:'Portable restore task',data:{status:'In progress',progress:42}}),artifact=store.put({kind:'artifact',name:'Synthetic source.bin',data:{hash:blob.hash,bytes:blob.bytes,mime:'application/octet-stream',sourceName:'synthetic-source.bin'}});store.link(task.id,artifact.id,'source artifact');
  const backup=path.join(root,'backup'),validDestination=path.join(root,'valid-restore');await store.createWorkspaceBackup(backup);const restored=await store.restoreWorkspace(backup,validDestination),copy=new AtelierStore(validDestination,key);stores.push(copy);
  expect(restored.trustedBackup).toBe(true);expect(copy.get('task',task.id)).toEqual(task);expect(copy.get('artifact',artifact.id)).toEqual(artifact);expect(copy.links(task.id)).toMatchObject([expect.objectContaining({to_id:artifact.id,role:'source artifact'})]);expect(fs.readFileSync(copy.object(blob.hash)!)).toEqual(bytes);
  const tampered=path.join(root,'tampered-backup'),db=store.db;fs.cpSync(backup,tampered,{recursive:true});const manifest=JSON.parse(fs.readFileSync(path.join(tampered,'manifest.json'),'utf8')),objectPath=path.join(tampered,'objects',blob.hash);fs.writeFileSync(objectPath,Buffer.from('not the original hash-verified bytes'));const invalidDestination=path.join(root,'invalid-restore');await expect(store.restoreWorkspace(tampered,invalidDestination)).rejects.toMatchObject({code:'BACKUP_INTEGRITY_MISMATCH'});expect(fs.existsSync(invalidDestination)).toBe(false);expect(store.root).toBe(store.settings().workspace);expect(store.db).toBe(db);expect(store.get('task',task.id)).toEqual(task);expect(crypto.createHash('sha256').update(fs.readFileSync(store.object(blob.hash)!)).digest('hex')).toBe(blob.hash);expect(manifest.files.some((entry:any)=>entry.hash===blob.hash)).toBe(true);
 },120000);
});
