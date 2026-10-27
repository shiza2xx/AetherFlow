import { PNG } from 'pngjs';
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';

const pngParserPath=createRequire(import.meta.url).resolve('pngjs');

export type DepthMapTechnicalValidation = { width: number; height: number; grayscale: true; blackCorners: true; blackBorder: true; foregroundPixels: number; grayscaleEncoding: 'exact'|'near-neutral-rgb'; meanChannelSpread: number; maxChannelSpread: number };
const MAX_DEPTH_BYTES=8*1024*1024,MAX_DEPTH_PIXELS=16_777_216,MAX_DEPTH_DIMENSION=4096;

/**
 * Check the machine-verifiable part of the depth-map contract. This deliberately
 * does not claim semantic lighting, volume, silhouette, or orientation quality;
 * those still require visual review.
 */
export function validateDepthMapPng(bytes: Buffer): DepthMapTechnicalValidation {
  if (bytes.length < 45 || bytes.length > MAX_DEPTH_BYTES || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Depth maps must be complete PNG images no larger than 8 MiB.');
  }
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width > MAX_DEPTH_DIMENSION || height > MAX_DEPTH_DIMENSION || width * height > MAX_DEPTH_PIXELS) {
    throw new Error('Depth-map dimensions exceed the supported decode-work limit.');
  }
  let image: PNG;
  try {
    image = PNG.sync.read(bytes);
  } catch {
    throw new Error('Depth-map PNG decoding failed.');
  }
  if (image.width !== width || image.height !== height) throw new Error('Depth-map PNG dimensions are inconsistent.');
  const { data } = image;
  let foregroundPixels = 0, spreadSum = 0, foregroundSpreadSum = 0, maxChannelSpread = 0, outliers = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 250) throw new Error('Depth-map content must be fully opaque, including the black background border.');
    const spread=Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]);
    spreadSum+=spread;maxChannelSpread=Math.max(maxChannelSpread,spread);if(spread>4)outliers++;
    if (Math.max(data[i],data[i+1],data[i+2]) > 8) {foregroundPixels++;foregroundSpreadSum+=spread;}
  }
  if(maxChannelSpread>16||spreadSum/(width*height)>2||foregroundSpreadSum/Math.max(1,foregroundPixels)>2||outliers/(width*height)>.001){
    throw new Error('Depth maps must be grayscale: visible tint or colored regions exceed the neutral RGB tolerance (mean 2, peak 16, at most 0.1% above 4).');
  }
  const corners = [0, (width - 1) * 4, ((height - 1) * width) * 4, (height * width - 1) * 4];
  if (corners.some(i => data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8 || data[i + 3] < 250)) {
    throw new Error('Depth-map background must be opaque black at all four corners.');
  }
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) if (Math.max(...data.subarray((y * width + x) * 4,(y * width + x) * 4+3)) > 8) throw new Error('Depth-map background border must remain black.');
  for (let y = 1; y < height - 1; y++) for (const x of [0, width - 1]) if (Math.max(...data.subarray((y * width + x) * 4,(y * width + x) * 4+3)) > 8) throw new Error('Depth-map background border must remain black.');
  if (foregroundPixels === 0) throw new Error('Depth map is empty: provide an opaque grayscale foreground on a black background.');
  return { width, height, grayscale: true, blackCorners: true, blackBorder: true, foregroundPixels, grayscaleEncoding:maxChannelSpread===0?'exact':'near-neutral-rgb',meanChannelSpread:spreadSum/(width*height),maxChannelSpread };
}

const depthWorkerSource=String.raw`
const {parentPort,workerData}=require('node:worker_threads');
const {PNG}=require(workerData.pngParserPath);
const bytes=Buffer.from(workerData.buffer,workerData.byteOffset,workerData.byteLength);
const fail=message=>{throw new Error(message)};
try{
 if(bytes.length<45||bytes.length>8*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))fail('Depth maps must be complete PNG images no larger than 8 MiB.');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>4096||height>4096||width*height>16777216)fail('Depth-map dimensions exceed the supported decode-work limit.');
 let image;try{image=PNG.sync.read(bytes)}catch{fail('Depth-map PNG decoding failed.')}
 if(image.width!==width||image.height!==height)fail('Depth-map PNG dimensions are inconsistent.');
 const {data}=image;let foregroundPixels=0,spreadSum=0,foregroundSpreadSum=0,maxChannelSpread=0,outliers=0;
 for(let i=0;i<data.length;i+=4){
  if(data[i+3]<250)fail('Depth-map content must be fully opaque, including the black background border.');
  const spread=Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]);
  spreadSum+=spread;maxChannelSpread=Math.max(maxChannelSpread,spread);if(spread>4)outliers++;
  if(Math.max(data[i],data[i+1],data[i+2])>8){foregroundPixels++;foregroundSpreadSum+=spread;}
 }
 if(maxChannelSpread>16||spreadSum/(width*height)>2||foregroundSpreadSum/Math.max(1,foregroundPixels)>2||outliers/(width*height)>.001)fail('Depth maps must be grayscale: visible tint or colored regions exceed the neutral RGB tolerance (mean 2, peak 16, at most 0.1% above 4).');
 const corners=[0,(width-1)*4,((height-1)*width)*4,(height*width-1)*4];
 if(corners.some(i=>data[i]>8||data[i+1]>8||data[i+2]>8||data[i+3]<250))fail('Depth-map background must be opaque black at all four corners.');
 for(let x=0;x<width;x++)for(const y of [0,height-1])if(Math.max(...data.subarray((y*width+x)*4,(y*width+x)*4+3))>8)fail('Depth-map background border must remain black.');
 for(let y=1;y<height-1;y++)for(const x of [0,width-1])if(Math.max(...data.subarray((y*width+x)*4,(y*width+x)*4+3))>8)fail('Depth-map background border must remain black.');
 if(foregroundPixels===0)fail('Depth map is empty: provide an opaque grayscale foreground on a black background.');
 parentPort.postMessage({ok:true,result:{width,height,grayscale:true,blackCorners:true,blackBorder:true,foregroundPixels,grayscaleEncoding:maxChannelSpread===0?'exact':'near-neutral-rgb',meanChannelSpread:spreadSum/(width*height),maxChannelSpread}});
}catch(error){parentPort.postMessage({ok:false,error:error instanceof Error?error.message:'Depth-map technical validation failed.'})}
`;

/** Decode and scan depth PNGs outside Electron's main event loop with explicit time, byte, dimension and worker-heap bounds. */
export async function validateDepthMapPngAsync(bytes:Buffer,timeoutMs=30_000):Promise<DepthMapTechnicalValidation>{
  if(bytes.length<45||bytes.length>MAX_DEPTH_BYTES||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Depth maps must be complete PNG images no larger than 8 MiB.');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>MAX_DEPTH_DIMENSION||height>MAX_DEPTH_DIMENSION||width*height>MAX_DEPTH_PIXELS)throw new Error('Depth-map dimensions exceed the supported decode-work limit.');
  const data=Uint8Array.from(bytes);let worker:Worker|undefined,timer:NodeJS.Timeout|undefined;
  try{return await new Promise((resolve,reject)=>{worker=new Worker(depthWorkerSource,{eval:true,workerData:{buffer:data.buffer,byteOffset:data.byteOffset,byteLength:data.byteLength,pngParserPath},transferList:[data.buffer],resourceLimits:{maxOldGenerationSizeMb:192,maxYoungGenerationSizeMb:32,stackSizeMb:4}});timer=setTimeout(()=>reject(new Error('Depth-map validation exceeded its bounded decode time.')),timeoutMs);worker.once('message',(message:{ok:boolean;result?:DepthMapTechnicalValidation;error?:string})=>message.ok&&message.result?resolve(message.result):reject(new Error(message.error||'Depth-map technical validation failed.')));worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error('Depth-map validation worker stopped before returning a result.'));});});}
  finally{if(timer)clearTimeout(timer);if(worker)await worker.terminate().catch(()=>{});}
}
