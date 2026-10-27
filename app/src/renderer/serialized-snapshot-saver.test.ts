import {describe,expect,it,vi} from 'vitest';
import {cloneMarkupSnapshot,SerializedSnapshotSaver} from './serialized-snapshot-saver';

describe('serialized texture snapshot saving',()=>{
 it('does not mark a newer stroke saved when an older IPC response arrives, and flush returns the latest operation',async()=>{
  type Snapshot={description:string;targets:Array<{strokes:Array<{points:Array<{u:number;v:number}>}>}>};
  const pending:Array<{snapshot:Snapshot;resolve:(value:string)=>void}>=[],persist=vi.fn((snapshot:Snapshot)=>new Promise<string>(resolve=>pending.push({snapshot,resolve}))),saver=new SerializedSnapshotSaver<Snapshot,string>(cloneMarkupSnapshot,persist);
  const first:Snapshot={description:'first',targets:[{strokes:[{points:[{u:.1,v:.2}]}]}]};
  const firstSave=saver.enqueue(first);first.targets[0].strokes[0].points[0].u=.9;
  await vi.waitFor(()=>expect(pending).toHaveLength(1));expect(pending[0].snapshot.description).toBe('first');expect(pending[0].snapshot.targets[0].strokes[0].points[0].u).toBe(.1);
  const latest:Snapshot={description:'latest',targets:[{strokes:[{points:[{u:.1,v:.2}]},{points:[{u:.8,v:.7}]}]}]};
  const secondSave=saver.enqueue(latest);latest.targets[0].strokes[1].points[0].u=.99;
  const flush=saver.flush();pending[0].resolve('operation-1');await vi.waitFor(()=>expect(pending).toHaveLength(2));
  expect(saver.savedVersion).toBe(1);expect(saver.dirty).toBe(true);expect(pending).toHaveLength(2);expect(pending[1].snapshot.description).toBe('latest');expect(pending[1].snapshot.targets[0].strokes).toHaveLength(2);expect(pending[1].snapshot.targets[0].strokes[1].points[0].u).toBe(.8);
  pending[1].resolve('operation-2');await Promise.all([firstSave,secondSave]);await expect(flush).resolves.toBe('operation-2');expect(saver.savedVersion).toBe(2);expect(persist).toHaveBeenCalledTimes(2);
 });
});
