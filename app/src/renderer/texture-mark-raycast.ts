import * as THREE from 'three';
import {acceleratedRaycast,disposeBoundsTree,MeshBVH} from 'three-mesh-bvh';

type GeometryAttribute=THREE.BufferAttribute|THREE.InterleavedBufferAttribute;
type GeometryFingerprint={position:GeometryAttribute|null;index:THREE.BufferAttribute|null;uv:GeometryAttribute|null;uv1:GeometryAttribute|null;positionVersion:number;indexVersion:number;uvVersion:number;uv1Version:number;groups:string;drawRange:string;};
type CachedTarget={mesh:THREE.Mesh;proxy:THREE.Mesh;sourceGeometry:THREE.BufferGeometry;geometry:THREE.BufferGeometry|null;sourcePosition:GeometryAttribute;sourceIndex:THREE.BufferAttribute|null;sourceUv:GeometryAttribute|null;sourceUv1:GeometryAttribute|null;positionVersion:number;indexVersion:number;uvVersion:number;uv1Version:number;groups:string;drawRange:string;sourceDisposed:boolean;onDispose:(event:{type:'dispose'})=>void;};
const groupsKey=(geometry:THREE.BufferGeometry)=>JSON.stringify(geometry.groups.map(({start,count,materialIndex})=>[start,count,materialIndex]));
const attributeVersion=(attribute:GeometryAttribute|null)=>Number((attribute as any)?.version??(attribute as any)?.data?.version??0);
const geometryFingerprint=(geometry:THREE.BufferGeometry):GeometryFingerprint=>{const position=geometry.getAttribute('position') as GeometryAttribute|undefined,index=geometry.getIndex(),uv=geometry.getAttribute('uv') as GeometryAttribute|undefined,uv1=geometry.getAttribute('uv1') as GeometryAttribute|undefined;return {position:position||null,index,uv:uv||null,uv1:uv1||null,positionVersion:attributeVersion(position||null),indexVersion:index?.version||0,uvVersion:attributeVersion(uv||null),uv1Version:attributeVersion(uv1||null),groups:groupsKey(geometry),drawRange:JSON.stringify(geometry.drawRange)};};
const supportsStaticBvh=(mesh:THREE.Mesh)=>!(mesh as THREE.SkinnedMesh).isSkinnedMesh&&!(mesh as THREE.InstancedMesh).isInstancedMesh&&!(mesh as any).isBatchedMesh&&!mesh.geometry.morphAttributes.position&&!(mesh as any).morphTargetInfluences&&mesh.raycast===THREE.Mesh.prototype.raycast&&(((mesh.geometry.getAttribute('position') as GeometryAttribute|undefined)?.count||0)>0);
const disposePrivateGeometry=(geometry:THREE.BufferGeometry)=>{disposeBoundsTree.call(geometry);geometry.dispose();};
const makePrivateGeometry=(source:THREE.BufferGeometry)=>{const clone=source.clone();try{clone.boundsTree=new MeshBVH(clone,{indirect:true,verbose:false} as any);return clone;}catch{disposePrivateGeometry(clone);return null;}};

/** Per-viewer static-mesh raycasting. Trees live on private clones; source geometry and face/UV order are untouched. */
export class TextureMarkRaycastSet {
 private targets:THREE.Object3D[]=[];
 private filteredTargets:THREE.Object3D[]=[];
 private originals=new WeakMap<THREE.Object3D,THREE.Mesh>();
 private cached=new Map<THREE.Mesh,CachedTarget>();
 constructor(meshes:THREE.Mesh[]){this.targets=meshes.map(mesh=>this.target(mesh));}
 get acceleratedMeshCount(){let count=0;for(const entry of this.cached.values())if(entry.geometry?.boundsTree&&entry.mesh.geometry===entry.sourceGeometry&&supportsStaticBvh(entry.mesh))count++;return count;}
 private target(mesh:THREE.Mesh):THREE.Object3D{
  if(!supportsStaticBvh(mesh))return mesh;
  const source=mesh.geometry,fp=geometryFingerprint(source);if(!fp.position)return mesh;
  const clone=makePrivateGeometry(source);if(!clone)return mesh;
  const proxy=Object.create(mesh) as THREE.Mesh;proxy.geometry=clone;
  const entry:CachedTarget={mesh,proxy,sourceGeometry:source,geometry:clone,sourcePosition:fp.position,sourceIndex:fp.index,sourceUv:fp.uv,sourceUv1:fp.uv1,positionVersion:fp.positionVersion,indexVersion:fp.indexVersion,uvVersion:fp.uvVersion,uv1Version:fp.uv1Version,groups:fp.groups,drawRange:fp.drawRange,sourceDisposed:false,onDispose:()=>{entry.sourceDisposed=true;if(entry.geometry){disposePrivateGeometry(entry.geometry);entry.geometry=null;}}};
  proxy.raycast=function(raycaster,intersections){
   const liveRaycast=mesh.raycast;
   if(mesh.geometry!==entry.sourceGeometry||!supportsStaticBvh(mesh)){if(entry.geometry){disposePrivateGeometry(entry.geometry);entry.geometry=null;}entry.sourceDisposed=false;proxy.geometry=mesh.geometry;liveRaycast.call(mesh,raycaster,intersections);return;}
   const current=geometryFingerprint(entry.sourceGeometry),changed=entry.sourceDisposed||!entry.geometry||current.position!==entry.sourcePosition||current.index!==entry.sourceIndex||current.uv!==entry.sourceUv||current.uv1!==entry.sourceUv1||current.positionVersion!==entry.positionVersion||current.indexVersion!==entry.indexVersion||current.uvVersion!==entry.uvVersion||current.uv1Version!==entry.uv1Version||current.groups!==entry.groups||current.drawRange!==entry.drawRange;
   if(changed){const replacement=makePrivateGeometry(entry.sourceGeometry);if(!replacement){if(entry.geometry)disposePrivateGeometry(entry.geometry);entry.geometry=null;proxy.geometry=mesh.geometry;liveRaycast.call(mesh,raycaster,intersections);return;}if(entry.geometry)disposePrivateGeometry(entry.geometry);entry.geometry=replacement;entry.sourcePosition=current.position!;entry.sourceIndex=current.index;entry.sourceUv=current.uv;entry.sourceUv1=current.uv1;entry.positionVersion=current.positionVersion;entry.indexVersion=current.indexVersion;entry.uvVersion=current.uvVersion;entry.uv1Version=current.uv1Version;entry.groups=current.groups;entry.drawRange=current.drawRange;entry.sourceDisposed=false;proxy.geometry=replacement;}
   const start=intersections.length;(acceleratedRaycast as any).call(proxy,raycaster,intersections);for(let i=start;i<intersections.length;i++)intersections[i].object=mesh;
  };
  source.addEventListener('dispose',entry.onDispose as any);proxy.userData={...mesh.userData,__atelierBvh:entry};this.originals.set(proxy,mesh);this.cached.set(mesh,entry);return proxy;
 }
 intersect(raycaster:THREE.Raycaster,include?:(mesh:THREE.Mesh)=>boolean){const targets=include?this.filteredTargets:this.targets;if(include){targets.length=0;for(const target of this.targets){const mesh=this.originals.get(target)||(target as THREE.Mesh);if(include(mesh))targets.push(target);}}return raycaster.intersectObjects(targets,false).map(hit=>{const original=this.originals.get(hit.object);if(original)hit.object=original;return hit;});}
 dispose(){for(const entry of this.cached.values()){entry.sourceGeometry.removeEventListener('dispose',entry.onDispose as any);if(entry.geometry)disposePrivateGeometry(entry.geometry);entry.geometry=null;}this.cached.clear();this.targets=[];this.filteredTargets=[];this.originals=new WeakMap();}
}
