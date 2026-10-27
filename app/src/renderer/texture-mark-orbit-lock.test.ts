import {describe,expect,it} from 'vitest';
import {discardOrbitResidualWithoutCameraShift,pointerInsideViewerRect,shouldUpdateOrbitForGesture} from './texture-mark-orbit-lock';

class Vec3{
  constructor(public x=0,public y=0,public z=0){}
  clone(){return new Vec3(this.x,this.y,this.z)}
  copy(value:Vec3){this.x=value.x;this.y=value.y;this.z=value.z;return this}
}

describe('paint gesture camera ownership',()=>{
  it('discards damped orbit residual without shifting the displayed camera or changing control settings',()=>{
    const camera={position:new Vec3(1,2,3),quaternion:new Vec3(0,0,0),up:new Vec3(0,1,0),zoom:1,updateProjectionMatrix(){}};
    const controls:any={object:camera,target:new Vec3(4,5,6),enabled:true,enableDamping:true,autoRotate:false,residual:0,update(){if(this.enableDamping)this.object.position.x+=this.residual;else{this.object.position.x+=this.residual;this.residual=0;}return true;}};
    controls.residual=.25;const before={position:camera.position.clone(),target:controls.target.clone()};
    discardOrbitResidualWithoutCameraShift(controls);
    expect(camera.position).toEqual(before.position);expect(controls.target).toEqual(before.target);expect(controls.residual).toBe(0);
    expect(controls).toMatchObject({enabled:true,enableDamping:true,autoRotate:false});
  });

  it('pauses control updates only while a paint-owned gesture is active',()=>{
    expect(shouldUpdateOrbitForGesture('paint')).toBe(false);
    expect(shouldUpdateOrbitForGesture('orbit')).toBe(true);
    expect(shouldUpdateOrbitForGesture(null)).toBe(true);
  });

  it('does not raycast captured strokes beyond the visible canvas boundary',()=>{
    const rect={left:100,top:50,right:500,bottom:350};
    expect(pointerInsideViewerRect(100,50,rect)).toBe(true);
    expect(pointerInsideViewerRect(500,350,rect)).toBe(true);
    expect(pointerInsideViewerRect(99,100,rect)).toBe(false);
    expect(pointerInsideViewerRect(250,351,rect)).toBe(false);
  });
});
