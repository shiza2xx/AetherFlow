import {beforeEach,describe,expect,it,vi} from 'vitest';
import {call} from './api';
import {flushTaskChecklistMutations} from './taskChecklistMutations';
import {completeTask,taskCompletionBlockers} from './taskCompletion';
import type {Entity} from '../shared/contracts';

vi.mock('./api',()=>({call:vi.fn()}));
vi.mock('./taskChecklistMutations',()=>({flushTaskChecklistMutations:vi.fn()}));

const entity={id:'task-1',kind:'task',name:'Prepare review',revision:7,data:{status:'In progress',progress:35,checklist:[{id:'step-1',text:'Review notes',completed:false}],blocker:true,resolutionState:'unresolved'}};

describe('completeTask',()=>{
  beforeEach(()=>vi.resetAllMocks());

  it('persists Done through the revisioned task put without changing checklist or gate data',async()=>{
    vi.mocked(flushTaskChecklistMutations).mockResolvedValue(true);
    vi.mocked(call).mockResolvedValueOnce({ok:true,data:entity} as any).mockResolvedValueOnce({ok:true,data:{...entity,revision:8,data:{...entity.data,status:'Done',progress:100}}} as any);

    const result=await completeTask(entity.id);

    expect(result.ok).toBe(true);
    expect(call).toHaveBeenNthCalledWith(1,{op:'get',kind:'task',id:entity.id});
    expect(call).toHaveBeenNthCalledWith(2,{op:'put',entity:{id:entity.id,kind:'task',name:entity.name,data:{...entity.data,status:'Done',progress:100},expectedRevision:entity.revision}});
  });

  it('does not write when pending checklist changes did not flush',async()=>{
    vi.mocked(flushTaskChecklistMutations).mockResolvedValue(false);

    const result=await completeTask(entity.id);

    expect(result.ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it('returns a failed put without reporting completion',async()=>{
    vi.mocked(flushTaskChecklistMutations).mockResolvedValue(true);
    vi.mocked(call).mockResolvedValueOnce({ok:true,data:entity} as any).mockResolvedValueOnce({ok:false,error:{message:'Revision conflict',code:'REVISION_CONFLICT'}} as any);

    const result=await completeTask(entity.id);

    expect(result.ok).toBe(false);
    if(result.ok)throw new Error('A revision conflict cannot complete a task.');
    expect(result.error.code).toBe('REVISION_CONFLICT');
  });
});

describe('taskCompletionBlockers',()=>{
 it('resolves prerequisite names and open subtasks, preserves missing references, and deduplicates links',()=>{
  const prerequisite={id:'task-prereq',kind:'task',name:'Approve the source',data:{status:'In progress'}} as unknown as Entity;
  const child={id:'task-child',kind:'task',name:'Export the preview',data:{status:'To do',parentTaskId:entity.id}} as unknown as Entity;
  const parent={...entity,data:{...entity.data,dependencyIds:['task-prereq','missing-id','task-prereq']}} as unknown as Entity;
  expect(taskCompletionBlockers(parent,[prerequisite,child])).toEqual([{id:'task-prereq',name:'Approve the source',status:'In progress',missing:false},{id:'missing-id',name:'Missing task (missing-id)',missing:true},{id:'task-child',name:'Export the preview',status:'To do'}]);
 });
});
