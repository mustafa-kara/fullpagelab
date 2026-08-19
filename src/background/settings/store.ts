import { defaultSettings } from '../../shared/defaults';
import type { DeepPartial, Settings } from '../../shared/types/settings';

const key = 'settings';

export interface StorageAreaLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function merge<T extends object>(base: T, patch: DeepPartial<T>): T {
  const result = { ...base };
  for (const [field, value] of Object.entries(patch)) {
    if (isRecord(value) && field in result && isRecord(result[field as keyof T])) {
      (result as Record<string, unknown>)[field] = merge(result[field as keyof T] as object, value as DeepPartial<object>);
    } else if (value !== undefined) {
      (result as Record<string, unknown>)[field] = value;
    }
  }
  return result;
}

export function migrateSettings(value: unknown): Settings {
  const stored = isRecord(value) ? value : {};
  const schemaVersion = typeof stored.schemaVersion === 'number' ? stored.schemaVersion : 0;
  if (schemaVersion > defaultSettings.schemaVersion) throw new Error(`Unsupported settings schema: ${schemaVersion}`);
  const migrated = merge(defaultSettings, stored as DeepPartial<Settings>);
  return { ...migrated, schemaVersion: defaultSettings.schemaVersion };
}

export function createSettingsStore(storage: StorageAreaLike = chrome.storage.local) {
  const get = async (): Promise<Settings> => {
    const stored = await storage.get(key);
    return migrateSettings(stored[key]);
  };
  const set = async (patch: DeepPartial<Settings>): Promise<Settings> => {
    const settings = migrateSettings(merge(await get(), patch));
    await storage.set({ [key]: settings });
    return settings;
  };
  const reset = async (): Promise<Settings> => {
    await storage.set({ [key]: defaultSettings });
    return defaultSettings;
  };
  return { get, set, reset };
}
