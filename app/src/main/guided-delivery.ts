import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import type {AtelierStore} from './store';
import {workspaceLayout,safeStorageName} from './workspace-layout';

export type DeliveryFile={name:string;hash:string;bytes:number};
export type GuidedDelivery={characterId:string;artifactId:string;sourceHash:string;slotKey:string;directory:string;files:DeliveryFile[]};
const sha=(bytes:Buffer)=>crypto.createHash('sha256').update(bytes).digest('hex');
const handoff=/^(depth-handoff-(head|body)|segmentation-handoff|texture-handoff-[a-z0-9_]+|rig-studio-handoff)$/;
export const isGuidedHandoff=(key:string)=>handoff.test(key);
const MAX_MANIFEST=512*1024;
function owner(store:AtelierStore,characterId:string){const character=store.get('character',characterId);if(!character)throw new Error('Character was not found.');return {kind:'character' as const,id:characterId,name:character.name};}
function receiptPath(store:AtelierStore,characterId:string,artifactId:string){if(!/^[a-f0-9-]{36}$/i.test(artifactId))throw new Error('Invalid delivery artifact id.');const layout=workspaceLayout(store.root);return layout.resolve(path.relative(store.root,path.join(layout.internal(owner(store,characterId)),'deliveries',`${artifactId}.json`)).replaceAll('\\','/'));}
function safeRelative(name:string){const parts=name.replaceAll('\\','/').split('/');if(!parts.length||parts.some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new Error('Unsafe delivery filename.');return parts.join('/');}
async function hashFile(file:string){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024}))hash.update(chunk);return hash.digest('hex');}
function checkedDirectory(store:AtelierStore,characterId:string,directory:string){const layout=workspaceLayout(store.root),exports=layout.category(owner(store,characterId),'exports'),target=layout.resolve(path.relative(store.root,directory).replaceAll('\\','/'));if(!target.startsWith(exports+path.sep)||!fs.existsSync(target)||!fs.lstatSync(target).isDirectory())throw new Error('Delivery folder is missing or does not belong to this character.');return target;}

/** Read only the small ZIP provenance member. Large FBX/GLB members are never inflated into Electron. */
export async function handoffManifest(store:AtelierStore,artifactId:string):Promise<any>{
 const artifact=store.get('artifact',artifactId);if(!artifact)throw new Error('Handoff artifact is missing.');
 if(artifact.data.guidedHandoffManifest)return artifact.data.guidedHandoffManifest;
 const object=store.object(String(artifact.data.hash||''));if(!object)throw new Error('Handoff source bytes are missing.');
 const file=await fs.promises.open(object,'r');
 try{
  const stat=await file.stat(),tailSize=Math.min(stat.size,65557),tail=Buffer.alloc(tailSize);await file.read(tail,0,tailSize,stat.size-tailSize);
  let eocd=-1;for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50&&i+22+tail.readUInt16LE(i+20)===tail.length){eocd=i;break;}
  if(eocd<0)throw new Error('Handoff ZIP directory is missing.');
  const count=tail.readUInt16LE(eocd+10),size=tail.readUInt32LE(eocd+12),offset=tail.readUInt32LE(eocd+16);
  if(count>256||size>MAX_MANIFEST||offset+size>stat.size-tailSize+eocd)throw new Error('Handoff ZIP metadata exceeds its bounds.');
  const directory=Buffer.alloc(size);await file.read(directory,0,size,offset);let found:any=null,pos=0;
  for(let i=0;i<count;i++){
   if(pos+46>size||directory.readUInt32LE(pos)!==0x02014b50)throw new Error('Invalid handoff ZIP entry.');
   const names=directory.readUInt16LE(pos+28),extra=directory.readUInt16LE(pos+30),comment=directory.readUInt16LE(pos+32),end=pos+46+names+extra+comment;if(end>size)throw new Error('Truncated handoff ZIP directory.');
   if(directory.subarray(pos+46,pos+46+names).toString('utf8')==='provenance.json'){
    if(found)throw new Error('Duplicate handoff provenance.');found={method:directory.readUInt16LE(pos+10),compressed:directory.readUInt32LE(pos+20),expanded:directory.readUInt32LE(pos+24),offset:directory.readUInt32LE(pos+42)};
   }pos=end;
  }
  if(!found||found.compressed>MAX_MANIFEST||found.expanded>MAX_MANIFEST||found.offset+30>offset)throw new Error('Handoff provenance is missing or too large.');
  const header=Buffer.alloc(30);await file.read(header,0,30,found.offset);if(header.readUInt32LE(0)!==0x04034b50)throw new Error('Invalid handoff provenance header.');
  const start=found.offset+30+header.readUInt16LE(26)+header.readUInt16LE(28);if(start+found.compressed>offset)throw new Error('Handoff provenance escapes the archive.');
  const compressed=Buffer.alloc(found.compressed);await file.read(compressed,0,compressed.length,start);const bytes=found.method===0?compressed:found.method===8?inflateRawSync(compressed,{maxOutputLength:MAX_MANIFEST}):null;
  if(!bytes||bytes.length!==found.expanded)throw new Error('Handoff provenance could not be decoded.');return JSON.parse(bytes.toString('utf8'));
 }finally{await file.close();}
}

export function readGuidedDelivery(store:AtelierStore,characterId:string,artifactId:string):GuidedDelivery|null{
 try{
  if(!/^[a-f0-9-]{36}$/i.test(characterId)||!/^[a-f0-9-]{36}$/i.test(artifactId)||!fs.existsSync(path.join(store.root,'work','characters',characterId,'.aetherflow','deliveries',`${artifactId}.json`)))return null;
  const file=receiptPath(store,characterId,artifactId);if(!fs.existsSync(file)||fs.statSync(file).size>MAX_MANIFEST)return null;
  const receipt=JSON.parse(fs.readFileSync(file,'utf8')),artifact=store.get('artifact',artifactId);
  if(receipt.characterId!==characterId||receipt.artifactId!==artifactId||receipt.sourceHash!==artifact?.data.hash||!Array.isArray(receipt.files)||!receipt.files.length||receipt.files.length>512)return null;
  const directory=checkedDirectory(store,characterId,workspaceLayout(store.root).resolve(receipt.directory));
  for(const item of receipt.files){const name=safeRelative(item.name),target=workspaceLayout(store.root).resolve(path.relative(store.root,path.join(directory,...name.split('/'))).replaceAll('\\','/'));if(!/^[a-f0-9]{64}$/.test(item.hash)||!fs.existsSync(target)||!fs.lstatSync(target).isFile()||fs.statSync(target).size!==item.bytes)return null;}
  return {...receipt,directory};
 }catch{return null;}
}

function stageName(slotKey:string){if(slotKey.startsWith('depth-handoff-'))return '04-mesh-generation';if(slotKey==='segmentation-handoff')return '06-segmentation';if(slotKey.startsWith('texture-handoff-'))return '09-texturing';if(slotKey==='rig-studio-handoff')return '12-rigging';return 'model-files';}
function folderName(slotKey:string){if(slotKey.startsWith('depth-handoff-'))return slotKey.endsWith('head')?'Head':'Body';if(slotKey==='segmentation-handoff')return 'Head-and-body';if(slotKey==='rig-studio-handoff')return 'Rig-source';if(slotKey.startsWith('texture-handoff-'))return safeStorageName(slotKey.slice(16));return safeStorageName(slotKey);}

/** Recreate an ordinary file folder from immutable managed sources; never overwrite a user's folder. */
export async function deliverGuidedArtifact(store:AtelierStore,characterId:string,artifactId:string,slotKey:string):Promise<GuidedDelivery>{
 const artifact=store.get('artifact',artifactId);if(!artifact)throw new Error('Delivery source was not found.');
 const existing=readGuidedDelivery(store,characterId,artifactId);
 if(existing){let valid=true;for(const item of existing.files)if(await hashFile(path.join(existing.directory,...item.name.split('/')))!==item.hash){valid=false;break;}if(valid)return existing;}
 const hash=String(artifact.data.hash||''),object=store.object(hash);if(!object||await hashFile(object)!==hash)throw new Error('Managed delivery source bytes failed verification.');
 const inputs:Array<{name:string;hash:string}>=[];
 if(isGuidedHandoff(slotKey)){
  const manifest=await handoffManifest(store,artifactId);if(manifest.schemaVersion!==1||manifest.characterId!==characterId||manifest.slotKey!==slotKey||!Array.isArray(manifest.inputs)||!manifest.inputs.length||manifest.inputs.length>128)throw new Error('Handoff provenance does not match this character and stage.');
  for(const input of manifest.inputs){const source=store.get('artifact',input.artifactId);if(!source||source.data.hash!==input.sha256)throw new Error('Handoff source does not match its captured version.');inputs.push({name:safeRelative(String(input.name).replace(/^\d{2}-/,'')),hash:input.sha256});}
 }else{
  inputs.push({name:safeRelative(String(artifact.data.logicalPath||artifact.data.sourceName||artifact.name)),hash});
  for(const input of store.dependencies(artifactId))inputs.push({name:safeRelative(input.logicalPath),hash:input.hash});
 }
 if(new Set(inputs.map(f=>f.name.toLowerCase())).size!==inputs.length)throw new Error('Delivery filenames collide.');
 for(const input of inputs){const source=store.object(input.hash);if(!source||await hashFile(source)!==input.hash)throw new Error('A delivery source is missing or corrupt.');}
 const layout=workspaceLayout(store.root),parent=layout.resolve(path.relative(store.root,path.join(layout.category(owner(store,characterId),'exports'),stageName(slotKey))).replaceAll('\\','/'));
 await fs.promises.mkdir(parent,{recursive:true});
 const preferred=path.join(parent,`${folderName(slotKey)}-${artifactId.slice(0,8)}`),target=fs.existsSync(preferred)?`${preferred}-${crypto.randomUUID().slice(0,8)}`:preferred;
 const directory=layout.resolve(path.relative(store.root,target).replaceAll('\\','/'));await fs.promises.mkdir(directory);
 const files:DeliveryFile[]=[];
 try{
  for(const input of inputs){const destination=layout.resolve(path.relative(store.root,path.join(directory,...input.name.split('/'))).replaceAll('\\','/'));await fs.promises.mkdir(path.dirname(destination),{recursive:true});await fs.promises.copyFile(store.object(input.hash)!,destination,fs.constants.COPYFILE_EXCL);if(await hashFile(destination)!==input.hash)throw new Error('Exported bytes failed verification.');files.push({name:input.name,hash:input.hash,bytes:(await fs.promises.stat(destination)).size});}
  const receipt={characterId,artifactId,sourceHash:hash,slotKey,directory:path.relative(store.root,directory).replaceAll('\\','/'),files},file=receiptPath(store,characterId,artifactId);await fs.promises.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${crypto.randomUUID()}.tmp`;await fs.promises.writeFile(temp,JSON.stringify(receipt,null,2),{flag:'wx'});await fs.promises.rename(temp,file);
  return {...receipt,directory};
 }catch(error){
  // Only this newly created directory is owned by the failed operation.
  const checked=checkedDirectory(store,characterId,directory);await fs.promises.rm(checked,{recursive:true,force:true});throw error;
 }
}

export async function matchingHandoff(store:AtelierStore,artifactId:string,characterId:string,slotKey:string,items:Array<{artifactId:string;name:string}>){
 try{const manifest=await handoffManifest(store,artifactId);return manifest.characterId===characterId&&manifest.slotKey===slotKey&&manifest.inputs.length===items.length&&items.every((item,i)=>{const source=store.get('artifact',item.artifactId),row=manifest.inputs[i];return row.artifactId===item.artifactId&&row.sha256===source?.data.hash&&row.name===`${String(i+1).padStart(2,'0')}-${item.name}`;});}catch{return false;}
}

/** Reuse an unchanged group export before producing another FBX version. */
export async function matchingTextureHandoff(store:AtelierStore,archiveId:string,characterId:string,group:string,modelId:string,frontId:string,backId:string){
 try{
  const manifest=await handoffManifest(store,archiveId);
  if(manifest.characterId!==characterId||manifest.slotKey!==`texture-handoff-${group}`||!Array.isArray(manifest.inputs)||manifest.inputs.length!==3)return false;
  const [model,front,back]=manifest.inputs,managed=store.get('artifact',String(model.artifactId));
  if(model.role!=='group-model'||front.role!=='front-paint'||back.role!=='back-paint'||front.artifactId!==frontId||back.artifactId!==backId||!managed||![managed.id,managed.data.versionOf,managed.data.sourceParentId].includes(modelId))return false;
  return matchingHandoff(store,archiveId,characterId,manifest.slotKey,[{artifactId:managed.id,name:`${group}.fbx`},{artifactId:frontId,name:'front-paint-reference.png'},{artifactId:backId,name:'back-paint-reference.png'}]);
 }catch{return false;}
}
