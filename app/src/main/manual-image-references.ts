import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {AtelierStore} from './store';
import type {StorageOwner} from './workspace-layout';
import {ownerForArtifact,safeStorageName,workspaceLayout} from './workspace-layout';

const mimeExtension:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};

function ensureSafeDirectory(directory:string,root:string){
 const resolvedRoot=fs.realpathSync.native(path.resolve(root));if(!path.isAbsolute(directory)||!directory.startsWith(resolvedRoot+path.sep))throw new Error('Manual reference folder is outside the workspace.');
 let probe=resolvedRoot;for(const component of path.relative(resolvedRoot,directory).split(path.sep)){probe=path.join(probe,component);if(!fs.existsSync(probe))break;const stat=fs.lstatSync(probe);if(stat.isSymbolicLink()||fs.realpathSync.native(probe)!==probe)throw new Error('Manual reference folder is unsafe.');}
 fs.mkdirSync(directory,{recursive:true});if(fs.realpathSync.native(directory)!==path.resolve(directory))throw new Error('Manual reference folder is unsafe.');return directory;
}

/** Make a named, suffixed, hash-verified copy under the owning workspace. */
export function materializeManualImageReference(store:AtelierStore,owner:StorageOwner,reference:{artifactId:string;hash:string;name:string;role:string}){
 const artifact=store.get('artifact',reference.artifactId);if(!artifact)throw new Error('The managed reference artifact no longer exists.');
 const actualOwner=ownerForArtifact(store,artifact);if(actualOwner?.kind!==owner.kind||actualOwner.id!==owner.id)throw new Error('The reference belongs to a different production owner.');
 const hash=String(artifact.data.hash||'');if(!/^[a-f0-9]{64}$/.test(hash)||hash!==reference.hash)throw new Error('The managed reference hash changed. Refresh the prompt before attaching it.');
 const mime=String(artifact.data.mime||'').toLowerCase(),extension=mimeExtension[mime];if(!extension)throw new Error('Only PNG, JPEG, and WebP references can be attached to an image generator.');
 const source=store.object(hash);if(!source||!fs.existsSync(source)||!fs.lstatSync(source).isFile()||fs.lstatSync(source).isSymbolicLink()||fs.realpathSync.native(source)!==path.resolve(source))throw new Error('The managed reference bytes are unavailable or unsafe.');
 const bytes=fs.readFileSync(source);if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('The managed reference failed its content hash check.');
 const layout=workspaceLayout(store.root),folder=ensureSafeDirectory(layout.category(owner,'references'),layout.workspace),base=safeStorageName(`${reference.role}-${path.basename(reference.name, path.extname(reference.name))}`,'reference').slice(0,100),destination=path.join(folder,`${base}-${hash.slice(0,16)}${extension}`);
 if(fs.existsSync(destination)){
  const stat=fs.lstatSync(destination);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(destination)!==path.resolve(destination)||crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')!==hash)throw new Error('A different file already occupies this named reference path. The existing file was not changed.');
 }else{
  try{fs.writeFileSync(destination,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  const stat=fs.lstatSync(destination);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(destination)!==path.resolve(destination)||crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex')!==hash)throw new Error('The named reference copy failed its content hash check.');
 }
 return {path:destination,directory:folder,bytes:bytes.length,hash,extension};
}

export function manualImageReferenceFolder(store:AtelierStore,owner:StorageOwner){
 const folder=workspaceLayout(store.root).category(owner,'references');return ensureSafeDirectory(folder,workspaceLayout(store.root).workspace);
}
