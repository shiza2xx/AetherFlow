import {expect,it} from 'vitest';
import {OwnerResponseGate,recoveryErrorText} from './codexDockRecovery';

it('ignores an asynchronous owner response after character or workspace navigation',()=>{
 const gate=new OwnerResponseGate('workspace-a:character-1'),token=gate.capture(),errors:string[]=[];
 gate.update('workspace-a:character-2');
 expect(gate.apply(token,()=>errors.push('stale character failure'))).toBe(false);
 expect(errors).toEqual([]);
 const next=gate.capture();gate.update('workspace-b:character-2');
 expect(gate.apply(next,()=>errors.push('stale workspace failure'))).toBe(false);
 expect(errors).toEqual([]);
});

it('localizes recovery codes while preserving the English source as technical detail',()=>{
 const message='The pending character launch expired without a uniquely verifiable session.';
 expect(recoveryErrorText('SESSION_RECOVERY_REQUIRED',message,'en')).not.toBe(message);
 expect(recoveryErrorText('SESSION_RECOVERY_REQUIRED',message,'ru')).not.toMatch(/pending|launch|expired/i);
 expect(recoveryErrorText('SESSION_METADATA_CONFLICT',message,'ru')).toContain('метаданные');
});
