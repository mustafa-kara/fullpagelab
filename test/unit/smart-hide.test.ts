// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest';
import { createFixedElementController } from '../../src/content/fixed-elements';
import { findSmartHideMatches } from '../../src/content/smart-hide';
import type { FixedElementInfo } from '../../src/shared/types/capture';

describe('smart hide', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header id="site-nav" style="position: fixed; z-index: 1000">Site navigation</header>
      <div id="cookie-backdrop" style="position: fixed; z-index: 2000">
        <section id="cookie-dialog" role="dialog" aria-modal="true"><h2>Çerez Kullanımı</h2><p>Gizlilik tercihlerinizi seçin.</p></section>
      </div>`;
  });

  it('matches a cookie modal and its backdrop while preserving the site navigation', () => {
    const matches = findSmartHideMatches({ enabled: true, categories: ['cookieBanner'], customSelectors: [], mode: 'hide' });

    expect(matches.some((match) => match.element.id === 'cookie-dialog')).toBe(true);
    expect(matches.some((match) => match.element.id === 'cookie-backdrop')).toBe(true);
    expect(matches.some((match) => match.element.id === 'site-nav')).toBe(false);
  });

  it('hides a cookie-like fixed layer from the first tile even when smart hide is off', async () => {
    document.body.innerHTML = '<div id="overlay" style="position: fixed; z-index: 2000"><div>Çerez Kullanımı</div></div>';
    const info: FixedElementInfo = {
      selector: '#overlay', rect: { x: 0, y: 0, width: 800, height: 600 }, clientSize: { width: 800, height: 600 }, scrollSize: { width: 800, height: 600 },
      isScrollable: false, overflow: { x: 'hidden', y: 'hidden' }, tag: 'div', id: 'overlay', classes: [], frameId: 0, depth: 1,
      position: 'fixed', anchor: 'full', coversViewportPct: 100, zIndex: 2000, isTransparentOverlay: false,
    };
    const controller = createFixedElementController([info], 'hideAfterFirst');
    controller.setTile(0, 3);
    expect(document.querySelector<HTMLElement>('#overlay')?.style.visibility).toBe('hidden');
    await controller.restore();
    expect(document.querySelector<HTMLElement>('#overlay')?.style.visibility).toBe('');
  });
});
