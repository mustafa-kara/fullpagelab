import type { StorageStats } from '../../shared/types/history';
import type { Settings } from '../../shared/types/settings';

export function quotaLevel(stats: StorageStats, settings: Settings): 'ok' | 'warning' | 'critical' {
  const storageRatio = stats.quotaBytes > 0 ? stats.usageBytes / stats.quotaBytes : 0;
  const itemRatio = settings.history.maxItems > 0 ? stats.captures / settings.history.maxItems : 0;
  const ratio = Math.max(storageRatio, itemRatio);
  if (ratio >= 0.95) return 'critical';
  if (ratio >= 0.85) return 'warning';
  return 'ok';
}
