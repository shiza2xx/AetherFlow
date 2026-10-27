import {expect,it} from 'vitest';
import {revisitedStepDestination} from './guidedContinue';

it('continues from a revisited completed stage by navigating to the open next stage',()=>{
 const steps=[{key:'receive-materials',state:'complete',canOpen:true},{key:'export-rig-source',state:'current',canOpen:true}];
 expect(revisitedStepDestination(steps,'receive-materials','export-rig-source')).toBe('export-rig-source');
 expect(revisitedStepDestination(steps,'export-rig-source','export-rig-source')).toBeNull();
});
it('keeps navigation closed when the next stage is blocked or the revisited stage is not complete',()=>{
 expect(revisitedStepDestination([{key:'receive-materials',state:'complete',canOpen:true},{key:'export-rig-source',state:'locked',canOpen:false}],'receive-materials','export-rig-source')).toBeNull();
 expect(revisitedStepDestination([{key:'receive-materials',state:'needs-review',canOpen:true},{key:'export-rig-source',state:'current',canOpen:true}],'receive-materials','export-rig-source')).toBeNull();
});
