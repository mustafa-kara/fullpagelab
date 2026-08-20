export type Id = string;
export type IsoDate = string;
export type Url = string;
export type Sha256Hex = string;
export type Millis = number;
export type CssPx = number;
export type DevicePx = number;
export type Pt = number;
export type IntegrationProvider = 'jira' | 'linear' | 'slack' | 'notion' | 'trello' | 'github' | 'webhook' | 'gdrive' | 'dropbox' | 'onedrive';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlobRef {
  store: 'idb' | 'opfs' | 'session';
  key: string;
  mime: string;
  bytes: number;
  size?: Size;
}

export type ErrorCode =
  | 'E_RESTRICTED_PAGE'
  | 'E_PERMISSION_DENIED'
  | 'E_RATE_LIMIT'
  | 'E_TAB_NOT_ACTIVE'
  | 'E_TAB_CLOSED'
  | 'E_WINDOW_NOT_VISIBLE'
  | 'E_AGENT_INJECT'
  | 'E_AGENT_DISCONNECTED'
  | 'E_TIMEOUT'
  | 'E_CANVAS_LIMIT'
  | 'E_MEMORY'
  | 'E_DEBUGGER_ATTACH'
  | 'E_DEBUGGER_DETACHED'
  | 'E_SW_RESTART'
  | 'E_STORAGE_QUOTA'
  | 'E_EXPORT'
  | 'E_ENCODE'
  | 'E_PDF'
  | 'E_DOWNLOAD'
  | 'E_CLIPBOARD'
  | 'E_NETWORK'
  | 'E_AUTH'
  | 'E_INTEGRATION'
  | 'E_SELECTOR_NOT_FOUND'
  | 'E_ELEMENT_TOO_LARGE'
  | 'E_CANCELLED'
  | 'E_PROTOCOL'
  | 'E_VALIDATION'
  | 'E_NOT_SUPPORTED'
  | 'E_UNKNOWN';

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
  userMessageKey: string;
  details?: Record<string, unknown>;
  recoverable: boolean;
  at: IsoDate;
}

export type FeatureKey =
  | 'allTabs'
  | 'batch'
  | 'iframeInject'
  | 'integrations'
  | 'monitoring'
  | 'nativeApi'
  | 'incognitoBatch'
  | 'fileUrls'
  | 'notifications'
  | 'bugReportNetwork'
  | 'tsa'
  | 'webhook';

export interface PermissionStatus {
  feature: FeatureKey;
  granted: boolean;
  missing: { permissions: string[]; origins: string[] };
  rationaleKey: string;
}
