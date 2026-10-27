import {describe,expect,it} from 'vitest';
import {canPaintTextureMarkUv,canRenderTextureMarkUv,createTextureMarkUvSelection,markTextureMarkUvRendered,selectTextureMarkUvTarget} from './texture-mark-uv-selection';

describe('selected texture UV preview identity',()=>{
  it('keeps B visible while A changes and async A load completes, including multi-target history updates',()=>{
    let selection=selectTextureMarkUvTarget(createTextureMarkUvSelection(),'B');
    expect(canRenderTextureMarkUv(selection,'B')).toBe(true);
    selection=markTextureMarkUvRendered(selection,'B');
    expect(selection.renderedKey).toBe('B');

    // Updating A, clearing all targets, undo and redo must not change the UV selection.
    for(const changedKeys of [['A'],['A','B'],['B','A'],['A','B']]){
      for(const key of changedKeys)if(canRenderTextureMarkUv(selection,key))selection=markTextureMarkUvRendered(selection,key);
      expect(selection).toMatchObject({selectedKey:'B',renderedKey:'B'});
    }
    // A's delayed image callback is ignored while B is selected.
    expect(canRenderTextureMarkUv(selection,'A')).toBe(false);
    expect(selection).toMatchObject({selectedKey:'B',renderedKey:'B'});
    expect(canPaintTextureMarkUv(selection,'B')).toBe(true);
  });

  it('clears the previous preview during selection loading, then only accepts the newly selected image',()=>{
    let selection=markTextureMarkUvRendered(selectTextureMarkUvTarget(createTextureMarkUvSelection(),'B'),'B');
    selection=selectTextureMarkUvTarget(selection,'A');
    expect(selection).toMatchObject({selectedKey:'A',renderedKey:''});
    expect(canPaintTextureMarkUv(selection,'A')).toBe(false);
    expect(canPaintTextureMarkUv(selection,'B')).toBe(false);
    // A finishes first and becomes paintable; a later B callback cannot overwrite it.
    if(canRenderTextureMarkUv(selection,'A'))selection=markTextureMarkUvRendered(selection,'A');
    expect(canPaintTextureMarkUv(selection,'A')).toBe(true);
    if(canRenderTextureMarkUv(selection,'B'))selection=markTextureMarkUvRendered(selection,'B');
    expect(selection).toMatchObject({selectedKey:'A',renderedKey:'A'});
    expect(canPaintTextureMarkUv(selection,'B')).toBe(false);
  });
});
