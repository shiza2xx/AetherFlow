import {describe,expect,it} from 'vitest';
import {compactEightInfluenceSets,decodeGltfAccessor} from '../renderer/ThreeViewer';
import {withEightWeightAccessors} from '../renderer/ThreeViewer';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

describe('production glTF skin accessor decoding',()=>{
 it('accepts accessor index zero and decodes its actual typed bytes',()=>{
  const bytes=new Uint8Array([1,0,2,0]);
  const decoded=decodeGltfAccessor({accessors:[{bufferView:0,componentType:5123,count:1,type:'VEC2'}],bufferViews:[{buffer:0}]},[bytes.buffer],0);
  expect([...decoded]).toEqual([1,2]);
 });
 it('applies sparse normalized Uint8 replacements over zero-initialized attributes',()=>{
  const bytes=new Uint8Array([1,255,128]);
  const decoded=decodeGltfAccessor({accessors:[{componentType:5121,normalized:true,count:3,type:'VEC2',sparse:{count:1,indices:{bufferView:0,componentType:5121},values:{bufferView:1}}}],bufferViews:[{buffer:0,byteOffset:0},{buffer:0,byteOffset:1}]},[bytes.buffer],0);
  expect([...decoded]).toEqual([0,0,1,expect.closeTo(128/255,6),0,0]);
 });
 it('respects byteStride and accessor byteOffset for interleaved attributes',()=>{
  const bytes=new Uint8Array([9,10,11,12,13,14,15,16,21,22,23,24,25,26,27,28]);
  const decoded=decodeGltfAccessor({accessors:[{bufferView:0,byteOffset:2,componentType:5121,count:2,type:'VEC2'}],bufferViews:[{buffer:0,byteStride:8}]},[bytes.buffer],0);
  expect([...decoded]).toEqual([11,12,23,24]);
 });
 it('compacts positive influences spread across three sets and preserves over-eight diagnostics',()=>{
  const set=(joints:number[],weights:number[])=>({joints:Float32Array.from(joints),weights:Float32Array.from(weights)});
  const compact=compactEightInfluenceSets([set([1,2,3,4],[.1,.1,.1,0]),set([5,6,7,8],[.1,.1,.1,0]),set([9,10,11,12],[.1,.1,0,0])],1);
  expect(compact.maxUsed).toBe(8);expect(compact.hasExtra).toBe(true);expect(compact.tooMany).toBe(false);
  expect([...compact.joint0]).toEqual([1,2,3,5]);expect([...compact.joint1]).toEqual([6,7,9,10]);expect([...compact.weight0,...compact.weight1].slice(0,8).reduce((a,b)=>a+b,0)).toBeCloseTo(1);
  const excessive=compactEightInfluenceSets([set([1,2,3,4],[1,1,1,1]),set([5,6,7,8],[1,1,1,1]),set([9,10,11,12],[1,1,1,1])],1);
  expect(excessive.tooMany).toBe(true);expect(excessive.maxUsed).toBe(12);expect(excessive.rawWeights[0]).toHaveLength(12);
 });
 it('preserves a tiny positive joint in a four-influence palette spread across accessor sets',()=>{
  const set=(joints:number[],weights:number[])=>({joints:Float32Array.from(joints),weights:Float32Array.from(weights)});
  const compact=compactEightInfluenceSets([set([1,2,3,4],[0.4,0.3,0,0]),set([5,6,7,8],[0.299999988,1.1e-8,0,0])],1);
  expect(compact.maxUsed).toBe(4);expect(compact.hasExtra).toBe(false);expect(compact.tooMany).toBe(false);
  expect([...compact.joint0]).toEqual([1,2,5,6]);expect(compact.weight0[3]).toBeGreaterThan(0);expect(compact.weight0[3]).toBeCloseTo(1.1e-8,12);
 });
 it('installs all-positive compaction through the registered loader for a four-influence multi-set skin',async()=>{
  const chunks:Buffer[]=[],views:any[]=[],accessors:any[]=[];let byteLength=0;
  const add=(bytes:Buffer,type:string,componentType:number,count:number)=>{const padding=(4-byteLength%4)%4;if(padding){chunks.push(Buffer.alloc(padding));byteLength+=padding;}const offset=byteLength;chunks.push(bytes);byteLength+=bytes.length;views.push({buffer:0,byteOffset:offset,byteLength:bytes.length});accessors.push({bufferView:views.length-1,componentType,count,type});return accessors.length-1;};
  const floats=(values:number[])=>{const bytes=Buffer.alloc(values.length*4);values.forEach((value,index)=>bytes.writeFloatLE(value,index*4));return bytes;};
  const ushorts=(values:number[])=>{const bytes=Buffer.alloc(values.length*2);values.forEach((value,index)=>bytes.writeUInt16LE(value,index*2));return bytes;};
  const position=add(floats([0,0,0,1,0,0,0,1,0]),'VEC3',5126,3),normal=add(floats([0,0,1,0,0,1,0,0,1]),'VEC3',5126,3),uv=add(floats([0,0,1,0,0,1]),'VEC2',5126,3),joints0=add(ushorts([0,1,0,0,0,1,0,0,0,1,0,0]),'VEC4',5123,3),weights0=add(floats([.4,.3,0,0,.4,.3,0,0,.4,.3,0,0]),'VEC4',5126,3),joints1=add(ushorts([0,1,0,0,0,1,0,0,0,1,0,0]),'VEC4',5123,3),weights1=add(floats([.299999988,1.1e-8,0,0,.299999988,1.1e-8,0,0,.299999988,1.1e-8,0,0]),'VEC4',5126,3),indices=add(ushorts([0,1,2]),'SCALAR',5123,3);accessors[position].min=[0,0,0];accessors[position].max=[1,1,0];
  const binary=Buffer.concat(chunks),document={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0,1]}],nodes:[{name:'Body',mesh:0,skin:0},{name:'Root',children:[2]},{name:'Chest'}],meshes:[{primitives:[{attributes:{POSITION:position,NORMAL:normal,TEXCOORD_0:uv,JOINTS_0:joints0,WEIGHTS_0:weights0,JOINTS_1:joints1,WEIGHTS_1:weights1},indices}]}],skins:[{skeleton:1,joints:[1,2]}],buffers:[{uri:`data:application/octet-stream;base64,${binary.toString('base64')}`,byteLength:binary.length}],bufferViews:views,accessors};
  const priorProgressEvent=(globalThis as any).ProgressEvent;(globalThis as any).ProgressEvent=class extends Event{lengthComputable=false;loaded=0;total=0;constructor(type:string,init:any={}){super(type);this.lengthComputable=Boolean(init.lengthComputable);this.loaded=Number(init.loaded||0);this.total=Number(init.total||0);}};
  try{const loader=withEightWeightAccessors(new GLTFLoader()),loaded=await new Promise<any>((resolve,reject)=>loader.parse(document as any,'',resolve,reject));let mesh:any;loaded.scene.traverse((object:any)=>{if(object.isSkinnedMesh)mesh=object;});expect(mesh).toBeTruthy();const geometry=mesh.geometry;expect(geometry.userData.atelierInfluenceCount).toBe(4);expect(geometry.getAttribute('skinIndex').getX(0)).toBe(0);expect(geometry.getAttribute('skinIndex').getY(0)).toBe(1);expect(geometry.getAttribute('skinIndex').getZ(0)).toBe(0);expect(geometry.getAttribute('skinIndex').getW(0)).toBe(1);expect(geometry.getAttribute('skinWeight').getW(0)).toBeGreaterThan(0);expect(geometry.getAttribute('skinWeight').getW(0)).toBeCloseTo(1.1e-8,12);expect(geometry.getAttribute('atelierWeight1').getX(0)).toBe(0);}finally{if(priorProgressEvent===undefined)delete (globalThis as any).ProgressEvent;else (globalThis as any).ProgressEvent=priorProgressEvent;}
 },20000);
});

