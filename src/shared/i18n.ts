export function t(key: string, substitutions?: string | string[]): string {
  const value = chrome.i18n.getMessage(key, substitutions);
  return value || key;
}
