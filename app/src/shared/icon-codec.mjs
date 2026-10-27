// Windows ICO with explicit small-size frames and alpha-correct area filtering.
export const ICON_SIZES=[16,20,24,32,40,48,64,128,256];
export function resizeIcon(source,size){
 if(!Number.isInteger(size)||size<1||size>256||source.width!==source.height||source.width<size||source.data.length!==source.width*source.height*4)throw new Error('Icon input must be a square RGBA image at least as large as the output.');
 const width=source.width,step=width/size,out=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const left=x*step,right=(x+1)*step,top=y*step,bottom=(y+1)*step;let weight=0,alpha=0,red=0,green=0,blue=0;
  for(let sy=Math.floor(top);sy<Math.min(width,Math.ceil(bottom));sy++)for(let sx=Math.floor(left);sx<Math.min(width,Math.ceil(right));sx++){
   const area=(Math.min(right,sx+1)-Math.max(left,sx))*(Math.min(bottom,sy+1)-Math.max(top,sy));if(area<=0)continue;
   const offset=(sy*width+sx)*4,a=source.data[offset+3]*area;weight+=area;alpha+=a;red+=source.data[offset]*a;green+=source.data[offset+1]*a;blue+=source.data[offset+2]*a;
  }
  const offset=(y*size+x)*4;if(alpha>0){out[offset]=Math.round(red/alpha);out[offset+1]=Math.round(green/alpha);out[offset+2]=Math.round(blue/alpha);}out[offset+3]=Math.round(alpha/weight);
 }
 return out;
}
export function encodeIco(source,sizes=ICON_SIZES){
 if(!sizes.length||new Set(sizes).size!==sizes.length)throw new Error('ICO sizes must be nonempty and unique.');
 const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);let offset=header.length;const frames=[];
 sizes.forEach((size,index)=>{
  const rgba=resizeIcon(source,size),pixelBytes=size*size*4,maskStride=Math.ceil(size/32)*4,frame=Buffer.alloc(40+pixelBytes+maskStride*size);
  frame.writeUInt32LE(40,0);frame.writeInt32LE(size,4);frame.writeInt32LE(size*2,8);frame.writeUInt16LE(1,12);frame.writeUInt16LE(32,14);frame.writeUInt32LE(pixelBytes,20);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   const input=(y*size+x)*4,output=40+((size-1-y)*size+x)*4;frame[output]=rgba[input+2];frame[output+1]=rgba[input+1];frame[output+2]=rgba[input];frame[output+3]=rgba[input+3];
   if(rgba[input+3]===0)frame[40+pixelBytes+(size-1-y)*maskStride+(x>>3)]|=0x80>>(x&7);
  }
  const entry=6+index*16;header[entry]=size===256?0:size;header[entry+1]=size===256?0:size;header.writeUInt16LE(1,entry+4);header.writeUInt16LE(32,entry+6);header.writeUInt32LE(frame.length,entry+8);header.writeUInt32LE(offset,entry+12);frames.push(frame);offset+=frame.length;
 });
 return Buffer.concat([header,...frames]);
}
