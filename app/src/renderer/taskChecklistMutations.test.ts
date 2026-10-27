import {describe,expect,it} from 'vitest';
import {reconcileChecklist,type ChecklistItem} from './taskChecklistReconcile';

describe('reconcileChecklist',()=>{
  it('merges only changed fields so a queued rename preserves a newer completion',()=>{
    const base:ChecklistItem[]=[{id:'step-1',text:'Before',completed:false}];
    const requested=[{...base[0],text:'Renamed'}];
    const latest=[{...base[0],completed:true}];
    expect(reconcileChecklist(base,requested)(latest)).toEqual([{id:'step-1',text:'Renamed',completed:true}]);
  });

  it('merges a queued completion without restoring an older text value',()=>{
    const base:ChecklistItem[]=[{id:'step-1',text:'Before',completed:false}];
    const requested=[{...base[0],completed:true}];
    const latest=[{...base[0],text:'Renamed elsewhere'}];
    expect(reconcileChecklist(base,requested)(latest)).toEqual([{id:'step-1',text:'Renamed elsewhere',completed:true}]);
  });
});
