import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const variant = process.env.BUILD_VARIANT === 'cdp' ? 'cdp' : 'store';
const manifestPath = resolve(process.cwd(), 'dist', variant, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { permissions?: string[]; host_permissions?: string[]; optional_permissions?: string[]; optional_host_permissions?: string[] };
const permissions = manifest.permissions ?? [];
if (variant === 'store' && permissions.includes('debugger')) throw new Error('Store build cannot contain debugger');
if (variant === 'cdp' && !permissions.includes('debugger')) throw new Error('Cdp build must contain debugger');
if (manifest.host_permissions?.length) throw new Error('Static host permissions are forbidden');
if (!manifest.optional_permissions?.includes('notifications')) throw new Error('notifications must be optional');
if (!manifest.optional_permissions?.includes('webRequest')) throw new Error('webRequest must be optional');
if (!manifest.optional_host_permissions?.includes('<all_urls>')) throw new Error('Contextual optional host permission is missing');
console.log(`Manifest check passed for ${variant}`);
