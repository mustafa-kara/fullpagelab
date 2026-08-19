import { createId } from './ids';
import type { Msg, MsgMap, Reply } from './types/messages';
import type { ErrorCode, ErrorInfo } from './types/primitives';

export function createMessage<K extends keyof MsgMap>(type: K, payload: MsgMap[K]['req'], from: NonNullable<Msg<K>['from']>): Msg<K> {
  return { v: 1, type, id: createId(), payload, from };
}

export function createError(code: ErrorCode, message: string, recoverable = false): ErrorInfo {
  return {
    code,
    message,
    userMessageKey: `error.${code}.body`,
    recoverable,
    at: new Date().toISOString(),
  };
}

export function isReply(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && 'v' in value && (value as { v?: unknown }).v === 1 && 'ok' in value;
}

export function sendMessage<K extends keyof MsgMap>(type: K, payload: MsgMap[K]['req']): Promise<MsgMap[K]['res']> {
  const message = createMessage(type, payload, 'ui');
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: Reply<K>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!isReply(response) || !response.ok) {
        reject(new Error(response && !response.ok ? response.error.message : 'Invalid extension response'));
        return;
      }
      resolve(response.payload);
    });
  });
}
