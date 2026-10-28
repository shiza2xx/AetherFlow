import {describe,it,expect} from 'vitest';
import {sidebarDragProgress} from './useSidebarMotion';
describe('sidebar gesture bounds',()=>{
 it('follows pointer displacement in both directions',()=>{expect(sidebarDragProgress(1,-116,232)).toBe(.5);expect(sidebarDragProgress(0,116,232)).toBe(.5)});
 it('clamps gestures outside the screen',()=>{expect(sidebarDragProgress(1,-1000,232)).toBe(0);expect(sidebarDragProgress(0,1000,232)).toBe(1)});
 it('keeps a zero-width fallback finite',()=>{expect(sidebarDragProgress(0,20,0)).toBe(1)});
});
