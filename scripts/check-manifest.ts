import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const variant = process.env.BUILD_VARIANT === 'cdp' ? 'cdp' : 'store';
const root = resolve(process.cwd(), 'dist', variant);
const manifestPath = resolve(root, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  permissions?: string[];
  host_permissions?: string[];
  optional_permissions?: string[];
  optional_host_permissions?: string[];
  icons?: Record<string, string>;
  action?: { default_icon?: Record<string, string> };
};
const permissions = manifest.permissions ?? [];
if (variant === 'store' && permissions.includes('debugger')) throw new Error('Store build cannot contain debugger');
if (variant === 'cdp' && !permissions.includes('debugger')) throw new Error('Cdp build must contain debugger');
if (manifest.host_permissions?.length) throw new Error('Static host permissions are forbidden');
if (!manifest.optional_permissions?.includes('notifications')) throw new Error('notifications must be optional');
if (!manifest.optional_permissions?.includes('webRequest')) throw new Error('webRequest must be optional');
if (!manifest.optional_host_permissions?.includes('<all_urls>')) throw new Error('Contextual optional host permission is missing');
for (const iconPath of new Set([
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
])) {
  if (!existsSync(resolve(root, iconPath))) throw new Error(`Missing manifest icon: ${iconPath}`);
}
console.log(`Manifest check passed for ${variant}`);
