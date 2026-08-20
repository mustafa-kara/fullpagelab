import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const variant = process.env.BUILD_VARIANT === 'cdp' ? 'cdp' : 'store';
const root = resolve(process.cwd(), 'dist', variant);
const agent = resolve(root, 'content/page-agent.js');
if (!existsSync(agent)) throw new Error('Missing dist/content/page-agent.js');
const source = readFileSync(agent, 'utf8');
if (/\bimport\s*(?:\(|\{|["'])|\bimport\.meta\b/.test(source)) throw new Error('Content agent contains unresolved imports');
console.log(`content/page-agent.js is bundled for ${variant}`);
