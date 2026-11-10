import fs from 'node:fs';
const MAX_BYTES=128*1024*1024,MAX_SCAN=4*1024*1024,MAX_PIXELS=16000000;
function dimensions(width:number,height:number){if(!width||!height||width>8192||height>8192||width*height>MAX_PIXELS)throw new Error('Image dimensions exceed the decode limit.');return {width,height};}
/** Read only bounded container headers before any native decoder allocates pixel buffers. */
export function probeAssetImage(file:string,extension:string){const size=fs.statSync(file).size;if(size<12||size>MAX_BYTES)throw new Error('Image is truncated or exceeds the compressed size limit.');const fd=fs.openSync(file,'r');try{
 const read=(offset:number,length:number)=>{if(offset<0||length<0||offset+length>size)throw new Error('Image container is truncated.');const data=Buffer.alloc(length);if(fs.readSync(fd,data,0,length,offset)!==length)throw new Error('Image container is truncated.');return data;};
 if(extension==='.jpg'||extension==='.jpeg'){
  const signature=read(0,2),end=read(size-2,2);if(signature[0]!==255||signature[1]!==216||end[0]!==255||end[1]!==217)throw new Error('JPEG markers are missing or truncated.');let pos=2,frame:{width:number;height:number}|undefined,components=0,segments=0;
  while(pos<size-2&&pos<MAX_SCAN&&++segments<=4096){if(read(pos++,1)[0]!==255)throw new Error('JPEG marker stream is invalid.');let marker=read(pos++,1)[0];while(marker===255){if(pos>=size)throw new Error('JPEG marker is truncated.');marker=read(pos++,1)[0];}if(marker===216||marker===1||marker>=208&&marker<=215)continue;if(marker===217)break;const length=read(pos,2).readUInt16BE(0);if(length<2||pos+length>size)throw new Error('JPEG segment is truncated.');
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<11)throw new Error('JPEG frame is truncated.');const info=read(pos+2,6);components=info[5];if(!components||length!==8+3*components)throw new Error('JPEG frame is invalid.');const current=dimensions(info.readUInt16BE(3),info.readUInt16BE(1));if(frame&&(frame.width!==current.width||frame.height!==current.height))throw new Error('JPEG frame dimensions conflict.');frame=current;}
   if(marker===218){if(!frame||length<6||pos+length>=size-2)throw new Error('JPEG scan is invalid or incomplete.');const count=read(pos+2,1)[0];if(!count||count>components||length<6+2*count)throw new Error('JPEG scan components are invalid.');return frame;}pos+=length;
  }throw new Error('JPEG frame or scan is missing within the header limit.');
 }
 if(extension==='.webp'){
  const header=read(0,12);if(header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,12)!=='WEBP'||header.readUInt32LE(4)+8!==size)throw new Error('WebP container length is invalid.');let pos=12,canvas:{width:number;height:number}|undefined,frame:{width:number;height:number}|undefined,chunks=0;
  while(pos<size&&++chunks<=4096){const chunk=read(pos,8),type=chunk.toString('ascii',0,4),length=chunk.readUInt32LE(4),start=pos+8,end=start+length;if(end>size||end+(length&1)>size)throw new Error('WebP chunk is truncated.');if(type==='ANIM'||type==='ANMF')throw new Error('Animated WebP is not supported for asset references.');
   if(type==='VP8X'){if(canvas||length<10)throw new Error('WebP extended header is invalid.');const info=read(start,10);if(info[0]&2)throw new Error('Animated WebP is not supported for asset references.');canvas=dimensions(1+info.readUIntLE(4,3),1+info.readUIntLE(7,3));}
   if(type==='VP8 '){if(frame||length<10)throw new Error('WebP frame is invalid.');const info=read(start,10);if(info[3]!==0x9d||info[4]!==1||info[5]!==0x2a)throw new Error('WebP frame signature is invalid.');frame=dimensions(info.readUInt16LE(6)&0x3fff,info.readUInt16LE(8)&0x3fff);}
   if(type==='VP8L'){if(frame||length<5)throw new Error('WebP frame is invalid.');const info=read(start,5);if(info[0]!==0x2f)throw new Error('WebP frame signature is invalid.');frame=dimensions(1+(((info[2]&0x3f)<<8)|info[1]),1+(((info[4]&0x0f)<<10)|(info[3]<<2)|((info[2]&0xc0)>>6)));}
   pos=end+(length&1);
  }if(pos!==size||!frame)throw new Error('WebP frame is missing or truncated.');if(canvas&&(canvas.width!==frame.width||canvas.height!==frame.height))throw new Error('WebP canvas and frame dimensions conflict.');return frame;
 }
 throw new Error('Unsupported image format for header probe.');
 }finally{fs.closeSync(fd);}}
