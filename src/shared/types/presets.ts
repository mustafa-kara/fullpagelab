import type { CaptureMode, CaptureOptions } from './capture';
import type { ExportPlan } from './export';
import type { Id, IsoDate } from './primitives';
import type { DeepPartial } from './settings';

export interface Preset { id: Id; name: string; icon?: string; builtin: boolean; description?: string; capture: DeepPartial<CaptureOptions> & { mode?: CaptureMode }; export: DeepPartial<ExportPlan>; extras?: { evidence?: unknown; bugReport?: unknown; ocrIndex?: boolean; autoTags?: string[] }; createdAt: IsoDate; updatedAt: IsoDate; }
