import {validateDepthMapPng} from './depth-map-validation';
import {probeAssetImage} from './asset-image-probe';
import {assertPreparedWebp} from './asset-images';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {nativeImage} from 'electron';
import {PNG} from 'pngjs';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import type {AtelierStore} from './store';
import type {Entity} from '../shared/contracts';

const imageRoles=/^(?:image|material-reference|depth|guide)(?::[a-z0-9][a-z0-9-]{0,63})?$|^sheet$|^foliage:(?:front|back|side|top|atlas)$/;
const modelRoles=new Set(['geometry','material','assembly']);
function validateFbxContainer(file:string){const size=fs.statSync(file).size;if(size<64||size>512*1024*1024)throw new Error('FBX file is truncated or exceeds the model limit.');const fd=fs.openSync(file,'r');try{const header=Buffer.alloc(27);fs.readSync(fd,header,0,header.length,0);if(header.subarray(0,23).equals(Buffer.from('Kaydara FBX Binary  \x00\x1a\x00','binary'))){const version=header.readUInt32LE(23);if(version<7000||version>8000)throw new Error('FBX version is unsupported.');const wide=version>=7500,record=wide?25:13,limit=BigInt(size),names=new Set<string>();let offset=27,complete=false;while(offset+record<=size){const node=Buffer.alloc(record);if(fs.readSync(fd,node,0,record,offset)!==record)break;const end=wide?node.readBigUInt64LE(0):BigInt(node.readUInt32LE(0)),propertyLength=wide?node.readBigUInt64LE(16):BigInt(node.readUInt32LE(8)),nameLength=node[wide?24:12];if(end===0n){complete=true;break;}if(end>limit||end<BigInt(offset+record+nameLength)||propertyLength>end-BigInt(offset+record+nameLength))throw new Error('FBX node bounds are invalid.');const name=Buffer.alloc(nameLength);if(fs.readSync(fd,name,0,nameLength,offset+record)!==nameLength)throw new Error('FBX node name is truncated.');names.add(name.toString('utf8'));offset=Number(end);}if(!complete||!names.has('Objects'))throw new Error('FBX object structure is incomplete.');}else{const text=fs.readFileSync(file,'utf8');if(!/FBXHeaderExtension\s*:/i.test(text)||!/Objects\s*:/i.test(text)||!/(Geometry|Model)\s*:/i.test(text))throw new Error('ASCII FBX object structure is incomplete.');}}finally{fs.closeSync(fd);}}
export function validateAssetOutput(store:AtelierStore,artifact:Entity,role:string){
 const isImage=imageRoles.test(role);if(!isImage&&!modelRoles.has(role))throw new Error(`Unsupported asset output role: ${role}.`);
 const hash=String(artifact.data.hash||''),name=String(artifact.data.sourceName||artifact.name),extension=path.extname(name).toLowerCase(),file=store.object(hash);
 if(!file||!fs.existsSync(file)||!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||fs.realpathSync.native(file)!==path.resolve(file))throw new Error('Managed output file is missing or unsafe.');
 const digest=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buf=Buffer.allocUnsafe(1024*1024);try{let n=0;while((n=fs.readSync(fd,buf,0,buf.length,null))>0)digest.update(buf.subarray(0,n));}finally{fs.closeSync(fd);}if(digest.digest('hex')!==hash)throw new Error('Managed output hash does not match its bytes.');
 if(role==='depth'||role.startsWith('depth:')){if(extension!=='.png')throw new Error('Depth maps require an opaque PNG image.');if(fs.statSync(file).size>8*1024*1024)throw new Error('Depth maps must be complete PNG images no larger than 8 MiB.');const depthValidation=validateDepthMapPng(fs.readFileSync(file));return {hash,extension,depthValidation};}
 if(isImage){if(!['.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error(`Image role ${role} requires PNG, JPEG or WebP.`);if(fs.statSync(file).size>128*1024*1024)throw new Error('Image exceeds the decode limit.');if(extension==='.png'){const head=Buffer.alloc(24),fd=fs.openSync(file,'r');try{if(fs.readSync(fd,head,0,head.length,0)!==head.length)throw new Error('PNG header is truncated.');}finally{fs.closeSync(fd);}const width=head.readUInt32BE(16),height=head.readUInt32BE(20);if(!width||!height||width>8192||height>8192||width*height>16000000)throw new Error('Image dimensions exceed the decode limit.');const png=PNG.sync.read(fs.readFileSync(file));if(!png.width||!png.height||png.width>8192||png.height>8192||png.width*png.height>16000000)throw new Error('Image dimensions exceed the decode limit.');}else if(extension==='.webp'){assertPreparedWebp(file,hash);}else{const dimensions=probeAssetImage(file,extension);if(!nativeImage?.createFromPath)throw new Error('Electron image decoder is unavailable.');const decoded=nativeImage.createFromPath(file),size=decoded.getSize();if(decoded.isEmpty()||!size.width||!size.height||size.width>8192||size.height>8192||size.width*size.height>16000000||!((size.width===dimensions.width&&size.height===dimensions.height)||((extension==='.jpg'||extension==='.jpeg')&&size.width===dimensions.height&&size.height===dimensions.width)))throw new Error('Image cannot be decoded safely.');}}
 else{if(extension==='.gltf')throw new Error('Asset glTF files are not supported; convert the model to a self-contained GLB and retry.');if(!['.obj','.fbx','.glb','.blend'].includes(extension))throw new Error(`Model role ${role} requires OBJ, FBX, GLB or Blender.`);store.validateManaged(name,hash);if(extension==='.fbx')validateFbxContainer(file);}
 return {hash,extension};
}

let modelValidationTail:Promise<void>=Promise.resolve();
const submissionValidationProofs=new WeakMap<object,{workspace:string;keys:Set<string>}>();
function submissionValidationKey(store:AtelierStore,artifact:Entity,role:string){return JSON.stringify([path.resolve(store.root),artifact.id,String(artifact.data.hash||''),role]);}
function validateManagedModelAsync(file:string,hash:string,extension:string){
 const task=modelValidationTail.then(()=>new Promise<{hash:string;extension:string}>((resolve,reject)=>{
  const workerFile=path.join(path.dirname(fileURLToPath(import.meta.url)),'asset-model-validation-worker.mjs');
  const worker=new Worker(workerFile,{workerData:{file,hash,extension},resourceLimits:{maxOldGenerationSizeMb:1536,maxYoungGenerationSizeMb:128,stackSizeMb:4}});let settled=false;
  const finish=(error?:Error,result?:{hash:string;extension:string})=>{if(settled)return;settled=true;clearTimeout(deadline);void worker.terminate();if(error){reject(error);return;}if(!result||result.hash!==hash||result.extension!==extension){reject(new Error('Managed model validation worker returned an invalid result.'));return;}resolve(result);};
  const deadline=setTimeout(()=>finish(new Error('Managed model validation exceeded its five minute deadline.')),5*60_000);deadline.unref?.();
  worker.once('error',(error:Error)=>finish(error));worker.once('exit',(code:number)=>{if(!settled)finish(new Error(`Managed model validation worker exited before returning a result (code ${code}).`));});
  worker.once('message',(message:any)=>message?.error?finish(new Error(String(message.error))):finish(undefined,message?.result));
 }));modelValidationTail=task.then(()=>undefined,()=>undefined);return task;
}

/** Async heavy-model variant for import and return workflows; image checks keep their existing contract. */
export async function validateAssetOutputAsync(store:AtelierStore,artifact:Entity,role:string){
 const isImage=imageRoles.test(role);if(!isImage&&!modelRoles.has(role))throw new Error(`Unsupported asset output role: ${role}.`);
 const hash=String(artifact.data.hash||''),name=String(artifact.data.sourceName||artifact.name),extension=path.extname(name).toLowerCase(),file=store.object(hash);
 if(!file||!fs.existsSync(file)||!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()||fs.realpathSync.native(file)!==path.resolve(file))throw new Error('Managed output file is missing or unsafe.');
 if(!isImage){if(extension==='.gltf')throw new Error('Asset glTF files are not supported; convert the model to a self-contained GLB and retry.');if(!['.obj','.fbx','.glb','.blend'].includes(extension))throw new Error(`Model role ${role} requires OBJ, FBX, GLB or Blender.`);return validateManagedModelAsync(file,hash,extension);}
 return validateAssetOutput(store,artifact,role);
}

export async function validateAndMarkAssetOutputForSubmission(store:AtelierStore,payload:object,artifact:Entity,role:string){
 const checked=await validateAssetOutputAsync(store,artifact,role),workspace=path.resolve(store.root),current=submissionValidationProofs.get(payload),proof=current?.workspace===workspace?current:{workspace,keys:new Set<string>()};
 proof.keys.add(submissionValidationKey(store,artifact,role));submissionValidationProofs.set(payload,proof);return checked;
}

export async function validateAssetOutputsBeforeSubmission(store:AtelierStore,payload:{outputs:Array<{artifactId:string;role:string}>}){
 for(const output of payload.outputs){const artifact=store.get('artifact',output.artifactId);if(!artifact)throw new Error('Asset output artifact is missing.');await validateAndMarkAssetOutputForSubmission(store,payload,artifact,output.role);}
}

export function consumeAssetOutputValidationProofs(store:AtelierStore,payload:unknown){
 if(!payload||typeof payload!=='object')return new Set<string>();const proof=submissionValidationProofs.get(payload);submissionValidationProofs.delete(payload);
 return proof?.workspace===path.resolve(store.root)?proof.keys:new Set<string>();
}

export function transferAssetOutputValidationProofs(store:AtelierStore,from:unknown,to:object){
 if(!from||typeof from!=='object')return false;const proof=submissionValidationProofs.get(from);submissionValidationProofs.delete(from);if(!proof||proof.workspace!==path.resolve(store.root))return false;
 const existing=submissionValidationProofs.get(to),keys=existing?.workspace===proof.workspace?existing.keys:new Set<string>();for(const key of proof.keys)keys.add(key);submissionValidationProofs.set(to,{workspace:proof.workspace,keys});return true;
}

export function assetOutputValidationProofKey(store:AtelierStore,artifact:Entity,role:string){return submissionValidationKey(store,artifact,role);}
