import type { Settings } from './types/settings';

export const defaultSettings: Settings = {
  schemaVersion: 1,
  general: { language: 'auto', theme: 'system', afterCapture: 'openResultTab', showNotifications: true, playSound: false, resultTabBehavior: 'newTab', onboardingDone: false },
  capture: {
    backend: 'auto', delayMs: 0, countdownOverlay: true, hideFixedElements: 'auto', hideScrollbars: true, freezeAnimations: true, pauseMedia: true,
    smartHide: { enabled: false, categories: ['cookieBanner', 'chatWidget', 'newsletterPopup', 'stickyBar'], customSelectors: [], mode: 'hide' },
    smartHideOverrides: {},
    lazyLoad: { enabled: true, preScroll: true, preScrollStepCss: 900, preScrollDwellMs: 100, forceEagerImages: true, waitImagesDecode: true, waitFonts: true, maxWaitMs: 1500 },
    wait: {}, iframes: 'injectSameOrigin', dprMode: 'device', zoomHandling: 'normalizeTo100',
    limits: { maxCaptureHeightCss: 50_000, maxTiles: 200, maxDurationMs: 180_000, stepSettleMs: 150, tileFormat: 'png', maxOutputPixels: 268_435_456, maxStripHeightPx: 16_384, memoryBudgetMb: 600 },
    captureCursor: false, background: 'page', includeMetadata: false, captureHorizontalOverflow: true,
  },
  export: {
    targets: ['history', 'openResult'], format: 'png', image: { jpegQuality: 0.92, webpQuality: 0.9, pngCompression: 'default', stripAlpha: false },
    filename: '{domain}_{yyyy-mm-dd}_{time}', download: { auto: false, saveAs: false, subfolder: '', conflictAction: 'uniquify' },
    multiImage: 'zip', metadata: { enabled: false, fields: [] },
  },
  history: { enabled: true, maxItems: 1000, maxBytes: 2_000_000_000, autoCleanup: 'oldest', keepOriginalsAfterEdit: true, thumbnailWidth: 320, ocrAutoIndex: false, recaptureCloseWindow: true },
  shortcuts: {}, privacy: { telemetry: false, crashReports: false, embedMetadataDefault: false, clearOnUninstallNotice: true, storeIncognitoCaptures: false },
  integrations: {}, api: { enabled: false, allowedExtensionIds: [], approvedOrigins: [] },
  editor: { toolDefaults: {}, recentColors: [], autosaveMs: 2000 }, presets: {},
  advanced: { debugLogging: false, experimental: { cdpBackend: false, avif: false, promptApiOcr: false } },
};
