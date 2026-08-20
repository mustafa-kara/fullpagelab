import type { ErrorCode } from '../../shared/types/primitives';
import type { CaptureTab, CapturePlatform } from './coordinator';

const restrictedSchemes = new Set(['about:', 'chrome:', 'chrome-extension:', 'devtools:', 'edge:', 'view-source:']);

export class CaptureValidationError extends Error {
  readonly code: ErrorCode;
  readonly recoverable: boolean;

  constructor(code: ErrorCode, message: string, recoverable = true) {
    super(message);
    this.name = 'CaptureValidationError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function isRestrictedPageUrl(url: string | undefined): boolean {
  if (!url) return true;
  const normalized = url.trim().toLowerCase();
  if (!normalized) return true;
  try {
    return restrictedSchemes.has(new URL(normalized).protocol);
  } catch {
    return true;
  }
}

export function isPdfViewerUrl(url: string | undefined): boolean {
  if (!url) return false;
  const normalized = url.toLowerCase();
  return normalized.includes('mhjfbmdgcfjbbpaeojofohoefgiehjai') || normalized.startsWith('pdf:') || /\.pdf(?:[?#]|$)/i.test(normalized);
}

export function validateCaptureTab(tab: CaptureTab, requiresPageAgent: boolean): void {
  if (!Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) {
    throw new CaptureValidationError('E_TAB_CLOSED', 'The capture tab is no longer available.', false);
  }
  if (tab.discarded) {
    throw new CaptureValidationError('E_TAB_CLOSED', 'The capture tab has been discarded.', true);
  }
  if (tab.windowVisible === false || tab.windowState === 'minimized') {
    throw new CaptureValidationError('E_WINDOW_NOT_VISIBLE', 'The capture window is not visible.', true);
  }
  if (requiresPageAgent && (isRestrictedPageUrl(tab.url) || isPdfViewerUrl(tab.url))) {
    throw new CaptureValidationError('E_RESTRICTED_PAGE', 'This page cannot be prepared for a full-page capture.', false);
  }
}

export function sameCaptureTab(actual: CaptureTab | undefined, expected: Pick<CaptureTab, 'id' | 'windowId'>): boolean {
  return actual?.id === expected.id && actual.windowId === expected.windowId;
}

export async function ensureActiveCaptureTab(
  platform: Pick<CapturePlatform, 'queryActiveTab' | 'focusTab'>,
  expected: Pick<CaptureTab, 'id' | 'windowId'>,
  requiresPageAgent: boolean,
): Promise<CaptureTab> {
  let active = await platform.queryActiveTab();
  if (!sameCaptureTab(active, expected) && platform.focusTab) {
    await platform.focusTab(expected.id, expected.windowId);
    active = await platform.queryActiveTab();
  }
  if (!sameCaptureTab(active, expected)) {
    throw new CaptureValidationError('E_TAB_NOT_ACTIVE', 'The capture tab is no longer active.', true);
  }
  if (!active) throw new CaptureValidationError('E_TAB_NOT_ACTIVE', 'The capture tab is no longer active.', true);
  validateCaptureTab(active, requiresPageAgent);
  return active;
}

export function mapCaptureVisibleTabError(error: unknown): CaptureValidationError | Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|rate.?limit/i.test(message)) {
    return new CaptureValidationError('E_RATE_LIMIT', message, true);
  }
  if (/permission|not allowed|access denied/i.test(message)) {
    return new CaptureValidationError('E_PERMISSION_DENIED', message, true);
  }
  if (/no tab|tab.*closed|window.*closed|invalid.*tab/i.test(message)) {
    return new CaptureValidationError('E_TAB_CLOSED', message, true);
  }
  return error instanceof Error ? error : new Error(message);
}
