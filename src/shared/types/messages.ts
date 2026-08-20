import type { AgentScrollRequest, CaptureMode, CanvasLimits, JobProgress, JobState, PageMetrics, PreparePlan, PreparedState, ScanOptions } from './capture';
import type { ExportRequest, ExportResult } from './export';
import type { CaptureRecord, TemporaryResultPayload } from './history';
import type { ErrorInfo, Id, Point, Size } from './primitives';
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
  'capture.start': { req: { mode: CaptureMode }; res: { jobId: Id } };
  'onboarding.openDemo': { req: void; res: { tabId: number } };
  'capture.cancel': { req: { jobId: Id }; res: void };
  'history.get': { req: { id: Id }; res: CaptureRecord | null };
  'result.get': { req: { id: Id }; res: TemporaryResultPayload | null };
  'export.request': { req: ExportRequest; res: ExportResult };
  'export.copy': { req: { captureId: Id; stripIndex?: number }; res: { copiedAs: 'png' } };
  'job.progress': { req: JobProgress; res: void };
  'agent.ping': { req: void; res: { ready: boolean; version: string } };
  'agent.scan': { req: ScanOptions; res: PageMetrics };
  'agent.scroll': { req: AgentScrollRequest; res: { actual: Point; documentNow: Size; elapsedMs: number } };
  'agent.prepare': { req: { plan: PreparePlan; metrics: PageMetrics }; res: PreparedState };
  'agent.restore': { req: void; res: { restored: true } };
  'agent.progress': { req: JobProgress; res: void };
  'offscreen.probeLimits': { req: void; res: CanvasLimits };
}
