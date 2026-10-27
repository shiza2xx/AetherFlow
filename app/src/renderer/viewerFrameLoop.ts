type FrameLoopOptions = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
  render: (deltaSeconds: number) => void;
  isAnimating: () => boolean;
  animationFps?: number;
};

/** Render on demand. Playback defaults to 60 Hz; input changes bypass that cap. */
export function createViewerFrameLoop(options: FrameLoopOptions) {
  let frame: number | undefined;
  let previousTime: number | undefined;
  let nextAnimationTime: number | undefined;
  const animationFps = options.animationFps ?? 60;
  if (!Number.isFinite(animationFps) || animationFps <= 0) throw new RangeError('Animation FPS must be positive and finite.');
  const animationInterval = 1000 / animationFps;
  let visible = true;
  let disposed = false;
  let dirty = false;

  const schedule = () => {
    if (!disposed && visible && frame === undefined) {
      frame = options.requestFrame(tick);
    }
  };

  function tick(now: number) {
    frame = undefined;
    if (disposed || !visible) return;
    if (!dirty && options.isAnimating() && nextAnimationTime !== undefined && now < nextAnimationTime) {
      schedule();
      return;
    }
    dirty = false;
    const delta = previousTime === undefined ? 0 : Math.max(0, (now - previousTime) / 1000);
    options.render(delta);
    if (disposed || !visible) return;
    if (dirty || options.isAnimating()) {
      previousTime = now;
      nextAnimationTime = nextAnimationTime === undefined || now < nextAnimationTime
        ? now + animationInterval
        : nextAnimationTime + (Math.floor((now - nextAnimationTime) / animationInterval) + 1) * animationInterval;
      schedule();
    } else {
      // A later invalidation starts at the current pose, not elapsed idle time.
      previousTime = undefined;
      nextAnimationTime = undefined;
    }
  }

  return {
    invalidate() {
      dirty = true;
      schedule();
    },
    setVisible(next: boolean) {
      if (disposed || visible === next) return;
      visible = next;
      previousTime = undefined;
      nextAnimationTime = undefined;
      if (!visible) {
        if (frame !== undefined) options.cancelFrame(frame);
        frame = undefined;
      } else {
        dirty = true;
        schedule();
      }
    },
    dispose() {
      disposed = true;
      if (frame !== undefined) options.cancelFrame(frame);
      frame = undefined;
      previousTime = undefined;
      nextAnimationTime = undefined;
    },
  };
}
