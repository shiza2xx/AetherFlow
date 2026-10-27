import {describe,expect,it,vi} from 'vitest';
import {seekVideosToLoopStart,type LoopSeekTarget} from './videoLoopLifecycle';

class DeferredSeekVideo extends EventTarget implements LoopSeekTarget {
  currentTime=4;
}

describe('paired video loop seek lifecycle',()=>{
  it('does not restart after an explicit pause cancels a deferred seek',async()=>{
    const video=new DeferredSeekVideo(),controller=new AbortController(),restart=vi.fn();
    const pending=seekVideosToLoopStart([video],controller.signal,()=>true,restart);
    controller.abort();
    video.dispatchEvent(new Event('seeked'));
    await expect(pending).resolves.toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it('does not restart when the captured source is no longer current',async()=>{
    const video=new DeferredSeekVideo(),controller=new AbortController(),restart=vi.fn();let current=true;
    const pending=seekVideosToLoopStart([video],controller.signal,()=>current,restart);
    current=false;
    video.dispatchEvent(new Event('seeked'));
    await expect(pending).resolves.toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it('restarts once when the loop seek completes and ownership is still current',async()=>{
    const video=new DeferredSeekVideo(),controller=new AbortController(),restart=vi.fn();
    const pending=seekVideosToLoopStart([video],controller.signal,()=>true,restart);
    video.dispatchEvent(new Event('seeked'));
    await expect(pending).resolves.toBe(true);
    expect(restart).toHaveBeenCalledTimes(1);
  });
});
