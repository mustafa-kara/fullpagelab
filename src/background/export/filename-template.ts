import type { CaptureMode } from '../../shared/types/capture';
import type { ExportFormat } from '../../shared/types/export';

export interface FilenameContext {
  domain: string;
  hostname: string;
  title: string;
  url: string;
  capturedAt: Date;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  mode: CaptureMode;
  format: ExportFormat;
  timezone: string;
  counter: () => number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function clean(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180) || 'capture';
}

function dateParts(date: Date): { date: string; time: string; datetime: string } {
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const min = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}${min}${ss}`, datetime: `${yyyy}-${mm}-${dd}_${hh}${min}${ss}` };
}

export function resolveFilename(template: string, context: FilenameContext): string {
  const parts = dateParts(context.capturedAt);
  const values: Record<string, string> = {
    domain: context.domain,
    hostname: context.hostname,
    title: context.title,
    url: context.url,
    date: parts.date,
    time: parts.time,
    datetime: parts.datetime,
    'yyyy-mm-dd': parts.date,
    width: String(context.width),
    height: String(context.height),
    viewport: `${context.viewportWidth}x${context.viewportHeight}`,
    mode: context.mode,
    format: context.format,
    timezone: context.timezone,
    counter: String(context.counter()).padStart(3, '0'),
  };
  const resolved = template.replace(/\{([a-z0-9-]+)\}/gi, (_token, key: string) => values[key.toLowerCase()] ?? '');
  return clean(resolved.replace(/-{2,}/g, '-'));
}

export function extensionForFormat(format: ExportFormat): string {
  if (format === 'jpeg') return 'jpg';
  return format;
}
