import * as THREE from 'three';

/** Read authored bounds without moving meshes, rigs or animation roots. */
export function modelFraming(bounds:THREE.Box3,aspect:number,fov=35){
  if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite))throw new Error('The model has no finite display bounds.');
  const center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3());
  const radius=Math.max(size.length()/2,1e-5),ratio=Math.max(.05,Number.isFinite(aspect)?aspect:1);
  const vertical=THREE.MathUtils.degToRad(fov)/2,horizontal=Math.atan(Math.tan(vertical)*ratio);
  const distance=radius/Math.sin(Math.min(vertical,horizontal))*1.12;
  return {center,size,radius,distance,near:Math.max(radius/1000,1e-6),far:Math.max(radius*100,distance*10),halfHeight:radius*1.12/Math.min(1,ratio),ground:new THREE.Vector3(center.x,bounds.min.y-radius*.001,center.z),gridScale:Math.max(size.x,size.y,size.z,1e-5)*.4};
}

export function resizeViewerCamera(camera:THREE.PerspectiveCamera|THREE.OrthographicCamera,aspect:number){
  const ratio=Math.max(.05,aspect);
  if(camera instanceof THREE.PerspectiveCamera){camera.aspect=ratio;}
  else{const halfHeight=(camera.top-camera.bottom)/2;camera.left=-halfHeight*ratio;camera.right=halfHeight*ratio;}
  camera.updateProjectionMatrix();
}
