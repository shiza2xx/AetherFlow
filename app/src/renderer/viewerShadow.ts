import type * as THREE from 'three';

/** Reduce self-shadow acne without changing the model, its materials, or its normals. */
export function configureViewerShadow(light:THREE.DirectionalLight,radius:number){
  if(!Number.isFinite(radius)||radius<=0)throw new Error('Viewer shadow radius must be finite and positive.');
  // Normal bias is measured in world units, so it must follow the model scale.
  light.shadow.bias=-0.00005;
  light.shadow.normalBias=radius*0.001;
}

/** Model still casts onto the ground, but does not receive aliased preview-map shadows. */
export function configureViewerMeshShadows(mesh:THREE.Mesh){
  mesh.castShadow=true;
  mesh.receiveShadow=false;
}
