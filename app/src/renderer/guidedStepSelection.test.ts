import {describe,expect,it} from 'vitest';
import {RpcSchema} from '../shared/contracts';
import {activeGuidedStepAfterRefresh,guidedGenerationRequest,initialGuidedStepApplication,restorableGuidedCandidates} from './guidedStepSelection';

describe('guided generation requests sent by the character editor',()=>{
  const characterId='9814cc84-04d7-4eb6-a200-efa1355d7f19';
  const slotId='1f9c2e8f-ce98-446e-883e-c8ff419d82e8';

  it.each(['views','depth'] as const)('accepts a full %s batch at the IPC boundary',purpose=>{
    const request=RpcSchema.parse(guidedGenerationRequest(characterId,purpose,{},''));
    expect(request).toMatchObject({op:'guided:generation:prepare',characterId,purpose});
    expect(request).not.toHaveProperty('spec');
    expect(request).toHaveProperty('part',undefined);
  });

  it('preserves the precise slot and option for manual generation and corrections',()=>{
    expect(RpcSchema.parse(guidedGenerationRequest(characterId,'views',{part:'head',slotId},'')))
      .toMatchObject({part:'head',slotId});
    expect(RpcSchema.parse(guidedGenerationRequest(characterId,'correction',{slotId,editMode:'fresh-reference'},'Match the reference.')))
      .toMatchObject({slotId,editMode:'fresh-reference',note:'Match the reference.'});
  });
});

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
