type OrbitControlsLike={
  enabled:boolean;
  enableDamping:boolean;
  autoRotate:boolean;
  target:{clone:()=>any;copy:(value:any)=>void};
  object:{position:{clone:()=>any;copy:(value:any)=>void};quaternion:{clone:()=>any;copy:(value:any)=>void};up:{clone:()=>any;copy:(value:any)=>void};zoom?:number;updateProjectionMatrix?:()=>void};
  update:()=>unknown;
};

/** Clear pending OrbitControls inertia without changing the pose already on screen. */
export function discardOrbitResidualWithoutCameraShift(controls:OrbitControlsLike){
  const camera=controls.object,pose={position:camera.position.clone(),quaternion:camera.quaternion.clone(),up:camera.up.clone(),target:controls.target.clone(),zoom:camera.zoom};
  const flags={enabled:controls.enabled,enableDamping:controls.enableDamping,autoRotate:controls.autoRotate};
  try{
    controls.enabled=true;controls.enableDamping=false;controls.autoRotate=false;
    controls.update();
    camera.position.copy(pose.position);camera.quaternion.copy(pose.quaternion);camera.up.copy(pose.up);controls.target.copy(pose.target);
    if(pose.zoom!==undefined){camera.zoom=pose.zoom;camera.updateProjectionMatrix?.();}
    controls.update();
  }finally{
    controls.enabled=flags.enabled;controls.enableDamping=flags.enableDamping;controls.autoRotate=flags.autoRotate;
  }
}

export function shouldUpdateOrbitForGesture(owner:'paint'|'orbit'|'blocked'|'none'|null){return owner!=='paint';}

export function pointerInsideViewerRect(x:number,y:number,rect:{left:number;top:number;right:number;bottom:number}){
  return x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;
}
