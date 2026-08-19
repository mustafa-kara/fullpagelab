import { nanoid } from 'nanoid';
import type { Id, IsoDate } from './types/primitives';

export function createId(): Id {
  return nanoid(16);
}

export function nowIso(): IsoDate {
  return new Date().toISOString();
}
