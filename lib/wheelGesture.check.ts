// Self-check for the wheel-gesture stepper — run: npx tsx lib/wheelGesture.check.ts
// No framework (ponytail): plain asserts.
import assert from 'node:assert';
import { createWheelStepper, normaliseWheelDelta } from './wheelGesture';

const PIXEL = 0, LINE = 1, PAGE = 2;

// deltaMode normalisation: Firefox reports lines/pages, not pixels.
assert.equal(normaliseWheelDelta(100, PIXEL), 100);
assert.equal(normaliseWheelDelta(3, LINE), 48);
assert.equal(normaliseWheelDelta(1, PAGE), 400);

// Small incidental movement never steps — this is the "cursor crossed the
// heading while scrolling the page" case that used to switch boards.
{
  const s = createWheelStepper();
  let t = 1000;
  for (let i = 0; i < 10; i++) assert.equal(s.push(5, PIXEL, (t += 16)), 0);
  assert.equal(s.peekAccum(), 50);
}

// One decaying trackpad flick yields exactly one step, not several.
// Deltas decay and inter-event gaps widen — the shape that made the old 50ms
// trailing debounce fire repeatedly mid-gesture.
{
  const s = createWheelStepper();
  const deltas = [40, 55, 48, 30, 20, 12, 8, 5, 3, 2, 1];
  let t = 1000, gap = 8, steps = 0;
  for (const d of deltas) {
    t += gap;
    gap += 12; // gaps widen as momentum decays
    if (s.push(d, PIXEL, t) !== 0) steps++;
  }
  assert.equal(steps, 1, 'one flick must produce exactly one step');
}

// The step fires on threshold crossing, in the right direction.
{
  const s = createWheelStepper({ stepThreshold: 120 });
  let t = 1000;
  assert.equal(s.push(60, PIXEL, (t += 16)), 0);
  assert.equal(s.push(60, PIXEL, (t += 16)), 1, 'crossing +120 steps forward');

  const back = createWheelStepper({ stepThreshold: 120 });
  let u = 1000;
  assert.equal(back.push(-70, PIXEL, (u += 16)), 0);
  assert.equal(back.push(-70, PIXEL, (u += 16)), -1, 'crossing -120 steps back');
}

// Cooldown blocks the momentum tail, then releases.
{
  const s = createWheelStepper({ stepThreshold: 100, cooldownMs: 400 });
  let t = 1000;
  assert.equal(s.push(100, PIXEL, t), 1);
  assert.equal(s.push(100, PIXEL, t + 100), 0, 'still cooling down');
  assert.equal(s.push(100, PIXEL, t + 399), 0, 'still cooling down at the edge');
  assert.equal(s.push(100, PIXEL, t + 400), 1, 'cooldown elapsed, steps again');
}

// A long idle gap starts a fresh gesture rather than resuming the old total.
{
  const s = createWheelStepper({ stepThreshold: 100, gestureIdleMs: 200 });
  let t = 1000;
  s.push(90, PIXEL, t);
  assert.equal(s.peekAccum(), 90);
  assert.equal(s.push(90, PIXEL, t + 500), 0, 'idle gap dropped the stale 90');
  assert.equal(s.peekAccum(), 90);
}

// Reversing direction mid-gesture restarts the count, so a flick back doesn't
// inherit the forward total and immediately overshoot the other way.
{
  const s = createWheelStepper({ stepThreshold: 100 });
  let t = 1000;
  s.push(90, PIXEL, (t += 16));
  assert.equal(s.push(-20, PIXEL, (t += 16)), 0, 'reversal must not cross the threshold');
  assert.equal(s.peekAccum(), -20);
}

// A zero delta (horizontal-only scroll) must not be treated as a reversal.
{
  const s = createWheelStepper({ stepThreshold: 100 });
  let t = 1000;
  s.push(60, PIXEL, (t += 16));
  s.push(0, PIXEL, (t += 16));
  assert.equal(s.peekAccum(), 60, 'zero delta preserved the running total');
  assert.equal(s.push(40, PIXEL, (t += 16)), 1, 'accumulation continued through the zero');
}

// Firefox line-mode notches reach the threshold in a sane number of notches.
{
  const s = createWheelStepper({ stepThreshold: 120 });
  let t = 1000, steps = 0;
  for (let i = 0; i < 3; i++) if (s.push(3, LINE, (t += 16)) !== 0) steps++;
  assert.equal(steps, 1, '3 Firefox notches (48px each) cross a 120px threshold');
}

console.log('wheelGesture: all checks passed');
