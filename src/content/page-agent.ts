import { createMessage } from '../shared/messages';
import type { PageMetrics } from '../shared/types/capture';
import type { MessageMap, Msg, Reply } from '../shared/types/messages';
import { preparePage, type PagePreparation } from './preparer';
import { ProgressOverlay } from './progress-overlay';
import { scanPage } from './scanner';
import { scrollPage } from './scroller';

const VERSION = '1';
const marker = '__ssx_agent_v1';

type AgentWindow = Window & { [marker]?: boolean };
const agentWindow = window as AgentWindow;

function reply<K extends keyof MessageMap>(message: Msg<K>, payload: unknown): Reply<K> {
  return { v: 1, type: message.type, id: message.id, ok: true, payload } as Reply<K>;
}

if (!agentWindow[marker]) {
  agentWindow[marker] = true;
  let preparation: PagePreparation | undefined;
  let progressOverlay: ProgressOverlay | undefined;
  chrome.runtime.onMessage.addListener((raw: Msg, _sender, sendResponse) => {
    if (raw.v !== 1) return false;
    if (raw.type === 'agent.ping') {
      sendResponse(reply(raw, { ready: true, version: VERSION }));
      return true;
    }
    if (raw.type === 'agent.scan') {
      sendResponse(reply(raw, scanPage(raw.payload as Parameters<typeof scanPage>[0])));
      return true;
    }
    if (raw.type === 'agent.prepare') {
      void (async () => {
        await preparation?.restore();
        const payload = raw.payload as { plan: Parameters<typeof preparePage>[0]; metrics: Parameters<typeof preparePage>[1] };
        preparation = await preparePage(payload.plan, payload.metrics);
        sendResponse(reply(raw, preparation.state));
      })().catch((error: unknown) => sendResponse({ v: 1, type: raw.type, id: raw.id, ok: false, error: { code: 'E_AGENT_INJECT', message: error instanceof Error ? error.message : 'Page preparation failed.', userMessageKey: 'error.E_AGENT_INJECT.body', recoverable: true, at: new Date().toISOString() } }));
      return true;
    }
    if (raw.type === 'agent.scroll') {
      const payload = raw.payload as { point?: { x: number; y: number }; stepIndex?: number; totalSteps?: number; settleMs?: number };
      const point = payload.point ?? (raw.payload as unknown as { x: number; y: number });
      preparation?.fixed.setTile(payload.stepIndex ?? 0, payload.totalSteps ?? 1);
      void scrollPage({ stepIndex: payload.stepIndex ?? 0, x: point.x, y: point.y, afterFirstTile: (payload.stepIndex ?? 0) > 0, settleMs: payload.settleMs ?? 0 }, preparation?.state.scrollRoot ?? 'document')
        .then((result) => sendResponse(reply(raw, result)))
        .catch((error: unknown) => sendResponse({ v: 1, type: raw.type, id: raw.id, ok: false, error: { code: 'E_AGENT_DISCONNECTED', message: error instanceof Error ? error.message : 'Page scroll failed.', userMessageKey: 'error.E_AGENT_DISCONNECTED.body', recoverable: true, at: new Date().toISOString() } }));
      return true;
    }
    if (raw.type === 'agent.restore') {
      void (async () => {
        await preparation?.restore();
        preparation = undefined;
        progressOverlay?.remove();
        progressOverlay = undefined;
        sendResponse(reply(raw, { restored: true }));
      })().catch((error: unknown) => sendResponse({ v: 1, type: raw.type, id: raw.id, ok: false, error: { code: 'E_AGENT_DISCONNECTED', message: error instanceof Error ? error.message : 'Page restore failed.', userMessageKey: 'error.E_AGENT_DISCONNECTED.body', recoverable: true, at: new Date().toISOString() } }));
      return true;
    }
    if (raw.type === 'agent.progress') {
      const progress = raw.payload as MessageMap['agent.progress']['req'];
      if (!progressOverlay) {
        progressOverlay = new ProgressOverlay({
          allowCancel: progress.allowCancel,
          onCancel: () => { void chrome.runtime.sendMessage(createMessage('capture.cancel', { jobId: progress.jobId }, 'cs')); },
        });
      }
      progressOverlay.update(progress);
      void progressOverlay.setVisible(progress.visible !== false)
        .then(() => sendResponse(reply(raw, undefined)))
        .catch(() => sendResponse(reply(raw, undefined)));
      return true;
    }
    return false;
  });
  window.addEventListener('pagehide', () => { void preparation?.restore(); });
}

export {};
