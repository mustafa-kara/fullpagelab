import type { CanvasLimits, JobProgress, JobState, PageMetrics, ScanOptions } from './capture';
import type { ErrorInfo, Id } from './primitives';
import type { DeepPartial, Settings } from './settings';

export type MessageMap = MsgMap;

export interface Msg<K extends keyof MsgMap = keyof MsgMap> {
  v: 1;
  type: K;
  id: Id;
  payload: MsgMap[K]['req'];
  from?: 'sw' | 'cs' | 'offscreen' | 'ui' | 'external';
}

export type Reply<K extends keyof MsgMap = keyof MsgMap> =
  | { v: 1; type: K; id: Id; ok: true; payload: MsgMap[K]['res'] }
  | { v: 1; type: K; id: Id; ok: false; error: ErrorInfo };

export interface MsgMap {
  'settings.get': { req: void; res: Settings };
  'settings.set': { req: { patch: DeepPartial<Settings> }; res: Settings };
  'capture.ping': { req: void; res: { ready: boolean; version: string } };
  'capture.listActive': { req: void; res: JobState[] };
  'job.progress': { req: JobProgress; res: void };
  'agent.ping': { req: void; res: { ready: boolean; version: string } };
  'agent.scan': { req: ScanOptions; res: PageMetrics };
  'offscreen.probeLimits': { req: void; res: CanvasLimits };
}
