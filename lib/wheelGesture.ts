/**
 * Turns a stream of raw `wheel` events into discrete, deliberate steps.
 *
 * A wheel "gesture" is not a single event. One trackpad flick emits a burst of
 * events over 500-1500ms as inertia decays, and the gaps between them grow as the
 * deltas shrink — so a short trailing debounce fires partway *through* the decay
 * and then keeps firing as momentum continues. Binding an expensive action (a
 * board switch costs a route change plus a fetch) to that turns one flick into
 * several actions.
 *
 * This accumulates distance instead, emits one step per threshold crossing, and
 * then locks out input long enough for the tail of the gesture to be ignored.
 */

export type WheelStepperOptions = {
  /** Accumulated wheel distance (px) required to emit one step. */
  stepThreshold?: number;
  /** Input ignored after a step, so gesture momentum can't chain. */
  cooldownMs?: number;
  /** A gap this long means a new gesture began; stale accumulation is dropped. */
  gestureIdleMs?: number;
};

/** -1 = step backwards, 1 = step forwards, 0 = not enough movement yet. */
export type WheelStep = -1 | 0 | 1;

// Firefox reports deltaMode in lines (1) or pages (2) rather than pixels (0),
// where one notch is ~3 rather than ~100. Normalise so a pixel threshold means
// the same thing in every browser.
const LINE_PX = 16;
const PAGE_PX = 400;

export function normaliseWheelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_PX;
  if (deltaMode === 2) return deltaY * PAGE_PX;
  return deltaY;
}

export function createWheelStepper(options: WheelStepperOptions = {}) {
  const stepThreshold = options.stepThreshold ?? 120;
  const cooldownMs = options.cooldownMs ?? 400;
  const gestureIdleMs = options.gestureIdleMs ?? 200;

  let accum = 0;
  let lastEventAt = -Infinity;
  let lockedUntil = 0;

  return {
    /** Feed one wheel event. Returns the step to take, or 0 for none. */
    push(deltaY: number, deltaMode: number, now: number): WheelStep {
      if (now < lockedUntil) return 0;

      const delta = normaliseWheelDelta(deltaY, deltaMode);

      // Reset on a new gesture or a direction reversal, so a flick back the other
      // way doesn't inherit the previous gesture's running total.
      const reversed = delta !== 0 && accum !== 0 && Math.sign(delta) !== Math.sign(accum);
      if (now - lastEventAt > gestureIdleMs || reversed) accum = 0;

      lastEventAt = now;
      accum += delta;

      if (Math.abs(accum) < stepThreshold) return 0;

      const direction: WheelStep = accum > 0 ? 1 : -1;
      accum = 0;
      lockedUntil = now + cooldownMs;
      return direction;
    },

    /** Test/debug accessor for the pending accumulation. */
    peekAccum() {
      return accum;
    },
  };
}
