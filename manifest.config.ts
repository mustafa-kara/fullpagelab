import type { ManifestV3Export } from '@crxjs/vite-plugin';

type ManifestWithOptionalHosts = Extract<ManifestV3Export, object> & { optional_host_permissions: string[] };

const variant = process.env.BUILD_VARIANT === 'cdp' ? 'cdp' : 'store';

const manifest = {
  manifest_version: 3,
  name: '__MSG_appName__',
  description: '__MSG_appDesc__',
  version: '0.1.0.0',
  version_name: `0.1.0 (${variant})`,
  default_locale: 'en',
  minimum_chrome_version: '120',
  permissions: [
    'activeTab',
    'scripting',
    'storage',
    'unlimitedStorage',
    'downloads',
    'offscreen',
    'contextMenus',
    'alarms',
    'sidePanel',
    ...(variant === 'cdp' ? ['debugger'] : []),
  ],
  optional_permissions: [
    'tabs',
    'clipboardWrite',
    'notifications',
    'webRequest',
    'identity',
    'webNavigation',
    'nativeMessaging',
  ],
  optional_host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  icons: {
    16: 'icons/fullpagelabicon.png',
    32: 'icons/fullpagelabicon.png',
    48: 'icons/fullpagelabicon.png',
    128: 'icons/fullpagelabicon.png',
  },
  action: {
    default_popup: 'src/pages/popup/index.html',
    default_icon: {
      16: 'icons/fullpagelabicon.png',
      32: 'icons/fullpagelabicon.png',
      48: 'icons/fullpagelabicon.png',
      128: 'icons/fullpagelabicon.png',
    },
  },
  side_panel: {
    default_path: 'src/pages/sidepanel/index.html',
  },
  commands: {
    'capture-full-page': {
      suggested_key: { default: 'Alt+Shift+P' },
      description: '__MSG_cmdFullPage__',
    },
    'capture-visible': {
      suggested_key: { default: 'Alt+Shift+V' },
      description: '__MSG_cmdVisible__',
    },
    'capture-selection': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: '__MSG_cmdSelection__',
    },
    'capture-element': {
      description: '__MSG_cmdElement__',
    },
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
  },
  web_accessible_resources: [
    {
      resources: ['assets/fonts/*', 'assets/picker/*'],
      matches: ['<all_urls>'],
      use_dynamic_url: true,
    },
  ],
  incognito: 'spanning',
};

export default manifest as ManifestWithOptionalHosts;
