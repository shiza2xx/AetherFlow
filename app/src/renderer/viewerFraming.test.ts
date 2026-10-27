import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {modelFraming,resizeViewerCamera} from './viewerFraming';

describe('source-preserving studio framing',()=>{
  it('places the ground just below elevated, off-center authored bounds without rewriting them',()=>{
    const bounds=new THREE.Box3(new THREE.Vector3(80,150,-34),new THREE.Vector3(82,154,-32)),original=bounds.clone();
    const frame=modelFraming(bounds,1.8);
    expect(frame.ground.x).toBe(81);expect(frame.ground.z).toBe(-33);expect(frame.ground.y).toBeLessThan(150);expect(150-frame.ground.y).toBeLessThan(.01);expect(bounds.equals(original)).toBe(true);
  });
  it('fits a full sphere inside both horizontal and vertical FOV at narrow and wide sizes',()=>{
    const bounds=new THREE.Box3(new THREE.Vector3(-1,-3,-1),new THREE.Vector3(1,3,1));
    for(const aspect of [.4,1,2.7]){const f=modelFraming(bounds,aspect),v=THREE.MathUtils.degToRad(35)/2,h=Math.atan(Math.tan(v)*aspect);expect(f.distance*Math.sin(Math.min(v,h))).toBeGreaterThan(f.radius);expect(f.far).toBeGreaterThan(f.distance+f.radius);}
    expect(modelFraming(bounds,.4).distance).toBeGreaterThan(modelFraming(bounds,2.7).distance);
  });
  it('keeps orthographic zoom extent when resizing instead of resetting to two world units',()=>{
    const c=new THREE.OrthographicCamera(-200,200,100,-100,.1,10000);c.zoom=1.3;resizeViewerCamera(c,.5);expect(c.left).toBe(-50);expect(c.right).toBe(50);expect(c.top).toBe(100);expect(c.zoom).toBe(1.3);
  });
  it('rejects empty and nonfinite bounds',()=>{
    expect(()=>modelFraming(new THREE.Box3(),1)).toThrow();expect(()=>modelFraming(new THREE.Box3(new THREE.Vector3(NaN,0,0),new THREE.Vector3(1,1,1)),1)).toThrow();
  });
});
