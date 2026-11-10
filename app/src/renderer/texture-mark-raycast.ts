import * as THREE from 'three';
import {acceleratedRaycast,disposeBoundsTree,type MeshBVH} from 'three-mesh-bvh';
import {GenerateMeshBVHWorker,type GenerateMeshBVHWorkerOptions} from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js';

type GeometryAttribute=THREE.BufferAttribute|THREE.InterleavedBufferAttribute;
type GeometryFingerprint={position:GeometryAttribute|null;index:THREE.BufferAttribute|null;uv:GeometryAttribute|null;uv1:GeometryAttribute|null;positionVersion:number;indexVersion:number;uvVersion:number;uv1Version:number;groups:string;drawRange:string;};
type CachedTarget={mesh:THREE.Mesh;proxy:THREE.Mesh;sourceGeometry:THREE.BufferGeometry;geometry:THREE.BufferGeometry|null;sourcePosition:GeometryAttribute;sourceIndex:THREE.BufferAttribute|null;sourceUv:GeometryAttribute|null;sourceUv1:GeometryAttribute|null;positionVersion:number;indexVersion:number;uvVersion:number;uv1Version:number;groups:string;drawRange:string;sourceDisposed:boolean;onDispose:(event:{type:'dispose'})=>void;};
const groupsKey=(geometry:THREE.BufferGeometry)=>JSON.stringify(geometry.groups.map(({start,count,materialIndex})=>[start,count,materialIndex]));
const attributeVersion=(attribute:GeometryAttribute|null)=>Number((attribute as any)?.version??(attribute as any)?.data?.version??0);
const geometryFingerprint=(geometry:THREE.BufferGeometry):GeometryFingerprint=>{const position=geometry.getAttribute('position') as GeometryAttribute|undefined,index=geometry.getIndex(),uv=geometry.getAttribute('uv') as GeometryAttribute|undefined,uv1=geometry.getAttribute('uv1') as GeometryAttribute|undefined;return {position:position||null,index,uv:uv||null,uv1:uv1||null,positionVersion:attributeVersion(position||null),indexVersion:index?.version||0,uvVersion:attributeVersion(uv||null),uv1Version:attributeVersion(uv1||null),groups:groupsKey(geometry),drawRange:JSON.stringify(geometry.drawRange)};};
const supportsStaticBvh=(mesh:THREE.Mesh)=>!(mesh as THREE.SkinnedMesh).isSkinnedMesh&&!(mesh as THREE.InstancedMesh).isInstancedMesh&&!(mesh as any).isBatchedMesh&&!mesh.geometry.morphAttributes.position&&!(mesh as any).morphTargetInfluences&&mesh.raycast===THREE.Mesh.prototype.raycast&&(((mesh.geometry.getAttribute('position') as GeometryAttribute|undefined)?.count||0)>0);
const disposePrivateGeometry=(geometry:THREE.BufferGeometry)=>{disposeBoundsTree.call(geometry);geometry.dispose();};
const makePrivateGeometry=(source:THREE.BufferGeometry)=>source.clone();
type BuildPrivateTree=(geometry:THREE.BufferGeometry)=>Promise<void>;
type RaycastWorker=GenerateMeshBVHWorker;
type RaycastWorkerFactory=()=>RaycastWorker;
const pendingWorkerCancels=new WeakMap<RaycastWorker,()=>void>();

function stopWorker(worker:RaycastWorker){
 const raw=worker.worker;if(!raw)return;
 pendingWorkerCancels.get(worker)?.();pendingWorkerCancels.delete(worker);
 raw.onmessage=null;raw.onerror=null;
 try{worker.dispose();}catch{try{raw.terminate();}catch{/* A partially disposed browser worker is already unusable. */}}
}

/** Call runTask directly: WorkerBase.generate adds an ignored rejecting finally promise. */
function buildPrivateTreeWithWorker(worker:RaycastWorker,geometry:THREE.BufferGeometry,options:GenerateMeshBVHWorkerOptions):Promise<MeshBVH>{
 const raw=worker.worker;if(!raw)return Promise.reject(new Error('GenerateMeshBVHWorker: Worker has been disposed.'));
 let task:Promise<MeshBVH>;
 try{task=worker.runTask(raw,geometry,options);}catch(error){return Promise.reject(error);}
 return new Promise<MeshBVH>((resolve,reject)=>{
  let settled=false;
  const finish=(error?:unknown,value?:MeshBVH)=>{if(settled)return;settled=true;pendingWorkerCancels.delete(worker);if(error){reject(error);return;}if(!value){reject(new Error('GenerateMeshBVHWorker returned an empty tree.'));return;}resolve(value);};
  const cancel=()=>{if(settled)return;const error=new Error('Texture markup BVH build cancelled.'),onerror=raw.onerror;if(typeof onerror==='function')try{onerror.call(raw,{message:error.message} as ErrorEvent);}catch{/* Settle the owned task even if WorkerBase's constructor handler is still installed. */}finish(error);};
  pendingWorkerCancels.set(worker,cancel);
  void task.then(value=>finish(undefined,value),error=>finish(error));
 });
}

/** Per-viewer static-mesh raycasting. Trees live on private clones; source geometry and face/UV order are untouched. */
export class TextureMarkRaycastSet {
 private targets:THREE.Object3D[]=[];
 private filteredTargets:THREE.Object3D[]=[];
 private originals=new WeakMap<THREE.Object3D,THREE.Mesh>();
 private cached=new Map<THREE.Mesh,CachedTarget>();
 private worker:GenerateMeshBVHWorker|null=null;
 private disposed=false;
 private preparation:Promise<void>|null=null;
 constructor(meshes:THREE.Mesh[],private buildPrivateTree?:BuildPrivateTree,private createWorker:RaycastWorkerFactory=()=>new GenerateMeshBVHWorker()){this.targets=meshes;}
 get isPrepared(){return this.cached.size>0;}
 async prepare(){
  if(this.disposed)throw new Error('Texture markup raycaster was disposed before preparation.');
  if(this.preparation)return this.preparation;
  this.preparation=(async()=>{
   let worker:RaycastWorker|null=null;try{for(const item of this.targets){if(this.disposed)break;const mesh=item as THREE.Mesh;if(!mesh.isMesh||this.cached.has(mesh)||!supportsStaticBvh(mesh))continue;const source=mesh.geometry,fp=geometryFingerprint(source);if(!fp.position)continue;const clone=makePrivateGeometry(source);try{if(this.buildPrivateTree)await this.buildPrivateTree(clone);else{worker||=this.createWorker();this.worker=worker;clone.boundsTree=await buildPrivateTreeWithWorker(worker,clone,{indirect:true,verbose:false});}}catch{disposePrivateGeometry(clone);if(worker&&!this.disposed){const failed=worker;worker=null;if(this.worker===failed)this.worker=null;stopWorker(failed);}continue;}if(this.disposed){disposePrivateGeometry(clone);break;}this.attach(mesh,source,clone,fp);}}
   finally{if(worker)stopWorker(worker);if(this.worker===worker)this.worker=null;}
  })();
  try{await this.preparation;}finally{this.preparation=null;}
 }
 get acceleratedMeshCount(){let count=0;for(const entry of this.cached.values())if(entry.geometry?.boundsTree&&entry.mesh.geometry===entry.sourceGeometry&&supportsStaticBvh(entry.mesh))count++;return count;}
 private attach(mesh:THREE.Mesh,source:THREE.BufferGeometry,clone:THREE.BufferGeometry,fp:GeometryFingerprint){
  const proxy=Object.create(mesh) as THREE.Mesh;proxy.geometry=clone;
  const entry:CachedTarget={mesh,proxy,sourceGeometry:source,geometry:clone,sourcePosition:fp.position!,sourceIndex:fp.index,sourceUv:fp.uv,sourceUv1:fp.uv1,positionVersion:fp.positionVersion,indexVersion:fp.indexVersion,uvVersion:fp.uvVersion,uv1Version:fp.uv1Version,groups:fp.groups,drawRange:fp.drawRange,sourceDisposed:false,onDispose:()=>{entry.sourceDisposed=true;if(entry.geometry){disposePrivateGeometry(entry.geometry);entry.geometry=null;}}};
  proxy.raycast=function(raycaster,intersections){
   const liveRaycast=mesh.raycast;
   if(mesh.geometry!==entry.sourceGeometry||!supportsStaticBvh(mesh)){if(entry.geometry){disposePrivateGeometry(entry.geometry);entry.geometry=null;}entry.sourceDisposed=false;proxy.geometry=mesh.geometry;liveRaycast.call(mesh,raycaster,intersections);return;}
   const current=geometryFingerprint(entry.sourceGeometry),changed=entry.sourceDisposed||!entry.geometry||current.position!==entry.sourcePosition||current.index!==entry.sourceIndex||current.uv!==entry.sourceUv||current.uv1!==entry.sourceUv1||current.positionVersion!==entry.positionVersion||current.indexVersion!==entry.indexVersion||current.uvVersion!==entry.uvVersion||current.uv1Version!==entry.uv1Version||current.groups!==entry.groups||current.drawRange!==entry.drawRange;
   if(changed){if(entry.geometry)disposePrivateGeometry(entry.geometry);entry.geometry=null;entry.sourceDisposed=false;proxy.geometry=mesh.geometry;liveRaycast.call(mesh,raycaster,intersections);return;}
   const start=intersections.length;(acceleratedRaycast as any).call(proxy,raycaster,intersections);for(let i=start;i<intersections.length;i++)intersections[i].object=mesh;
  };
  source.addEventListener('dispose',entry.onDispose as any);proxy.userData={...mesh.userData,__atelierBvh:entry};this.originals.set(proxy,mesh);this.cached.set(mesh,entry);this.targets[this.targets.indexOf(mesh)]=proxy;
 }
 intersect(raycaster:THREE.Raycaster,include?:(mesh:THREE.Mesh)=>boolean){const targets=include?this.filteredTargets:this.targets;if(include){targets.length=0;for(const target of this.targets){const mesh=this.originals.get(target)||(target as THREE.Mesh);if(include(mesh))targets.push(target);}}return raycaster.intersectObjects(targets,false).map(hit=>{const original=this.originals.get(hit.object);if(original)hit.object=original;return hit;});}
 dispose(){if(this.disposed)return;this.disposed=true;const worker=this.worker;this.worker=null;if(worker)stopWorker(worker);for(const entry of this.cached.values()){entry.sourceGeometry.removeEventListener('dispose',entry.onDispose as any);if(entry.geometry)disposePrivateGeometry(entry.geometry);entry.geometry=null;}this.cached.clear();this.targets=[];this.filteredTargets=[];this.originals=new WeakMap();}
}
