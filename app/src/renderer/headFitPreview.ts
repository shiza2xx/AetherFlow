import * as THREE from 'three';
export type HeadFitParameters={translation:[number,number,number];rotationDegrees:[number,number,number];scale:number};
export type HeadFitGroup={key:string;source:string};
export const validHeadFit=(p:HeadFitParameters)=>[...p.translation,...p.rotationDegrees,p.scale].every(Number.isFinite)&&p.translation.every(n=>Math.abs(n)<=10000)&&p.rotationDegrees.every(n=>Math.abs(n)<=360)&&p.scale>=.01&&p.scale<=100;

/** Blender XYZ Euler is Rz·Ry·Rx. glTF exports Blender Z-up as Y-up. */
export function headFitDelta(p:HeadFitParameters,pivot:THREE.Vector3){
 const [x,y,z]=p.rotationDegrees.map(THREE.MathUtils.degToRad),basis=new THREE.Matrix4().makeRotationX(-Math.PI/2),blenderPivot=pivot.clone().applyMatrix4(basis.clone().invert());
 const delta=new THREE.Matrix4().makeTranslation(...p.translation).multiply(new THREE.Matrix4().makeTranslation(blenderPivot.x,blenderPivot.y,blenderPivot.z)).multiply(new THREE.Matrix4().makeRotationZ(z)).multiply(new THREE.Matrix4().makeRotationY(y)).multiply(new THREE.Matrix4().makeRotationX(x)).multiply(new THREE.Matrix4().makeScale(p.scale,p.scale,p.scale)).multiply(new THREE.Matrix4().makeTranslation(-blenderPivot.x,-blenderPivot.y,-blenderPivot.z));
 return basis.clone().multiply(delta).multiply(basis.invert());
}

/** Only object matrices change; authored vertices/materials and fixed body stay untouched. */
export function createHeadFitPreview(root:THREE.Object3D,groups:HeadFitGroup[]){
 root.updateWorldMatrix(true,true);
 const names=groups.map(g=>`Atelier_${g.key}`),objects=names.map(name=>{const found:THREE.Object3D[]=[];root.traverse(o=>{if(o.name===name)found.push(o);});if(found.length!==1)throw new Error(`Head-fit preview needs exactly one ${name} group.`);return found[0];});
 if(!groups.some(g=>g.key==='head'&&g.source==='head')||!groups.some(g=>g.source==='body'))throw new Error('Head-fit preview needs registered head and body groups.');
 if(objects.some(o=>{let bad=false;o.traverse((child:any)=>{if(child.isSkinnedMesh)bad=true;});return bad;}))throw new Error('Head fitting requires a static pre-rig assembly.');
 const head=objects[names.indexOf('Atelier_head')],box=new THREE.Box3().setFromObject(head),pivot=box.getCenter(new THREE.Vector3());
 if(box.isEmpty()||!pivot.toArray().every(Number.isFinite))throw new Error('Head-fit preview has no finite head bounds.');
 const baselines=objects.map(o=>({object:o,local:o.matrix.clone(),world:o.matrixWorld.clone(),auto:o.matrixAutoUpdate}));
 const restore=()=>{for(let i=0;i<baselines.length;i++){if(groups[i].source!=='head')continue;const b=baselines[i];b.object.matrix.copy(b.local);b.object.matrix.decompose(b.object.position,b.object.quaternion,b.object.scale);b.object.matrixAutoUpdate=b.auto;}root.updateWorldMatrix(true,true);};
 return {restore,apply(p:HeadFitParameters){if(!validHeadFit(p))return null;restore();const delta=headFitDelta(p,pivot);for(let i=0;i<baselines.length;i++){if(groups[i].source!=='head')continue;const b=baselines[i],world=delta.clone().multiply(b.world),parent=b.object.parent?.matrixWorld||new THREE.Matrix4();b.object.matrix.copy(parent.clone().invert().multiply(world));b.object.matrixAutoUpdate=false;b.object.matrix.decompose(b.object.position,b.object.quaternion,b.object.scale);}root.updateWorldMatrix(true,true);return {parameters:p,headObjects:groups.filter(g=>g.source==='head').map(g=>`Atelier_${g.key}`),objects:baselines.map(b=>({name:b.object.name,matrix:b.object.matrixWorld.toArray(),originalMatrix:b.world.toArray()}))};}};
}
