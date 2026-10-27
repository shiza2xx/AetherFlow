import * as THREE from 'three';

type BoneEnvelope = {base: THREE.Box3; morphs: THREE.Box3[]};
type EnvelopeCache = {
  geometry: THREE.BufferGeometry;
  skeleton: THREE.Skeleton;
  bind: THREE.Matrix4;
  attributes: Array<THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined>;
  versions: number[];
  weightDeviation: number;
  envelopes: Array<BoneEnvelope | undefined>;
  unweighted: BoneEnvelope;
  transform: THREE.Matrix4;
  local: THREE.Box3;
  aggregate: THREE.Box3;
};
const caches = new WeakMap<THREE.SkinnedMesh, EnvelopeCache>();
const version = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) => a instanceof THREE.InterleavedBufferAttribute ? a.data.version : a?.version ?? -1;
const components = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number, component: number) => attribute.getComponent(index, component);
const expand = (box: THREE.Box3, x: number, y: number, z: number) => {
  box.min.x=Math.min(box.min.x,x);box.min.y=Math.min(box.min.y,y);box.min.z=Math.min(box.min.z,z);
  box.max.x=Math.max(box.max.x,x);box.max.y=Math.max(box.max.y,y);box.max.z=Math.max(box.max.z,z);
};
const envelope = (morphCount:number):BoneEnvelope => ({base:new THREE.Box3(),morphs:Array.from({length:morphCount},()=>new THREE.Box3())});

function buildCache(mesh: THREE.SkinnedMesh): EnvelopeCache {
  const geometry=mesh.geometry,position=geometry.getAttribute('position');
  const skinIndex=geometry.getAttribute('skinIndex'),skinWeight=geometry.getAttribute('skinWeight');
  const extraIndex=geometry.getAttribute('atelierJoint1'),extraWeight=geometry.getAttribute('atelierWeight1');
  const morphs=geometry.morphAttributes.position||[];
  const attributes=[position,skinIndex,skinWeight,extraIndex,extraWeight,...morphs];
  const envelopes:Array<BoneEnvelope|undefined>=new Array(mesh.skeleton.bones.length);
  const unweighted=envelope(morphs.length);
  const inverseBind=mesh.skeleton.boneInverses.map(matrix=>new THREE.Matrix4().multiplyMatrices(matrix,mesh.bindMatrix));
  const joints=new Int32Array(8);
  let weightDeviation=0;
  const record=(slot:BoneEnvelope,vertex:number,matrix?:THREE.Matrix4)=>{
    const x=position.getX(vertex),y=position.getY(vertex),z=position.getZ(vertex),e=matrix?.elements;
    if(e)expand(slot.base,e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);
    else expand(slot.base,x,y,z);
    for(let m=0;m<morphs.length;m++){
      const morph=morphs[m],dx=morph.getX(vertex)-(geometry.morphTargetsRelative?0:x),dy=morph.getY(vertex)-(geometry.morphTargetsRelative?0:y),dz=morph.getZ(vertex)-(geometry.morphTargetsRelative?0:z);
      if(e)expand(slot.morphs[m],e[0]*dx+e[4]*dy+e[8]*dz,e[1]*dx+e[5]*dy+e[9]*dz,e[2]*dx+e[6]*dy+e[10]*dz);
      else expand(slot.morphs[m],dx,dy,dz);
    }
  };
  for(let vertex=0;vertex<position.count;vertex++){
    let count=0,sum=0;
    for(let set=0;set<2;set++){
      const ids=set?extraIndex:skinIndex,weights=set?extraWeight:skinWeight;
      if(!ids||!weights)continue;
      for(let c=0;c<4;c++){
        const weight=components(weights,vertex,c);if(weight===0)continue;
        const joint=components(ids,vertex,c);
        if(!Number.isFinite(weight)||weight<0||!Number.isInteger(joint)||joint<0||joint>=envelopes.length)throw new Error('Invalid skeletal influence data.');
        sum+=weight;
        let seen=false;for(let i=0;i<count;i++)if(joints[i]===joint)seen=true;
        if(!seen)joints[count++]=joint;
      }
    }
    // The supported loaders normalize positive weights. This invariant makes the
    // deformed vertex a convex combination of its individual bone positions.
    if(count&&Math.abs(sum-1)>1e-4)throw new Error('Skin weights must be normalized before constructing animation bounds.');
    if(count)weightDeviation=Math.max(weightDeviation,Math.abs(sum-1));
    if(!count){record(unweighted,vertex);expand(unweighted.base,0,0,0);continue;}
    for(let i=0;i<count;i++){
      const joint=joints[i],slot=envelopes[joint]||(envelopes[joint]=envelope(morphs.length));
      record(slot,vertex,inverseBind[joint]);
    }
  }
  return {geometry,skeleton:mesh.skeleton,bind:mesh.bindMatrix.clone(),attributes,versions:attributes.map(version),weightDeviation,envelopes,unweighted,transform:new THREE.Matrix4(),local:new THREE.Box3(),aggregate:new THREE.Box3()};
}

function localMorphBounds(slot:BoneEnvelope,weights:number[]|undefined,target:THREE.Box3){
  target.copy(slot.base);
  if(target.isEmpty())return target;
  for(let i=0;i<slot.morphs.length;i++){
    const weight=weights?.[i]||0,delta=slot.morphs[i];if(!weight||delta.isEmpty())continue;
    const lo=weight>0?delta.min:delta.max,hi=weight>0?delta.max:delta.min;
    target.min.addScaledVector(lo,weight);target.max.addScaledVector(hi,weight);
  }
  return target;
}

/** O(bones × morphs), with no per-frame vertex scan. Exact geometry is unchanged.
 * Every positive influence is included. Per-bone boxes enclose each possible
 * bone-transformed vertex, so their union encloses the weighted combination.
 * Morph envelopes support arbitrary positive/negative current morph weights.
 * Call after world matrices are current; exact ray/triangle tests remain Three's.
 */
export function updateSkinnedBounds(mesh:THREE.SkinnedMesh){
  const geometry=mesh.geometry,morphs=geometry.morphAttributes.position||[];
  const attributes=[geometry.getAttribute('position'),geometry.getAttribute('skinIndex'),geometry.getAttribute('skinWeight'),geometry.getAttribute('atelierJoint1'),geometry.getAttribute('atelierWeight1'),...morphs];
  let cache=caches.get(mesh);
  if(!cache||cache.geometry!==geometry||cache.skeleton!==mesh.skeleton||!cache.bind.equals(mesh.bindMatrix)||cache.attributes.length!==attributes.length||attributes.some((a,i)=>a!==cache!.attributes[i]||version(a)!==cache!.versions[i])){
    cache=buildCache(mesh);caches.set(mesh,cache);
  }
  const bounds=cache.aggregate.makeEmpty();
  for(let joint=0;joint<cache.envelopes.length;joint++){
    const slot=cache.envelopes[joint];if(!slot)continue;
    localMorphBounds(slot,mesh.morphTargetInfluences,cache.local);
    cache.transform.multiplyMatrices(mesh.bindMatrixInverse,mesh.skeleton.bones[joint].matrixWorld);
    bounds.union(cache.local.applyMatrix4(cache.transform));
  }
  bounds.union(localMorphBounds(cache.unweighted,mesh.morphTargetInfluences,cache.local));
  // Float32 compact weights can sum a few ulps above one; conservatively pad
  // the envelope rather than clipping a vertex on a numerical boundary.
  const magnitude=Math.max(1,Math.abs(bounds.min.x),Math.abs(bounds.min.y),Math.abs(bounds.min.z),Math.abs(bounds.max.x),Math.abs(bounds.max.y),Math.abs(bounds.max.z));
  const translation=mesh.bindMatrixInverse.elements;
  const bindingTranslation=Math.max(Math.abs(translation[12]),Math.abs(translation[13]),Math.abs(translation[14]));
  if(!bounds.isEmpty())bounds.expandByScalar(magnitude*1e-5+(magnitude+bindingTranslation)*cache.weightDeviation);
  (mesh.boundingBox ||= new THREE.Box3()).copy(bounds);
  bounds.getBoundingSphere(mesh.boundingSphere ||= new THREE.Sphere());
}

export function refreshPoseBounds(root:THREE.Object3D){
  root.updateWorldMatrix(true,true);
  const skeletons=new Set<THREE.Skeleton>();
  root.traverse((object)=>{
    if(!(object as THREE.SkinnedMesh).isSkinnedMesh)return;
    const mesh=object as THREE.SkinnedMesh;
    mesh.updateMatrixWorld(true);
    if(!skeletons.has(mesh.skeleton)){mesh.skeleton.update();skeletons.add(mesh.skeleton);}
    updateSkinnedBounds(mesh);
  });
}

/** Allocation-free CPU skinning for bounds/picking/probes of compact 8-weight
 * meshes. It uses all positive weights and the same affine bone transforms as
 * the shader; it never edits source buffers, rest matrices or animation keys.
 */
export function applyCompactSkinning(mesh:THREE.SkinnedMesh,index:number,target:THREE.Vector3){
  const geometry=mesh.geometry,ids0=geometry.getAttribute('skinIndex'),weights0=geometry.getAttribute('skinWeight'),ids1=geometry.getAttribute('atelierJoint1'),weights1=geometry.getAttribute('atelierWeight1');
  const e=mesh.bindMatrix.elements,x=target.x,y=target.y,z=target.z;
  const px=e[0]*x+e[4]*y+e[8]*z+e[12],py=e[1]*x+e[5]*y+e[9]*z+e[13],pz=e[2]*x+e[6]*y+e[10]*z+e[14];
  const matrices=mesh.skeleton.boneMatrices;let ox=0,oy=0,oz=0,sum=0;
  if(!matrices)throw new Error('The skeleton has already been disposed.');
  for(let set=0;set<2;set++){
    const ids=set?ids1:ids0,weights=set?weights1:weights0;if(!ids||!weights)continue;
    for(let c=0;c<4;c++){
      const weight=components(weights,index,c);if(weight<=0)continue;
      const at=components(ids,index,c)*16;
      ox+=(matrices[at]*px+matrices[at+4]*py+matrices[at+8]*pz+matrices[at+12])*weight;
      oy+=(matrices[at+1]*px+matrices[at+5]*py+matrices[at+9]*pz+matrices[at+13])*weight;
      oz+=(matrices[at+2]*px+matrices[at+6]*py+matrices[at+10]*pz+matrices[at+14])*weight;
      sum+=weight;
    }
  }
  return sum?target.set(ox,oy,oz).applyMatrix4(mesh.bindMatrixInverse):target;
}
