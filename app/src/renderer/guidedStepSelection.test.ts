import {describe,expect,it} from 'vitest';
import {activeGuidedStepAfterRefresh,initialGuidedStepApplication,restorableGuidedCandidates} from './guidedStepSelection';

describe('initial guided route is applied once per explicit command',()=>{
  it('waits for workflow steps, then does not rewind after later workflow refreshes',()=>{
    const first=initialGuidedStepApplication(null,'character-1','source',[]);
    expect(first).toEqual({appliedKey:null,stepKey:null});
    const loaded=initialGuidedStepApplication(first.appliedKey,'character-1','source',[{key:'source'},{key:'views'}]);
    expect(loaded).toEqual({appliedKey:'character-1:source',stepKey:'source'});
    expect(initialGuidedStepApplication(loaded.appliedKey,'character-1','source',[{key:'source'},{key:'views'}])).toEqual({appliedKey:'character-1:source',stepKey:null});
  });
  it('applies a new explicit step command and allows it again after clearing the command',()=>{
    const views=initialGuidedStepApplication('character-1:source','character-1','views',[{key:'source'},{key:'views'}]);
    expect(views).toEqual({appliedKey:'character-1:views',stepKey:'views'});
    expect(initialGuidedStepApplication(views.appliedKey,'character-1',undefined,[{key:'source'},{key:'views'}])).toEqual({appliedKey:null,stepKey:null});
    expect(initialGuidedStepApplication(null,'character-1','views',[{key:'views'}])).toEqual({appliedKey:'character-1:views',stepKey:'views'});
  });
});

describe('guided route refresh after review adoption',()=>{
  it('keeps an open inspection step on ordinary refresh',()=>{
    expect(activeGuidedStepAfterRefresh('prepare-groups',[{key:'prepare-groups',canOpen:true}], 'prepare-groups')).toBe('prepare-groups');
  });
  it('moves to the persisted rewind step when an adopted correction locks the prior selection',()=>{
    expect(activeGuidedStepAfterRefresh('finish',[{key:'finish',canOpen:false},{key:'receive-segments',canOpen:true}], 'receive-segments')).toBe('receive-segments');
  });
});

describe('guided candidate history actions',()=>{
  it('keeps the current rejected candidate restorable as a new pending version',()=>{
    const candidates=[{id:'rejected-current',reviewStatus:'rejected'},{id:'pending',reviewStatus:'pending'}];
    expect(restorableGuidedCandidates(candidates)).toEqual([candidates[0]]);
  });
});
