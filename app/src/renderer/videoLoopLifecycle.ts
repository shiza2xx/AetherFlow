export interface LoopSeekTarget extends EventTarget {
  currentTime: number;
}

/** Seek every active clip to zero and restart only if the owner is still current. */
export async function seekVideosToLoopStart(
  videos: readonly LoopSeekTarget[],
  signal: AbortSignal,
  isCurrent: () => boolean,
  restart: () => void,
): Promise<boolean> {
  const seekOne = (video: LoopSeekTarget) => new Promise<boolean>(resolve => {
    if (signal.aborted) { resolve(false); return; }
    if (video.currentTime < 0.025) { resolve(true); return; }

    let settled = false;
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    };
    const onSeeked = () => done(true);
    const onError = () => done(false);
    const onAbort = () => done(false);
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    try { video.currentTime = 0; } catch { done(false); }
  });

  const results = await Promise.all(videos.map(seekOne));
  if (results.some(ok => !ok) || signal.aborted || !isCurrent()) return false;
  restart();
  return true;
}
