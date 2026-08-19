import type { Id } from './types/primitives';

const sensitiveKey = /token|secret|authorization|password/i;

export interface LogEntry {
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  namespace: string;
  jobId?: Id;
  message: string;
}

export function redact(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitiveKey.test(key) ? '***' : redact(item)]));
}

export function log(level: LogEntry['level'], namespace: string, message: string, jobId?: Id): void {
  const entry: LogEntry = { at: new Date().toISOString(), level, namespace, message, ...(jobId ? { jobId } : {}) };
  if (import.meta.env.DEV) console[level === 'debug' ? 'log' : level](entry);
}
