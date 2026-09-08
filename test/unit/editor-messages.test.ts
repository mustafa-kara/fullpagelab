import { describe, expect, it } from 'vitest';
import type { MsgMap } from '../../src/shared/types/messages';

describe('editor message contracts', () => {
  it('declares editor.save and editor.load in the message map', () => {
    const save: keyof MsgMap = 'editor.save';
    const load: keyof MsgMap = 'editor.load';
    expect([save, load]).toEqual(['editor.save', 'editor.load']);
  });

  it('types editor.save to return the capture id it wrote', () => {
    const response: MsgMap['editor.save']['res'] = { captureId: 'capture-1', createdNewRecord: false };
    expect(response.captureId).toBe('capture-1');
  });
});
