import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'src','renderer','assets','aetherflow-dark.png'),target=path.join(root,'build','icon.ico');
const bytes=fs.readFileSync(source);if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('AetherFlow dark logo must be a valid PNG.');
const localRequire=createRequire(import.meta.url),{PNG}=localRequire('pngjs'),image=PNG.sync.read(bytes);if(image.width!==image.height||image.width<256)throw new Error('The brand icon source must be a square image of at least 256 pixels.');
const size=256,rowBytes=size*4,pixelBytes=rowBytes*size,maskRowBytes=Math.ceil(size/32)*4,maskBytes=maskRowBytes*size,dib=Buffer.alloc(40+pixelBytes+maskBytes),pixels=dib.subarray(40,40+pixelBytes);dib.writeUInt32LE(40,0);dib.writeInt32LE(size,4);dib.writeInt32LE(size*2,8);dib.writeUInt16LE(1,12);dib.writeUInt16LE(32,14);dib.writeUInt32LE(0,16);dib.writeUInt32LE(pixelBytes+maskBytes,20);
for(let y=0;y<size;y++){const sourceY=Math.floor((size-1-y)*image.height/size);for(let x=0;x<size;x++){const sourceX=Math.floor(x*image.width/size),sourceOffset=(sourceY*image.width+sourceX)*4,targetOffset=(y*size+x)*4;pixels[targetOffset]=image.data[sourceOffset+2];pixels[targetOffset+1]=image.data[sourceOffset+1];pixels[targetOffset+2]=image.data[sourceOffset];pixels[targetOffset+3]=image.data[sourceOffset+3];}}
fs.mkdirSync(path.dirname(target),{recursive:true});const header=Buffer.alloc(22);header.writeUInt16LE(0,0);header.writeUInt16LE(1,2);header.writeUInt16LE(1,4);header.writeUInt8(0,6);header.writeUInt8(0,7);header.writeUInt8(0,8);header.writeUInt8(0,9);header.writeUInt16LE(1,10);header.writeUInt16LE(32,12);header.writeUInt32LE(dib.length,14);header.writeUInt32LE(22,18);fs.writeFileSync(target,Buffer.concat([header,dib]));
