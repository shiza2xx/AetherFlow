/// <reference lib="webworker" />
const worker=self as unknown as DedicatedWorkerGlobalScope;
worker.onmessage=async(event:MessageEvent<{bytes:ArrayBuffer;mime:string}>)=>{
  let bitmap:ImageBitmap|undefined;
  try{
    bitmap=await createImageBitmap(new Blob([event.data.bytes],{type:event.data.mime}));
    const ratio=Math.min(360/bitmap.width,240/bitmap.height,1);
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*ratio)),Math.max(1,Math.round(bitmap.height*ratio)));
    const context=canvas.getContext('2d');if(!context)throw new Error('Image preview renderer is unavailable.');
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const png=await canvas.convertToBlob({type:'image/png'}),bytes=await png.arrayBuffer();
    worker.postMessage({bytes},[bytes]);
  }catch(error){worker.postMessage({error:error instanceof Error?error.message:'Image could not be decoded.'});}
  finally{bitmap?.close();}
};
export {};
