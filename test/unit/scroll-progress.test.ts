import { describe, expect, it } from 'vitest';
import { assertAcknowledgedProgress } from '../../src/background/capture/scroll-progress';
import { createVerticalPlan } from '../../src/background/capture/plan';

function plan() {
  return createVerticalPlan({
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 1_350 },
    scroll: { x: 0, y: 0 },
    dpr: 1,
  });
}

describe('acknowledged scroll progress', () => {
  it('accepts the first tile at the capture origin', () => {
    const capturePlan = plan();
    const first = capturePlan.steps[0];
    if (!first) throw new Error('Expected a first capture step.');

    expect(() => assertAcknowledgedProgress(capturePlan, first, { x: 0, y: 0 })).not.toThrow();
  });

  it('rejects a first tile that misses the capture origin', () => {
    const capturePlan = plan();
    const first = capturePlan.steps[0];
    if (!first) throw new Error('Expected a first capture step.');

    expect(() => assertAcknowledgedProgress(capturePlan, first, { x: 0, y: 120 })).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    );
  });

  it('accepts a browser-clamped final acknowledgment', () => {
    const capturePlan = plan();
    const previous = capturePlan.steps[1];
    const final = capturePlan.steps[2];
    if (!previous || !final) throw new Error('Expected later capture steps.');

    expect(() => assertAcknowledgedProgress(capturePlan, final, { x: 0, y: 749.5 }, { step: previous, actual: { x: 0, y: 600 } })).not.toThrow();
  });

  it('rejects a later tile that repeats the preceding acknowledgment', () => {
    const capturePlan = plan();
    const previous = capturePlan.steps[0];
    const next = capturePlan.steps[1];
    if (!previous || !next) throw new Error('Expected consecutive capture steps.');

    expect(() => assertAcknowledgedProgress(capturePlan, next, { x: 0, y: 0 }, { step: previous, actual: { x: 0, y: 0 } })).toThrowError(
      expect.objectContaining({ code: 'E_VALIDATION' }),
    );
  });

  it('allows horizontal position to reset when a new row advances vertically', () => {
    const capturePlan = plan();
    const previous = { ...capturePlan.steps[0]!, row: 0, col: 1 };
    const next = { ...capturePlan.steps[1]!, row: 1, col: 0 };

    expect(() => assertAcknowledgedProgress(capturePlan, next, { x: 0, y: 600 }, { step: previous, actual: { x: 400, y: 0 } })).not.toThrow();
  });
});
