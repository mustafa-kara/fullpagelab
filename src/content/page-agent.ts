import type { PageMetrics } from '../shared/types/capture';
import type { MessageMap, Msg, Reply } from '../shared/types/messages';

const VERSION = '1';
const marker = '__ssx_agent_v1';

type AgentWindow = Window & { [marker]?: boolean };
const agentWindow = window as AgentWindow;

function scan(): PageMetrics {
  const root = document.scrollingElement ?? document.documentElement;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const documentSize = { width: root.scrollWidth, height: root.scrollHeight };
  return {
    url: location.href,
    title: document.title,
    origin: location.origin,
    viewport,
    document: documentSize,
    scroll: { x: window.scrollX, y: window.scrollY },
    dpr: window.devicePixelRatio,
    zoom: 1,
    hasHorizontalOverflow: documentSize.width > viewport.width,
    scrollingElement: root === document.documentElement || root === document.body ? 'document' : 'custom',
    scrollContainers: [],
    fixedElements: [],
    iframes: [],
    lazyImages: document.images.length,
    isRestricted: false,
    direction: getComputedStyle(document.documentElement).direction === 'rtl' ? 'rtl' : 'ltr',
    userAgent: navigator.userAgent,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  };
}

function reply<K extends keyof MessageMap>(message: Msg<K>, payload: unknown): Reply<K> {
  return { v: 1, type: message.type, id: message.id, ok: true, payload } as Reply<K>;
}

if (!agentWindow[marker]) {
  agentWindow[marker] = true;
  chrome.runtime.onMessage.addListener((raw: Msg, _sender, sendResponse) => {
    if (raw.v !== 1) return false;
    if (raw.type === 'agent.ping') {
      sendResponse(reply(raw, { ready: true, version: VERSION }));
      return true;
    }
    if (raw.type === 'agent.scan') {
      sendResponse(reply(raw, scan()));
      return true;
    }
    if (raw.type === 'agent.scroll') {
      const point = raw.payload as { x: number; y: number };
      window.scrollTo({ left: point.x, top: point.y, behavior: 'instant' });
      requestAnimationFrame(() => sendResponse(reply(raw, { actual: { x: window.scrollX, y: window.scrollY } })));
      return true;
    }
    return false;
  });
}

export {};
