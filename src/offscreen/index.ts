import type { CanvasLimits } from '../shared/types/capture';
import type { Msg, Reply } from '../shared/types/messages';

function probeLimits(): CanvasLimits {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const maxSide = 16_384;
  const maxArea = 268_435_456;
  canvas.remove();
  return { maxSide, maxArea, probedAt: new Date().toISOString() };
}

chrome.runtime.onMessage.addListener((raw: Msg, _sender, sendResponse) => {
  if (raw.v !== 1 || raw.type !== 'offscreen.probeLimits' || raw.from !== 'sw') return false;
  const response: Reply<'offscreen.probeLimits'> = { v: 1, type: raw.type, id: raw.id, ok: true, payload: probeLimits() };
  sendResponse(response);
  return true;
});
