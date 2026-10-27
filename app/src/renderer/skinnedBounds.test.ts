import {describe,it,expect,vi} from 'vitest';
import * as THREE from 'three';
import {applyCompactSkinning,refreshPoseBounds} from './skinnedBounds';

function fixture(morphRelative=true){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([1,0,0,0,1,0,-1,-1,1],3));
  geometry.setIndex([0,1,2]);
  geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute([0,1,2,3,0,1,2,3,0,1,2,3],4));
  geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute([.125,.125,.125,.125,.125,.125,.125,.125,.125,.125,.125,.125],4));
  geometry.setAttribute('atelierJoint1',new THREE.Uint16BufferAttribute([4,5,6,7,4,5,6,7,4,5,6,7],4));
  geometry.setAttribute('atelierWeight1',new THREE.Float32BufferAttribute([.125,.125,.125,.125,.125,.125,.125,.125,.125,.125,.125,.125],4));
  geometry.morphTargetsRelative=morphRelative;
  geometry.morphAttributes.position=[new THREE.Float32BufferAttribute(morphRelative?[2,-1,3,1,0,-2,-3,4,1]:[3,-1,3,1,1,-2,-4,3,2],3)];
  const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshBasicMaterial());
  const bones=Array.from({length:8},()=>new THREE.Bone());
  for(const bone of bones)mesh.add(bone);
  mesh.position.set(2,-3,1);mesh.scale.set(1.2,.8,1.4);mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.applyBoneTransform=((index:number,target:THREE.Vector3)=>applyCompactSkinning(mesh,index,target)) as THREE.SkinnedMesh['applyBoneTransform'];
  return {mesh,bones,geometry};
}

describe('conservative animated bounds without per-frame vertex scans',()=>{
  it.each([true,false])('encloses all eight-influence morphed vertices across rotations/scales and negative morph weights (relative=%s)',relative=>{
    const {mesh,bones}=fixture(relative),point=new THREE.Vector3();
    for(const weight of [-1.4,0,.4,2])for(let pose=0;pose<8;pose++){
      mesh.morphTargetInfluences![0]=weight;
      bones.forEach((bone,i)=>{bone.position.set(Math.sin(pose+i)*i*.2,Math.cos(pose-i)*.5,i*.1);bone.rotation.set(pose*.1,i*.07,-pose*.11);bone.scale.set(1+i*.08,1+pose*.04,.8+i*.06);});
      refreshPoseBounds(mesh);
      for(let vertex=0;vertex<3;vertex++){
        mesh.getVertexPosition(vertex,point);
        expect(mesh.boundingBox!.containsPoint(point)).toBe(true);
        expect(mesh.boundingSphere!.containsPoint(point)).toBe(true);
      }
    }
  });

  it('uses no getVertexPosition calls or full-vertex bound recomputations during repeated pose updates',()=>{
    const {mesh,bones}=fixture();
    refreshPoseBounds(mesh);
    const vertex=vi.spyOn(mesh,'getVertexPosition'),box=vi.spyOn(mesh,'computeBoundingBox'),sphere=vi.spyOn(mesh,'computeBoundingSphere');
    for(let frame=0;frame<60;frame++){bones[7].position.x=frame*.1;refreshPoseBounds(mesh);}
    expect(vertex).not.toHaveBeenCalled();expect(box).not.toHaveBeenCalled();expect(sphere).not.toHaveBeenCalled();
    expect(mesh.boundingBox!.max.x).toBeGreaterThan(5);
  });

  it('matches an independent sum of all eight bone transforms, including a tiny positive weight',()=>{
    const {mesh,bones,geometry}=fixture();
    const a=geometry.getAttribute('skinWeight'),b=geometry.getAttribute('atelierWeight1');
    a.setXYZW(0,.4999999,.5,0,0);b.setXYZW(0,0,0,0,1e-7);
    a.needsUpdate=true;b.needsUpdate=true;
    bones[0].position.x=1;bones[1].position.y=2;bones[7].position.x=1000;
    refreshPoseBounds(mesh);
    const input=new THREE.Vector3(1,0,0),actual=applyCompactSkinning(mesh,0,input.clone());
    const expected=new THREE.Vector3(),bound=input.clone().applyMatrix4(mesh.bindMatrix);
    for(let joint=0;joint<8;joint++){
      const weight=joint<4?a.getComponent(0,joint):b.getComponent(0,joint-4);
      if(weight>0)expected.addScaledVector(bound.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(bones[joint].matrixWorld,mesh.skeleton.boneInverses[joint])),weight);
    }
    expected.applyMatrix4(mesh.bindMatrixInverse);
    expect(actual.distanceTo(expected)).toBeLessThan(1e-5);
    expect(actual.x).toBeGreaterThan(1.5);
    expect(mesh.boundingBox!.containsPoint(actual)).toBe(true);
  });

  it('keeps independent instances and invalidates envelopes when source attribute versions change',()=>{
    const first=fixture(),second=fixture();
    refreshPoseBounds(first.mesh);refreshPoseBounds(second.mesh);
    const before=second.mesh.boundingBox!.clone();
    first.bones[7].position.x=100;refreshPoseBounds(first.mesh);
    expect(second.mesh.boundingBox!.equals(before)).toBe(true);
    const position=first.geometry.getAttribute('position');position.setXYZ(0,10000,0,0);position.needsUpdate=true;
    refreshPoseBounds(first.mesh);
    expect(first.mesh.boundingBox!.max.x).toBeGreaterThan(9900);
  });
});
