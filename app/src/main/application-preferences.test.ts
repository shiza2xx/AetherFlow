import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {loadApplicationPreferences,saveApplicationPreferences,patchApplicationPreferences} from './application-preferences';
const roots:string[]=[];function root(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'af-application-prefs-'));roots.push(dir);return dir}
afterEach(()=>{for(const dir of roots.splice(0))fs.rmSync(dir,{recursive:true,force:true})});
describe('application onboarding and update preferences',()=>{
 it('defaults first launch to checking for updates and asks for language exactly until saved',()=>{const dir=root();expect(loadApplicationPreferences(dir)).toEqual({autoCheckUpdates:true,languageSelected:false});saveApplicationPreferences(dir,{autoCheckUpdates:false,languageSelected:true});expect(loadApplicationPreferences(dir,{autoCheckUpdates:true})).toEqual({autoCheckUpdates:false,languageSelected:true})});
 it('preserves a previously disabled workspace setting when initializing the new profile file',()=>{const dir=root();expect(loadApplicationPreferences(dir,{autoCheckUpdates:false}).autoCheckUpdates).toBe(false);expect(loadApplicationPreferences(dir,{autoCheckUpdates:true}).autoCheckUpdates).toBe(false)});
 it('rejects invalid updates before writing and excludes unrelated project fields',()=>{const dir=root(),before=loadApplicationPreferences(dir);expect(()=>patchApplicationPreferences(before,{autoCheckUpdates:'false'})).toThrow();expect(patchApplicationPreferences(before,{languageSelected:true,workspace:'foreign'})).toEqual({...before,languageSelected:true});expect(loadApplicationPreferences(dir)).toEqual(before)});
 it('does not enable network checks or overwrite unreadable existing preference content',()=>{const dir=root(),target=path.join(dir,'application-preferences-v1.json');fs.writeFileSync(target,'{broken');expect(loadApplicationPreferences(dir)).toEqual({autoCheckUpdates:false,languageSelected:false});expect(fs.readFileSync(target,'utf8')).toBe('{broken')});
});
