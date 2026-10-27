import {describe, expect, it} from 'vitest';
import {createViewerFrameLoop} from './viewerFrameLoop';

function fixture() {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const deltas: number[] = [];
  let animating = false;
  let onRender: (() => void) | undefined;
  const loop = createViewerFrameLoop({
    requestFrame(callback) { const id = ++nextId; callbacks.set(id, callback); return id; },
    cancelFrame(id) { callbacks.delete(id); },
    render(delta) { deltas.push(delta); onRender?.(); },
    isAnimating: () => animating,
  });
  return {
    loop, callbacks, deltas,
    animate(value: boolean) { animating = value; },
    onRender(callback: () => void) { onRender = callback; },
    frame(now: number) {
      const [id, callback] = [...callbacks][0];
      callbacks.delete(id);
      callback(now);
    },
  };
}

describe('viewer frame scheduling', () => {
  it('renders one idle change and coalesces requests without a continuous loop', () => {
    const view = fixture();
    for (let i = 0; i < 20; i++) view.loop.invalidate();
    expect(view.callbacks.size).toBe(1);
    view.frame(100);
    expect(view.deltas).toEqual([0]);
    expect(view.callbacks.size).toBe(0);
    view.loop.invalidate();
    view.frame(100000);
    expect(view.deltas).toEqual([0, 0]);
  });

  it('advances playing animation by frame time and stops when paused', () => {
    const view = fixture();
    view.animate(true);
    view.loop.invalidate();
    view.frame(100);
    view.frame(120);
    view.frame(140);
    expect(view.deltas).toEqual([0, .02, .02]);
    view.animate(false);
    view.frame(160);
    expect(view.callbacks.size).toBe(0);
    view.animate(true);
    view.loop.invalidate();
    view.frame(5000);
    expect(view.deltas.at(-1)).toBe(0);
  });

  it('retains camera-damping invalidations raised during rendering', () => {
    const view = fixture();
    view.onRender(() => { if (view.deltas.length < 3) view.loop.invalidate(); });
    view.loop.invalidate();
    view.frame(100);
    view.frame(120);
    view.frame(132);
    expect(view.deltas.length).toBe(3);
    expect(view.callbacks.size).toBe(0);
  });

  it('limits animation redraws on a fast display without losing elapsed time', () => {
    const view = fixture();
    view.animate(true);
    view.loop.invalidate();
    for (let now = 0; now <= 1001; now += 7) view.frame(now);
    expect(view.deltas.length).toBeGreaterThanOrEqual(60);
    expect(view.deltas.length).toBeLessThanOrEqual(61);
    expect(view.deltas.reduce((sum, delta) => sum + delta, 0)).toBeGreaterThan(.98);
    expect(view.deltas.reduce((sum, delta) => sum + delta, 0)).toBeCloseTo(1.001, 12);
    view.loop.dispose();
  });

  it('redraws a camera input immediately instead of waiting for the animation cap', () => {
    const view = fixture();
    view.animate(true);
    view.loop.invalidate();
    view.frame(100);
    view.loop.invalidate();
    view.frame(107);
    expect(view.deltas).toEqual([0, .007]);
    view.loop.dispose();
  });

  it('suspends hidden views and resumes without advancing hidden elapsed time', () => {
    const view = fixture();
    view.animate(true);
    view.loop.invalidate();
    view.frame(100);
    view.frame(120);
    view.loop.setVisible(false);
    view.loop.invalidate();
    expect(view.callbacks.size).toBe(0);
    view.loop.setVisible(true);
    view.frame(900000);
    expect(view.deltas).toEqual([0, .02, 0]);
    expect(view.callbacks.size).toBe(1);
  });

  it('ignores a dequeued callback after disposal and never restarts', () => {
    const view = fixture();
    view.loop.invalidate();
    const callback = [...view.callbacks.values()][0];
    view.loop.dispose();
    callback(100);
    view.loop.invalidate();
    view.loop.setVisible(false);
    view.loop.setVisible(true);
    expect(view.callbacks.size).toBe(0);
    expect(view.deltas.length).toBe(0);
  });

  it('keeps separate viewer lifecycles independent', () => {
    const left = fixture(), right = fixture();
    left.animate(true);
    right.animate(true);
    left.loop.invalidate();
    right.loop.invalidate();
    left.frame(100);
    right.frame(100);
    left.loop.dispose();
    right.frame(120);
    expect(left.callbacks.size).toBe(0);
    expect(right.callbacks.size).toBe(1);
    expect(right.deltas).toEqual([0, .02]);
    right.loop.dispose();
  });
});
