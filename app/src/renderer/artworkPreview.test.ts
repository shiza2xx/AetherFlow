import {describe,expect,it} from 'vitest';
import {artworkPreviewAfterLoad,artworkPreviewForIdentity,artworkPreviewIdentity} from './artworkPreview';

describe('artwork preview identity',()=>{
  it('retains a loaded preview during same-source refresh and refresh failure',()=>{
    const identity=artworkPreviewIdentity('workspace-a','asset-1',undefined,false);
    const loaded={identity,url:'data:image/png;base64,synthetic'};
    expect(artworkPreviewForIdentity(loaded,identity)).toEqual(loaded);
    expect(artworkPreviewAfterLoad(loaded,identity,{error:'temporary refresh failure'})).toEqual(loaded);
  });

  it('invalidates changed sources, preview modes, and workspace identities, and ignores stale loads',()=>{
    const identity=artworkPreviewIdentity('workspace-a','asset-1',undefined,false);
    const loaded={identity,url:'data:image/png;base64,synthetic'};
    const changedIdentity=artworkPreviewIdentity('workspace-a','asset-2',undefined,false),changed=artworkPreviewForIdentity(loaded,changedIdentity);
    expect(changed).toEqual({identity:changedIdentity});
    expect(artworkPreviewAfterLoad(changed,identity,{url:'data:image/png;base64,stale'})).toBe(changed);
    expect(artworkPreviewForIdentity(loaded,artworkPreviewIdentity('workspace-b','asset-1',undefined,false))).toEqual({identity:artworkPreviewIdentity('workspace-b','asset-1',undefined,false)});
    expect(artworkPreviewForIdentity(loaded,artworkPreviewIdentity('workspace-a','asset-1',undefined,true))).toEqual({identity:artworkPreviewIdentity('workspace-a','asset-1',undefined,true)});
    expect(artworkPreviewAfterLoad(changed,changedIdentity,{error:'not found'})).toEqual({identity:changedIdentity,error:'not found'});
  });
});
