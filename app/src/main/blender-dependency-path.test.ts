import {describe,expect,it} from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {blenderStagedDependencyPath} from './blender-adapter';

describe('Blender dependency staging paths',()=>{
  it('keeps managed filenames content-addressed, portable, and below Windows MAX_PATH',()=>{
    const hash='a'.repeat(64);
    const root=path.join(os.tmpdir(),'atelier-managed-workspace','work','f'.repeat(36),'external-dependencies');
    const staged=blenderStagedDependencyPath(root,'deep/materials/body/albedo.png',hash);
    expect(path.basename(staged)).toBe(`${hash}.png`);
    expect(staged.length).toBeLessThan(240);
    expect(()=>blenderStagedDependencyPath(root,'../../escape.png',hash)).toThrow(/unsafe/i);
    expect(()=>blenderStagedDependencyPath(root,'textures/albedo.png','bad-hash')).toThrow(/SHA-256/i);
  });
});
