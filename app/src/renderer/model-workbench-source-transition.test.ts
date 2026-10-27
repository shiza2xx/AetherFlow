import {describe,expect,it} from 'vitest';
import {consumeExternalArtifactRequest,isTextureSourceOperationCurrent,runTextureSourceTransition} from './model-workbench-source-transition';

describe('workbench source transitions',()=>{
 it('keeps a manual History choice until the parent sends a genuinely new artifact request',async()=>{
  const cursor={value:'A' as string|undefined};let source='A';const events:string[]=[];
  expect(consumeExternalArtifactRequest(cursor,'A')).toBeNull();
  await runTextureSourceTransition({value:'B',intent:'explicit',currentId:source,hasDirtyMarks:false,flush:async()=>null,onDeferred:()=>{},onSaveFailure:()=>{},commit:value=>{source=value;events.push(`commit:${value}`);}});
  expect(source).toBe('B');
  expect(consumeExternalArtifactRequest(cursor,'A')).toBeNull();
  expect(source).toBe('B');
  const request=consumeExternalArtifactRequest(cursor,'C');expect(request).toBe('C');
  const switched=await runTextureSourceTransition({value:request!,intent:'explicit',currentId:source,hasDirtyMarks:true,flush:async()=>{events.push('flush');return 'draft-B';},onDeferred:()=>{},onSaveFailure:()=>{},commit:value=>{source=value;events.push(`commit:${value}`);}});
  expect(switched).toBe(true);expect(source).toBe('C');expect(events).toEqual(['commit:B','flush','commit:C']);
  expect(consumeExternalArtifactRequest(cursor,'C')).toBeNull();
 });
 it('rejects a late texture extraction after automatic selection moves from A to B',async()=>{
  let current={epoch:4,sourceId:'A',workspace:'workspace-a',workspaceInstanceId:'instance-a'};
  const captured={...current};
  let resolveExtraction!:(value:{key:string}[])=>void;const delayed=new Promise<{key:string}[]>(resolve=>{resolveExtraction=resolve;});
  const events:string[]=[];await runTextureSourceTransition({value:'B',intent:'automatic',currentId:'A',hasDirtyMarks:false,flush:async()=>null,onDeferred:value=>events.push(`defer:${value}`),onSaveFailure:()=>events.push('failed'),commit:(value)=>{current={...current,epoch:current.epoch+1,sourceId:value};events.push(`commit:${value}`);}});
  resolveExtraction([{key:'texture-target-from-A'}]);
  const result=await delayed;
  expect(events).toEqual(['commit:B']);
  expect(isTextureSourceOperationCurrent(captured,current)).toBe(false);
  expect(isTextureSourceOperationCurrent(captured,{...current,sourceId:'A'})).toBe(false);
  expect(result).toEqual([{key:'texture-target-from-A'}]);
 });
 it('defers automatic switches while dirty and commits explicit switches only after the save finishes',async()=>{
  const events:string[]=[];let source='A';
  const onCommit=(value:string)=>{source=value;events.push(`commit:${value}`);};
  const deferred=await runTextureSourceTransition({value:'B',intent:'automatic',currentId:source,hasDirtyMarks:true,flush:async()=>{events.push('flush');return 'draft-A';},onDeferred:value=>events.push(`offer:${value}`),onSaveFailure:()=>events.push('failed'),commit:onCommit});
  expect(deferred).toBe(false);expect(source).toBe('A');expect(events).toEqual(['offer:B']);
  const switchTask=runTextureSourceTransition({value:'B',intent:'explicit',currentId:source,hasDirtyMarks:true,flush:async()=>{events.push('flush-start');await Promise.resolve();events.push('flush-done');return 'draft-A';},onDeferred:value=>events.push(`offer:${value}`),onSaveFailure:()=>events.push('failed'),commit:onCommit});
  expect(source).toBe('A');expect(await switchTask).toBe(true);expect(source).toBe('B');expect(events).toEqual(['offer:B','flush-start','flush-done','commit:B']);
 });
 it('retains the existing source when dirty-mark persistence fails',async()=>{
  const events:string[]=[];const transitioned=await runTextureSourceTransition({value:'B',intent:'explicit',currentId:'A',hasDirtyMarks:true,flush:async()=>null,onDeferred:()=>events.push('offered'),onSaveFailure:()=>events.push('save-failed'),commit:()=>events.push('committed')});
  expect(transitioned).toBe(false);expect(events).toEqual(['save-failed']);
 });
 it('rejects workbench results after workspace or workspace-instance changes',()=>{
  const captured={epoch:1,sourceId:'A',workspace:'workspace-a',workspaceInstanceId:'instance-a'};
  expect(isTextureSourceOperationCurrent(captured,{...captured,workspace:'workspace-b'})).toBe(false);
  expect(isTextureSourceOperationCurrent(captured,{...captured,workspaceInstanceId:'instance-b'})).toBe(false);
 });
});
