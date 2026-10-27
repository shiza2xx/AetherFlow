import {describe,expect,it} from 'vitest';
import {validateReopenedExport} from './blender-adapter';

const source={meshCount:2,armatureCount:1,vertexCount:24,polygonCount:12,triangleCount:12,materialNames:['Skin','Cloth'],bounds:{min:[-1,-2,0],max:[1,2,3]}};

describe('reopened Blender export proof',()=>{
 it('accepts exact source triangulation after GLB triangulates source polygons',()=>{
  const triangulatedSource={...source,triangleCount:18};
  expect(validateReopenedExport(triangulatedSource,{...source,polygonCount:18,triangleCount:18},'glb')).toBe(true);
  expect(validateReopenedExport(triangulatedSource,{...source,vertexCount:30,polygonCount:18,triangleCount:18},'glb')).toBe(true);
  expect(validateReopenedExport(source,source,'blend')).toBe(true);
 });
 it('rejects an extra mesh even when the scene otherwise has plausible counts',()=>{
  expect(()=>validateReopenedExport(source,{...source,meshCount:3,vertexCount:27},'fbx')).toThrow(/mesh or rig counts/i);
 });
 it('rejects changed bounds, missing materials, incomplete triangulation, and extra GLB faces',()=>{
  expect(()=>validateReopenedExport(source,{...source,bounds:{min:[-1,-2,0],max:[1,2,3.5]}},'fbx')).toThrow(/bounds/i);
  expect(()=>validateReopenedExport(source,{...source,materialNames:['Skin']},'glb')).toThrow(/material count/i);
  expect(()=>validateReopenedExport(source,{...source,polygonCount:10},'glb')).toThrow(/exact source triangulation/i);
  const triangulatedSource={...source,triangleCount:18};
  expect(()=>validateReopenedExport(triangulatedSource,{...source,polygonCount:19,triangleCount:19},'glb')).toThrow(/exact source triangulation/i);
  expect(()=>validateReopenedExport(triangulatedSource,{...source,polygonCount:18,triangleCount:19},'glb')).toThrow(/exact source triangulation/i);
 });
});
