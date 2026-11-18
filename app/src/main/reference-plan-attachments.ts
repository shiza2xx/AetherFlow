import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {ReferencePlanOwnerKind} from '../shared/reference-plan';

export type ReferenceCrop={x:number;y:number;width:number;height:number};
export type ReferenceImageFile={path:string;hash:string;mime:string;name:string};
export type ReferenceImageCropper=(file:string,crop:ReferenceCrop)=>Buffer;
export type MaterializedReferenceImages={paths:string[];cleanup:()=>void};

const extensions:Record<string,string>={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
const digest=(bytes:Buffer)=>crypto.createHash('sha256').update(bytes).digest('hex');
const safeUuid=(value:string)=>/^[0-9a-f-]{36}$/i.test(value);

function ensureDirectory(root:string,parts:string[]){
 let current=root;
 for(const part of parts){
  current=path.join(current,part);
  if(!fs.existsSync(current))fs.mkdirSync(current);
  const stat=fs.lstatSync(current);
  if(!stat.isDirectory()||stat.isSymbolicLink()||fs.realpathSync.native(current)!==current)throw new Error('The owner-scoped reference image directory is unsafe.');
 }
 return current;
}

/** Copy verified CAS images into ordinary typed files in the exact owner's workspace for Codex localImage. */
export function materializeReferenceImages(input:{workspace:string;ownerKind:ReferencePlanOwnerKind;ownerId:string;runId:string;sources:ReferenceImageFile[];crop?:ReferenceCrop|null;cropImage?:ReferenceImageCropper}):MaterializedReferenceImages{
 if(!safeUuid(input.ownerId)||!safeUuid(input.runId)||!input.sources.length)throw new Error('Reference image attachment identity is invalid.');
 const root=fs.realpathSync.native(input.workspace),ownerFolder=input.ownerKind==='assetJob'?'assets':'characters';
 const base=ensureDirectory(root,['work',ownerFolder,input.ownerId,'reference-plan-inputs']);
 const directory=path.join(base,input.runId);fs.mkdirSync(directory);
 if(fs.realpathSync.native(directory)!==directory)throw new Error('The reference image attachment folder is not a regular owner-scoped directory.');
 const paths:string[]=[];
 try{
  input.sources.forEach((source,index)=>{
   const sourcePath=path.resolve(source.path),stat=fs.lstatSync(sourcePath);
   if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(sourcePath)!==sourcePath)throw new Error(`Reference source is not a regular managed file: ${source.name}`);
   const ext=extensions[source.mime];if(!ext)throw new Error(`Unsupported reference image format: ${source.mime}`);
   const fullPath=path.join(directory,`source-${String(index+1).padStart(2,'0')}${ext}`);
   fs.copyFileSync(sourcePath,fullPath,fs.constants.COPYFILE_EXCL);
   paths.push(fullPath);
   const copied=fs.readFileSync(fullPath);if(digest(copied)!==source.hash)throw new Error(`Reference source changed while its image attachment was being prepared: ${source.name}`);
   if(index===0&&input.crop){
    const {x,y,width,height}=input.crop;
    if(![x,y,width,height].every(Number.isInteger)||x<0||y<0||width<1||height<1)throw new Error('The selected reference crop is invalid.');
    if(!input.cropImage)throw new Error('The selected crop could not be decoded for Astra.');
    const cropped=input.cropImage(sourcePath,input.crop);if(!Buffer.isBuffer(cropped)||!cropped.length)throw new Error('The selected reference crop is empty.');
    const croppedPath=path.join(directory,`source-${String(index+1).padStart(2,'0')}-crop.png`);fs.writeFileSync(croppedPath,cropped,{flag:'wx',mode:0o600});paths.push(croppedPath);
   }
  });
  return {paths,cleanup:()=>{
   try{
    if(fs.lstatSync(directory).isSymbolicLink()||fs.realpathSync.native(directory)!==directory)return;
    const expected=new Set(paths.map(file=>path.basename(file)));
    if(fs.readdirSync(directory).some(name=>!expected.has(name)))return;
    for(const file of paths){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||fs.realpathSync.native(file)!==file)return;fs.rmSync(file);}
    fs.rmdirSync(directory);
   }catch{/* Cleanup is best effort and stays within the exact run directory. */}
  }};
 }catch(error){
  try{const dirStat=fs.lstatSync(directory);if(dirStat.isDirectory()&&!dirStat.isSymbolicLink()&&fs.realpathSync.native(directory)===directory){for(const file of paths){try{const stat=fs.lstatSync(file);if(stat.isFile()&&!stat.isSymbolicLink()&&fs.realpathSync.native(file)===file)fs.rmSync(file);}catch{}}try{fs.rmdirSync(directory);}catch{}}}catch{}
  throw error;
 }
}
