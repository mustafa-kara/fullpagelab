import { describe, expect, it } from 'vitest';
import { createId, nowIso } from '../../src/shared/ids';

describe('shared IDs', () => {
  it('creates non-empty unique-length IDs', () => {
    const id = createId();
    expect(id).toHaveLength(16);
  });

  it('creates ISO timestamps', () => {
    expect(() => new Date(nowIso())).not.toThrow();
    expect(nowIso()).toMatch(/Z$/);
  });
});
