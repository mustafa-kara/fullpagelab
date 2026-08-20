import type { JobPhase } from '../shared/types/capture';
import { waitForVisualSettle } from './visual-settle';

export interface ProgressOverlayOptions {
  allowCancel?: boolean;
  onCancel?: () => void;
}

export interface ProgressOverlayState {
  phase: JobPhase;
  done: number;
  total: number;
  message?: string;
}

export class ProgressOverlay {
  private host: HTMLDivElement | undefined;
  private shadow: ShadowRoot | undefined;
  private status: HTMLDivElement | undefined;
  private progress: HTMLProgressElement | undefined;
  private badge: HTMLSpanElement | undefined;
  private cancelButton: HTMLButtonElement | undefined;
  private keyHandler: ((event: KeyboardEvent) => void) | undefined;

  constructor(private readonly options: ProgressOverlayOptions = {}) {}

  mount(): void {
    if (this.host) return;
    const host = document.createElement('div');
    host.id = 'fullpagelab-progress-overlay';
    host.style.cssText = 'all: initial; position: fixed; inset: 16px 16px auto auto; z-index: 2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<style>:host{font:13px system-ui;color:#172033}.card{background:#fff;border:1px solid #d7deeb;border-radius:12px;box-shadow:0 8px 32px #1720332b;padding:12px;min-width:220px}.row{display:flex;gap:8px;align-items:center}.status{margin-bottom:8px}.badge{float:right;font-weight:700}.cancel{margin-top:8px;border:1px solid #b8c2d5;background:#fff;border-radius:6px;padding:4px 8px;cursor:pointer}</style><div class="card" role="status" aria-live="polite"><div class="status"></div><span class="badge">0%</span><progress max="1" value="0"></progress><div><button class="cancel" type="button">Cancel</button></div></div>';
    this.host = host;
    this.shadow = shadow;
    this.status = shadow.querySelector<HTMLDivElement>('.status') ?? undefined;
    this.progress = shadow.querySelector<HTMLProgressElement>('progress') ?? undefined;
    this.badge = shadow.querySelector<HTMLSpanElement>('.badge') ?? undefined;
    this.cancelButton = shadow.querySelector<HTMLButtonElement>('.cancel') ?? undefined;
    if (this.options.allowCancel === false) this.cancelButton?.remove();
    this.cancelButton?.addEventListener('click', () => this.options.onCancel?.());
    this.keyHandler = (event) => {
      if (event.key === 'Escape') this.options.onCancel?.();
    };
    document.addEventListener('keydown', this.keyHandler);
    document.documentElement.append(host);
  }

  update(state: ProgressOverlayState): void {
    this.mount();
    const total = Math.max(1, state.total);
    const done = Math.min(total, Math.max(0, state.done));
    if (this.status) this.status.textContent = state.message ?? `${state.phase} (${done}/${total})`;
    if (this.progress) {
      this.progress.max = total;
      this.progress.value = done;
    }
    if (this.badge) this.badge.textContent = `${Math.round((done / total) * 100)}%`;
  }

  hideForCapture(): () => void {
    if (!this.host) return () => undefined;
    const previous = this.host.style.visibility;
    this.host.style.visibility = 'hidden';
    return () => {
      if (this.host) this.host.style.visibility = previous;
    };
  }

  async setVisible(visible: boolean): Promise<void> {
    this.mount();
    if (this.host) this.host.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible) await waitForVisualSettle();
  }

  remove(): void {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.host?.remove();
    this.host = undefined;
    this.shadow = undefined;
    this.status = undefined;
    this.progress = undefined;
    this.badge = undefined;
    this.cancelButton = undefined;
    this.keyHandler = undefined;
  }
}
