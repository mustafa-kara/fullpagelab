import { defaultSettings } from '../shared/defaults';
import { log } from '../shared/log';
import { createError } from '../shared/messages';
import type { MessageMap, Msg, Reply } from '../shared/types/messages';
import type { CanvasLimits, JobState } from '../shared/types/primitives';
import type { Settings } from '../shared/types/settings';

const settingsKey = 'settings';
const jobsKey = 'activeJobs';
let settings: Settings = defaultSettings;

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get(settingsKey);
  settings = { ...defaultSettings, ...(stored[settingsKey] as Partial<Settings> | undefined) };
  await chrome.storage.local.set({ [settingsKey]: settings });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  log('info', 'lifecycle', 'Service worker initialized');
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.WORKERS],
    justification: 'Process screenshot data locally in a hidden extension page.',
  });
}

function reply<K extends keyof MessageMap>(message: Msg<K>, payload: unknown): Reply<K> {
  return { v: 1, type: message.type, id: message.id, ok: true, payload } as Reply<K>;
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void init().then(async () => {
    if (reason === 'install') {
      await chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/onboarding/index.html') });
    }
  });
});
chrome.runtime.onStartup.addListener(() => void init());
void init();

chrome.runtime.onMessage.addListener((raw: Msg, sender, sendResponse) => {
  if (raw.from === 'sw' && raw.type === 'offscreen.probeLimits') return false;
  void (async () => {
    if (raw.v !== 1) {
      sendResponse({ v: 1, type: raw.type, id: raw.id, ok: false, error: createError('E_PROTOCOL', 'Unsupported message version') });
      return;
    }
    try {
      switch (raw.type) {
        case 'settings.get':
          sendResponse(reply(raw, settings));
          return;
        case 'settings.set': {
          const patch = raw.payload as { patch: Partial<Settings> };
          settings = { ...settings, ...patch.patch };
          await chrome.storage.local.set({ [settingsKey]: settings });
          sendResponse(reply(raw, settings));
          return;
        }
        case 'capture.listActive': {
          const stored = await chrome.storage.session.get(jobsKey);
          sendResponse(reply(raw, (stored[jobsKey] as JobState[] | undefined) ?? []));
          return;
        }
        case 'offscreen.probeLimits': {
          await ensureOffscreen();
          const limits = await new Promise<CanvasLimits>((resolve, reject) => {
            chrome.runtime.sendMessage({ ...raw, from: 'sw' }, (response: Reply<'offscreen.probeLimits'>) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!response) {
                reject(new Error('Offscreen document returned no response'));
                return;
              }
              if (!response.ok) {
                reject(new Error(response.error.message));
                return;
              }
              resolve(response.payload);
            });
          });
          sendResponse(reply(raw, limits));
          return;
        }
        case 'capture.ping':
          sendResponse(reply(raw, { ready: true, version: '0.1.0' }));
          return;
        default:
          sendResponse({ v: 1, type: raw.type, id: raw.id, ok: false, error: createError('E_NOT_SUPPORTED', `Unsupported message: ${raw.type}`) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown service worker error';
      log('error', 'message', message, sender.tab?.id?.toString());
      sendResponse({ v: 1, type: raw.type, id: raw.id, ok: false, error: createError('E_UNKNOWN', message, true) });
    }
  })();
  return true;
});
