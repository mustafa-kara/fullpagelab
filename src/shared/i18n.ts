export function t(key: string, substitutions?: string | string[]): string {
  const value = chrome.i18n.getMessage(key, substitutions) || chrome.i18n.getMessage(key.replace(/\./g, '_'), substitutions);
  return value || key;
}
