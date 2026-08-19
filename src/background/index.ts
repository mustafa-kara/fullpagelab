import { defaultSettings } from '../shared/defaults';
import { createId } from '../shared/ids';
import { log } from '../shared/log';
import { createError, createMessage, isReply } from '../shared/messages';
import type { CaptureMode, CanvasLimits } from '../shared/types/capture';
import type { MessageMap, Msg, Reply } from '../shared/types/messages';
import { envelopeSchema } from '../shared/types/schemas';
import type { DeepPartial, Settings } from '../shared/types/settings';
import { createCaptureCoordinator } from './capture/coordinator';
import { blobToDataUrl } from './capture/image';
import { createHistoryService } from './history/service';
import { createJobStateStore } from './job-state';
import { recoverInterruptedJobs } from './lifecycle';
import { createSettingsStore } from './settings/store';

const settingsKey = 'settings';
const gcAlarmName = 'ssx.daily-gc';
const settingsStore = createSettingsStore();
const jobStateStore = createJobStateStore();
const historyService = createHistoryService();

async function injectPageAgent(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/page-agent.js'] });
}

function sendAgentMessage<K extends keyof MessageMap>(tabId: number, type: K, payload: MessageMap[K]['req']): Promise<MessageMap[K]['res']> {
  const message = createMessage(type, payload, 'sw');
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: Reply<K>) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!isReply(response) || !response.ok) {
        reject(new Error(response && !response.ok ? response.error.message : 'Invalid agent response.'));
        return;
      }
      resolve(response.payload as MessageMap[K]['res']);
    });
  });
}

const captureCoordinator = createCaptureCoordinator({
  jobs: jobStateStore,
  platform: {
    async queryActiveTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined || tab.windowId === undefined) return undefined;
      return { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title };
    },
    captureVisibleTab(windowId) {
      return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    },
    async scan(tabId) {
      await injectPageAgent(tabId);
      return sendAgentMessage(tabId, 'agent.scan', { findScrollContainers: false, findFixedElements: false, findIframes: false });
    },
    async scroll(tabId, point) {
      const result = await sendAgentMessage(tabId, 'agent.scroll', point);
      return result.actual;
    },
    async restore(tabId, point) {
      await sendAgentMessage(tabId, 'agent.scroll', point);
    },
    async download(blob, filename) {
      return chrome.downloads.download({ url: await blobToDataUrl(blob), filename, saveAs: false, conflictAction: 'uniquify' });
    },
  },
});

let settings: Settings = defaultSettings;
let initialization: Promise<void> | undefined;
let updateAvailable = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageErrorResponse(raw: unknown): Reply {
  const candidate = isRecord(raw) ? raw : {};
  const type = typeof candidate.type === 'string' ? candidate.type : 'unknown';
  const id = typeof candidate.id === 'string' ? candidate.id : createId();
  return { v: 1, type, id, ok: false, error: createError('E_PROTOCOL', 'Invalid extension message envelope.') } as Reply;
}

function reply<K extends keyof MessageMap>(message: Msg<K>, payload: MessageMap[K]['res']): Reply<K> {
  return { v: 1, type: message.type, id: message.id, ok: true, payload };
}

async function runGarbageCollection(): Promise<void> {
  try {
    const activeJobs = await jobStateStore.listActive();
    const remainingBlobs = await historyService.gc(activeJobs.map((job) => job.jobId));
    log('info', 'storage', 'Daily garbage collection completed; ' + remainingBlobs + ' blobs remain.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown garbage collection error';
    log('error', 'storage', message);
  }
}

async function maybeApplyUpdate(): Promise<void> {
  if (!updateAvailable) return;
  const activeJobs = await jobStateStore.listActive();
  if (activeJobs.length > 0) {
    log('info', 'lifecycle', 'Update deferred while ' + activeJobs.length + ' capture job(s) are active.');
    return;
  }
  updateAvailable = false;
  log('info', 'lifecycle', 'Applying deferred extension update.');
  chrome.runtime.reload();
}

async function initialize(): Promise<void> {
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  settings = await settingsStore.get();
  await chrome.storage.local.set({ [settingsKey]: settings });

  const recovered = await recoverInterruptedJobs(jobStateStore);
  if (recovered.length > 0) log('warn', 'lifecycle', recovered.length + ' interrupted capture job(s) marked failed.');

  await chrome.alarms.create(gcAlarmName, { periodInMinutes: 24 * 60 });
  await runGarbageCollection();
  log('info', 'lifecycle', 'Service worker initialized');
}

function init(): Promise<void> {
  if (initialization) return initialization;
  initialization = initialize().finally(() => {
    initialization = undefined;
  });
  return initialization;
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/offscreen/offscreen.html'),
    reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.WORKERS],
    justification: 'Process screenshot data locally in a hidden extension page.',
  });
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void init()
    .then(async () => {
      if (reason === 'install') await chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/onboarding/index.html') });
    })
    .catch((error: unknown) => log('error', 'lifecycle', error instanceof Error ? error.message : 'Install initialization failed'));
});

chrome.runtime.onStartup.addListener(() => {
  void init().catch((error: unknown) => log('error', 'lifecycle', error instanceof Error ? error.message : 'Startup initialization failed'));
});

chrome.runtime.onUpdateAvailable.addListener(() => {
  updateAvailable = true;
  void init()
    .then(() => maybeApplyUpdate())
    .catch((error: unknown) => log('error', 'lifecycle', error instanceof Error ? error.message : 'Update initialization failed'));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === gcAlarmName) void runGarbageCollection();
});

void init().catch((error: unknown) => log('error', 'lifecycle', error instanceof Error ? error.message : 'Initialisation failed'));

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  const parsed = envelopeSchema.safeParse(raw);
  if (!parsed.success) {
    sendResponse(messageErrorResponse(raw));
    return false;
  }

  const message = parsed.data as Msg;
  if (message.from === 'sw' && message.type === 'offscreen.probeLimits') return false;

  void (async () => {
    try {
      await init();
      switch (message.type) {
        case 'settings.get':
          sendResponse(reply(message, settings));
          return;
        case 'settings.set': {
          const payload = message.payload as { patch?: DeepPartial<Settings> };
          if (!payload || !payload.patch || !isRecord(payload.patch)) throw new Error('Settings patch is required.');
          settings = await settingsStore.set(payload.patch);
          sendResponse(reply(message, settings));
          return;
        }
        case 'capture.listActive': {
          const activeJobs = await jobStateStore.listActive();
          sendResponse(reply(message, activeJobs));
          await maybeApplyUpdate();
          return;
        }
        case 'capture.start': {
          const payload = message.payload as { mode?: string };
          if (!payload || typeof payload.mode !== 'string') throw new Error('Capture mode is required.');
          const result = await captureCoordinator.start({ mode: payload.mode as CaptureMode, settings });
          sendResponse(reply(message, result));
          return;
        }
        case 'capture.cancel': {
          const payload = message.payload as { jobId?: string };
          if (!payload || typeof payload.jobId !== 'string') throw new Error('Job id is required.');
          await captureCoordinator.cancel(payload.jobId);
          sendResponse(reply(message, undefined));
          return;
        }
        case 'offscreen.probeLimits': {
          await ensureOffscreen();
          const limits = await new Promise<CanvasLimits>((resolve, reject) => {
            chrome.runtime.sendMessage({ ...message, from: 'sw' }, (response: Reply<'offscreen.probeLimits'>) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              if (!response) {
                reject(new Error('Offscreen document returned no response.'));
                return;
              }
              if (!response.ok) {
                reject(new Error(response.error.message));
                return;
              }
              resolve(response.payload);
            });
          });
          sendResponse(reply(message, limits));
          return;
        }
        case 'capture.ping':
          sendResponse(reply(message, { ready: true, version: '0.1.0' }));
          return;
        default:
          sendResponse({ v: 1, type: message.type, id: message.id, ok: false, error: createError('E_NOT_SUPPORTED', 'Unsupported message: ' + message.type) });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Unknown service worker error';
      log('error', 'message', messageText, sender.tab?.id?.toString());
      sendResponse({ v: 1, type: message.type, id: message.id, ok: false, error: createError('E_UNKNOWN', messageText, true) });
    }
  })().catch((error: unknown) => log('error', 'message', error instanceof Error ? error.message : 'Message handling failed'));
  return true;
});
