import type { JobState, PageMetrics } from '../../shared/types/capture';
import type { CaptureRecord } from '../../shared/types/history';
import type { Id } from '../../shared/types/primitives';

export interface CaptureResultInput {
  job: JobState;
  original: Blob;
  strips?: Blob[];
  metrics?: PageMetrics;
  durationMs: number;
}

export interface CaptureResultService {
  save(input: CaptureResultInput): Promise<CaptureRecord>;
  get(id: Id): Promise<CaptureRecord | null>;
}
