import type { SmartHideOptions } from '../shared/types/capture';

export type SmartHideCategory = SmartHideOptions['categories'][number];

export interface SmartHideMatch {
  element: HTMLElement;
  selector: string;
  category: SmartHideCategory | 'custom';
  reason: string;
}

const tokenPatterns: Record<SmartHideCategory, RegExp> = {
  cookieBanner: /cookie|consent|gdpr|çerez|kvkk|privacy|onetrust|cookiebot|didomi|usercentrics|osano|iubenda/i,
  modal: /modal|dialog|popup|overlay|backdrop|underlay/i,
  chatWidget: /chat|widget|launcher|messenger|support|intercom|drift|crisp|tidio/i,
  ad: /(^|[-_ ])ad(s|vertisement)?($|[-_ ])/i,
  floatingWidget: /floating|widget|launcher|bubble|assistant/i,
  newsletterPopup: /newsletter|subscribe|subscription|bülten|klaviyo|privy|hellobar|mailchimp/i,
  stickyBar: /cookie|consent|gdpr|çerez|kvkk|subscribe|newsletter|bülten|sticky|announcement|promo/i,
};

const explicitSelectors: Record<SmartHideCategory, string[]> = {
  cookieBanner: [
    '#onetrust-banner-sdk', '#onetrust-consent-sdk', '.onetrust-pc-dark-filter', '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyUnderlay',
    '.qc-cmp2-container', '#didomi-host', '#truste-consent-track', '#consent_blackbar', '#usercentrics-root', '.osano-cm-window',
    '.cky-consent-container', '#cmplz-cookiebanner-container', '.termly-consent', '#iubenda-cs-banner',
  ],
  modal: ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]'],
  chatWidget: ['.intercom-lightweight-app', '#intercom-container', '#drift-widget', '#drift-frame-controller', '.crisp-client', 'iframe[title="chat widget"]', '#hubspot-messages-iframe-container', 'iframe#launcher', '#tidio-chat', '#chat-widget-container', '#fc_frame'],
  ad: ['ins.adsbygoogle', '[id^="google_ads_iframe"]', '[id^="div-gpt-ad"]'],
  floatingWidget: [],
  newsletterPopup: ['.klaviyo-form', '.om-holder', '.mc-modal', '.mc-modal-bg', '#privy-container', '#hellobar-bar'],
  stickyBar: [],
};

function safeText(element: HTMLElement): string {
  return `${element.id} ${element.className} ${element.getAttribute('aria-label') ?? ''} ${element.getAttribute('role') ?? ''} ${(element.textContent ?? '').slice(0, 500)}`;
}

function styleOf(element: HTMLElement): CSSStyleDeclaration | undefined {
  try {
    return getComputedStyle(element);
  } catch {
    return undefined;
  }
}

function isVisible(element: HTMLElement): boolean {
  const style = styleOf(element);
  if (!style) return true;
  return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity || '1') > 0;
}

function isFixedLike(element: HTMLElement): boolean {
  const style = styleOf(element);
  return style?.position === 'fixed' || style?.position === 'sticky' || element.style.position === 'fixed' || element.style.position === 'sticky';
}

function hasDialogRole(element: HTMLElement): boolean {
  return element.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]');
}

function selectorFor(element: HTMLElement): string {
  if (element.id) {
    const escape = globalThis.CSS?.escape ?? ((value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
    return `#${escape(element.id)}`;
  }
  const classes = Array.from(element.classList).filter((name) => /^[a-zA-Z_][\w-]*$/.test(name)).slice(0, 2);
  return `${element.tagName.toLowerCase()}${classes.map((name) => `.${name}`).join('')}`;
}

function categoryMatch(element: HTMLElement, category: SmartHideCategory): boolean {
  if (!isVisible(element)) return false;
  const text = safeText(element);
  const tokenMatch = tokenPatterns[category].test(text);
  const fixedLike = isFixedLike(element);
  if (category === 'modal') return hasDialogRole(element) || (fixedLike && tokenMatch);
  if (category === 'cookieBanner') return tokenMatch && (fixedLike || hasDialogRole(element));
  if (category === 'chatWidget' || category === 'floatingWidget' || category === 'newsletterPopup') return tokenMatch && fixedLike;
  if (category === 'stickyBar') return tokenMatch && fixedLike;
  return tokenMatch && fixedLike;
}

function addMatch(matches: SmartHideMatch[], seen: Set<HTMLElement>, element: HTMLElement, category: SmartHideCategory | 'custom', reason: string): void {
  if (seen.has(element) || !isVisible(element)) return;
  seen.add(element);
  matches.push({ element, category, selector: selectorFor(element), reason });
}

export function findSmartHideMatches(options: SmartHideOptions, root: Document = document): SmartHideMatch[] {
  const matches: SmartHideMatch[] = [];
  const seen = new Set<HTMLElement>();
  for (const selector of options.customSelectors) {
    try {
      for (const element of root.querySelectorAll<HTMLElement>(selector)) addMatch(matches, seen, element, 'custom', 'custom selector');
    } catch {
      // Invalid user selectors are ignored; the capture itself remains usable.
    }
  }
  if (!options.enabled) return matches;

  const elements = Array.from(root.querySelectorAll<HTMLElement>('*'));
  for (const category of options.categories) {
    for (const selector of explicitSelectors[category]) {
      try {
        for (const element of root.querySelectorAll<HTMLElement>(selector)) addMatch(matches, seen, element, category, `rule: ${selector}`);
      } catch {
        // A browser-specific selector rule must not block the capture.
      }
    }
    for (const element of elements) if (categoryMatch(element, category)) addMatch(matches, seen, element, category, 'fixed/sticky heuristic');
  }

  // A cookie backdrop is often a sibling/parent of the dialog. Hide the fixed
  // backdrop too, otherwise its dimming layer still leaks into the first tile.
  const cookieMatches = matches.filter((match) => match.category === 'cookieBanner');
  for (const match of cookieMatches) {
    for (let parent = match.element.parentElement; parent; parent = parent.parentElement) {
      if (!isFixedLike(parent)) continue;
      if (tokenPatterns.cookieBanner.test(safeText(parent)) || /backdrop|underlay|overlay|dark-filter|shade/i.test(safeText(parent))) addMatch(matches, seen, parent, 'cookieBanner', 'cookie backdrop');
    }
  }
  return matches;
}
