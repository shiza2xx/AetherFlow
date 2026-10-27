import {resolveImportSource} from './import-source';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {nativeImage} from 'electron';
import type {AtelierStore} from './store';
import {isPathWithin} from './path-containment';
import {validateStagedGalleryImage} from './gallery-image-validation';
import {readThumbnail,writeThumbnail} from './thumbnail-cache';

// Only derived PNGs enter this cache. Original images are decoded by Chromium,
// in a single renderer worker, rather than by the Windows shell thumbnailer.
const recipe='chromium-fit-360x240-v1';
const pending=new Map<string,{root:string;key:string;created:number}>();
export async function imagePreview(store:AtelierStore,source:{id:string}|{path:string}) {
  let file:string,extension:string,identity:string;
  if('id' in source){
    const artifact=store.get('artifact',source.id);
    if(!artifact?.data.hash)throw new Error('Managed image was not found.');
    file=store.object(String(artifact.data.hash))||'';
    extension=path.extname(String(artifact.data.sourceName||artifact.name)).toLowerCase();
    if(!file||!isPathWithin(path.join(store.root,'objects'),file))throw new Error('Managed image source is unavailable.');
    identity=String(artifact.data.hash);
  }else{
    file=resolveImportSource(source.path).path;
    extension=path.extname(file).toLowerCase();
    const stat=await fs.promises.stat(file);
    identity=`${file}\0${stat.size}\0${stat.mtimeMs}`;
  }
  if(!['.png','.jpg','.jpeg','.webp','.gif'].includes(extension))throw new Error('Choose a PNG, JPEG, WebP, or GIF image.');
  const stat=await fs.promises.stat(file);
  if(!stat.isFile()||stat.size>128*1024*1024||fs.realpathSync.native(file)!==file)throw new Error('Image is unavailable or exceeds 128 MB.');
  const key=crypto.createHash('sha256').update(`${recipe}\0${identity}`).digest('hex');
  const cached=await readThumbnail(path.join(store.root,'thumbnails'),key);
  if(cached)return {url:`data:image/png;base64,${cached.toString('base64')}`};
  await validateStagedGalleryImage(file,extension);
  const token=crypto.randomUUID();
  for(const [id,item] of pending)if(Date.now()-item.created>120000)pending.delete(id);
  if(pending.size>=64)pending.delete(pending.keys().next().value!);
  pending.set(token,{root:store.root,key,created:Date.now()});
  const mime=extension==='.jpg'||extension==='.jpeg'?'image/jpeg':`image/${extension.slice(1)}`;
  return {sourceKey:token,mime,base64:(await fs.promises.readFile(file)).toString('base64')};
}
export async function commitImagePreview(store:AtelierStore,sourceKey:string,base64:string){
  const source=pending.get(sourceKey);pending.delete(sourceKey);
  if(!source||source.root!==store.root||Date.now()-source.created>120000)throw new Error('Image preview expired. Please retry.');
  const bytes=Buffer.from(base64,'base64');
  if(bytes.length<45||bytes.length>1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Image preview is not a bounded PNG.');
  if(bytes.readUInt32BE(16)>360||bytes.readUInt32BE(20)>240)throw new Error('Image preview dimensions are invalid.');
  const image=nativeImage.createFromBuffer(bytes),size=image.getSize();
  if(image.isEmpty()||size.width>360||size.height>240)throw new Error('Image preview dimensions are invalid.');
  await writeThumbnail(path.join(store.root,'thumbnails'),source.key,bytes);
  return {url:`data:image/png;base64,${bytes.toString('base64')}`,width:size.width,height:size.height};
}
