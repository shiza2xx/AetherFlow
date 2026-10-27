import {expect,it} from 'vitest';
import type {Entity} from '../shared/contracts';
import {viewerCharacterForAsset} from './viewer-lineage';

const entity=(id:string,kind:string,data:Record<string,unknown>={}):Entity=>({id,kind:kind as any,name:id,data,revision:1,createdAt:'',updatedAt:''});
it('binds source-version previews to the registered character through recorded lineage',()=>{
 const character=entity('character','character'),master=entity('master','artifact',{parentId:character.id}),preview=entity('preview','artifact',{sourceParentId:master.id,versionOf:master.id,versionRootId:master.id});
 const rows=new Map([[character.id,character],[master.id,master],[preview.id,preview]]),store={getAny:(id:string)=>rows.get(id)||null,links:()=>[]};
 expect(viewerCharacterForAsset(store,preview)).toBe(character.id);
});
it('accepts an explicit character-artifact link and rejects unrelated, missing, or cyclic sources',()=>{
 const character=entity('character','character'),direct=entity('direct','artifact'),a=entity('a','artifact',{sourceParentId:'b'}),b=entity('b','artifact',{versionOf:'a'}),other=entity('other','character');
 const rows=new Map([[character.id,character],[direct.id,direct],[a.id,a],[b.id,b],[other.id,other]]),store={getAny:(id:string)=>rows.get(id)||null,links:(id:string)=>id===direct.id?[{from_id:character.id,to_id:direct.id}]:[]};
 expect(viewerCharacterForAsset(store,direct)).toBe(character.id);expect(viewerCharacterForAsset(store,a)).toBeNull();expect(viewerCharacterForAsset(store,entity('orphan','artifact',{versionRootId:'missing'}))).toBeNull();expect(viewerCharacterForAsset(store,entity('foreign','artifact',{parentId:other.id}))).toBe(other.id);
});

it('resolves previews through a canonical v2 workflow only for the exact hashed guided slot artifact',()=>{
 const character=entity('v2-character','character',{workflowId:'v2-workflow'}),workflow=entity('v2-workflow','workflow',{definitionVersion:2,characterId:character.id,guided:{slots:[{key:'rigged-model',artifactId:'rigged',hash:'a'.repeat(64)}]}}),rigged=entity('rigged','artifact',{hash:'a'.repeat(64)}),preview=entity('preview','artifact',{sourceParentId:rigged.id,versionOf:rigged.id});
 const relations=[{from_id:character.id,to_id:workflow.id,role:'workflow'},{from_id:workflow.id,to_id:rigged.id,role:'guided:rigged-model'}],rows=new Map([[character.id,character],[workflow.id,workflow],[rigged.id,rigged],[preview.id,preview]]),store={getAny:(id:string)=>rows.get(id)||null,links:(id:string)=>relations.filter(link=>link.from_id===id||link.to_id===id)};
 expect(viewerCharacterForAsset(store,preview)).toBe(character.id);
});

it('rejects stale guided hashes and noncanonical or unrelated workflow links',()=>{
 const character=entity('v2-character','character',{workflowId:'v2-workflow'}),other=entity('other-character','character',{workflowId:'other-workflow'}),workflow=entity('v2-workflow','workflow',{definitionVersion:2,characterId:character.id,guided:{slots:[{key:'rigged-model',artifactId:'rigged',hash:'b'.repeat(64)}]}}),otherWorkflow=entity('other-workflow','workflow',{definitionVersion:2,characterId:other.id,guided:{slots:[{key:'rigged-model',artifactId:'unrelated',hash:'a'.repeat(64)}]}}),stale=entity('rigged','artifact',{hash:'a'.repeat(64)}),unrelated=entity('unrelated','artifact',{hash:'a'.repeat(64)}),operation=entity('operation','operation',{characterId:character.id});
 const relations=[{from_id:character.id,to_id:workflow.id,role:'workflow'},{from_id:workflow.id,to_id:stale.id,role:'guided:rigged-model'},{from_id:operation.id,to_id:unrelated.id,role:'related'},{from_id:otherWorkflow.id,to_id:unrelated.id,role:'guided:rigged-model'}],rows=new Map([[character.id,character],[other.id,other],[workflow.id,workflow],[otherWorkflow.id,otherWorkflow],[stale.id,stale],[unrelated.id,unrelated],[operation.id,operation]]),store={getAny:(id:string)=>rows.get(id)||null,links:(id:string)=>relations.filter(link=>link.from_id===id||link.to_id===id)};
 expect(viewerCharacterForAsset(store,stale)).toBeNull();
 expect(viewerCharacterForAsset(store,unrelated)).toBeNull();
});
