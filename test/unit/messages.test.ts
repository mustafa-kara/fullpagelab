import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/shared/defaults';
import { createError, createMessage, isReply } from '../../src/shared/messages';
import type { CaptureRequest } from '../../src/shared/types/capture';
import { captureRequestSchema, envelopeSchema, replySchema } from '../../src/shared/types/schemas';

describe('message contracts', () => {
  it('creates a versioned message envelope', () => {
    const message = createMessage('capture.ping', undefined, 'ui');
    expect(envelopeSchema.parse(message)).toEqual(message);
    expect(message.v).toBe(1);
    expect(message.type).toBe('capture.ping');
  });

  it('rejects unsupported protocol versions', () => {
    expect(() => envelopeSchema.parse({ v: 2, type: 'capture.ping', id: 'a', payload: undefined })).toThrow();
  });

  it('validates complete capture requests at the message boundary', () => {
    const captureRequest: CaptureRequest = {
      mode: 'fullPage',
      target: {},
      options: structuredClone(defaultSettings.capture),
      export: structuredClone(defaultSettings.export),
      trigger: 'contextMenu',
    };

    expect(captureRequestSchema.parse(captureRequest)).toEqual(captureRequest);
    expect(() => captureRequestSchema.parse({ ...captureRequest, trigger: undefined })).toThrow();
  });

  it('serializes errors as replies', () => {
    const reply = { v: 1, type: 'capture.ping', id: 'a', ok: false as const, error: createError('E_PROTOCOL', 'bad') };
    expect(replySchema.parse(reply)).toEqual(reply);
    expect(isReply(reply)).toBe(true);
  });
});
