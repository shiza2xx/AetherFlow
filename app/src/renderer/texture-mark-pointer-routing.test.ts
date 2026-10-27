import {describe,expect,it} from 'vitest';
import {resolveTextureMarkPointerStart,shouldPaintTextureMarkGesture} from './texture-mark-pointer-routing';

describe('paint-mode pointer ownership',()=>{
  const start=(overrides:Partial<Parameters<typeof resolveTextureMarkPointerStart>[0]>={})=>resolveTextureMarkPointerStart({button:0,markMode:true,loading:false,visibleMeshHit:true,verifiedBindingHit:true,...overrides});
  it('routes only verified model hits to paint and leaves background drags to OrbitControls',()=>{
    expect(start()).toEqual({owner:'paint',reportUnpaintable:false});
    const backgroundDrag=start({visibleMeshHit:false,verifiedBindingHit:false});
    expect(backgroundDrag).toEqual({owner:'orbit',reportUnpaintable:false});
    // Ownership is fixed on pointerdown: crossing a mesh never turns camera drag into paint.
    expect(shouldPaintTextureMarkGesture(backgroundDrag.owner)).toBe(false);
    const paintDrag=start();
    // Crossing the background never hands an existing paint gesture to OrbitControls.
    expect(shouldPaintTextureMarkGesture(paintDrag.owner)).toBe(true);
    expect(shouldPaintTextureMarkGesture('paint')).toBe(true);
  });
  it('blocks camera fallback for unverified visible surfaces and while preparation is pending',()=>{
    expect(start({verifiedBindingHit:false})).toEqual({owner:'blocked',reportUnpaintable:true});
    expect(start({loading:true})).toEqual({owner:'blocked',reportUnpaintable:false});
  });
  it('leaves non-left buttons and ordinary camera mode untouched',()=>{
    expect(start({button:1})).toEqual({owner:'none',reportUnpaintable:false});
    expect(start({button:2})).toEqual({owner:'none',reportUnpaintable:false});
    expect(start({markMode:false})).toEqual({owner:'none',reportUnpaintable:false});
  });
});
