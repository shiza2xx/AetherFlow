import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createHeadFitPreview,headFitDelta} from './headFitPreview';

describe('live pre-rig head fitting',()=>{
 it('matches Blender world Z and noncommuting XYZ Euler order after glTF basis conversion',()=>{
  const delta=headFitDelta({translation:[1,2,3],rotationDegrees:[90,90,0],scale:2},new THREE.Vector3());
  const actual=new THREE.Vector3(0,1,0).applyMatrix4(delta);
  [1,3,0].forEach((v,i)=>expect(actual.toArray()[i]).toBeCloseTo(v,10));
 });
 it('moves the complete registered head group together, keeps body/geometry fixed and never accumulates draft transforms',()=>{
  const root=new THREE.Group(),names=['head','hair','upper_body','lower_body','accessories'],objects=names.map((name,i)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());o.name='Atelier_'+name;o.position.set(i,.5,0);root.add(o);return o;});
  const groups=names.map(key=>({key,source:['head','hair','accessories'].includes(key)?'head':'body'}));
  root.updateMatrixWorld(true);const body=objects[2].matrixWorld.toArray(),vertices=Array.from(objects[0].geometry.attributes.position.array);
  const engine=createHeadFitPreview(root,groups),p={translation:[0,0,.6] as [number,number,number],rotationDegrees:[0,0,0] as [number,number,number],scale:1};
  engine.apply(p);expect(objects[0].position.y).toBeCloseTo(1.1);expect(objects[1].position.y).toBeCloseTo(1.1);expect(objects[4].position.y).toBeCloseTo(1.1);expect(objects[2].matrixWorld.toArray()).toEqual(body);
  engine.apply({...p,translation:[0,0,.7]});expect(objects[0].position.y).toBeCloseTo(1.2);expect(Array.from(objects[0].geometry.attributes.position.array)).toEqual(vertices);
  expect(engine.apply({...p,scale:NaN})).toBeNull();expect(objects[0].position.y).toBeCloseTo(1.2);
  engine.restore();expect(objects[0].position.y).toBeCloseTo(.5);expect(objects[2].matrixWorld.toArray()).toEqual(body);
 });
 it('refuses missing groups rather than showing an editable but inert model',()=>{
  expect(()=>createHeadFitPreview(new THREE.Group(),[{key:'head',source:'head'},{key:'upper_body',source:'body'}])).toThrow('Atelier_head');
 });
});
