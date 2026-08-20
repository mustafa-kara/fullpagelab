import { describe, expect, it } from 'vitest';
import type { MsgMap } from '../../src/shared/types/messages';

describe('result contracts', () => {
  it('defines typed result and export operations', () => {
    const get: MsgMap['history.get']['req'] = { id: 'capture-1' };
    const exportRequest: MsgMap['export.request']['req'] = {
      captureId: 'capture-1',
      plan: {} as MsgMap['export.request']['req']['plan'],
    };
    const copy: MsgMap['export.copy']['req'] = { captureId: 'capture-1' };

    expect(get.id).toBe('capture-1');
    expect(exportRequest.captureId).toBe(copy.captureId);
  });
});
