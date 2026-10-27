import {describe,expect,it} from 'vitest';
import {appendTextureMarkGestureSegment,createTextureMarkGestureBuffer,textureMarkGestureChanges} from './texture-mark-gesture';
import {commitTextureMarkChange,createTextureMarkHistory,redoTextureMarkChange,undoTextureMarkChange} from './texture-mark-history';

const stroke=(u:number)=>({mode:'paint' as const,radiusPx:18,points:[{u,v:.5}]});

describe('single pointer gesture history grouping',()=>{
  it('commits split segments across parts as one undoable action',()=>{
    const buffer=createTextureMarkGestureBuffer();
    appendTextureMarkGestureSegment(buffer,'upper',stroke(.2));
    appendTextureMarkGestureSegment(buffer,'hair',stroke(.7));
    appendTextureMarkGestureSegment(buffer,'upper',stroke(.4));
    let history=commitTextureMarkChange(createTextureMarkHistory(),textureMarkGestureChanges(buffer,new Map()));
    expect(history.undo).toHaveLength(1);
    expect(history.strokes.get('upper')).toHaveLength(2);
    expect(history.strokes.get('hair')).toHaveLength(1);
    history=undoTextureMarkChange(history);
    expect(history.strokes.get('upper')).toEqual([]);
    expect(history.strokes.get('hair')).toEqual([]);
    history=redoTextureMarkChange(history);
    expect(history.strokes.get('upper')).toHaveLength(2);
    expect(history.strokes.get('hair')).toHaveLength(1);
  });
});
