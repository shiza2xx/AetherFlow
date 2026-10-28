import {describe,it,expect} from 'vitest';
import {constrainPanel,initialPanel} from './floatingPanel';
describe('independent floating terminal geometry',()=>{
 it('keeps an oversized or moved panel reachable after a window shrink',()=>{const result=constrainPanel({x:1300,y:850,width:1000,height:800},{width:900,height:620});expect(result.x).toBeGreaterThanOrEqual(12);expect(result.y).toBeGreaterThanOrEqual(52);expect(result.x+result.width).toBeLessThanOrEqual(888);expect(result.y+result.height).toBeLessThanOrEqual(582);expect(result.width/result.height).not.toBe(1)});
 it('keeps custom geometry on reopening while clamping only to the viewport',()=>{const viewport={width:1440,height:920},saved={x:310,y:200,width:760,height:410};expect(constrainPanel(saved,viewport)).toEqual(saved);expect(initialPanel(viewport).width).toBe(640)});
});
