import type { CapturePlatform, CaptureTab } from '../coordinator';
import { createCaptureRateLimiter, type CaptureRateLimiterOptions } from '../rate-limiter';
import { ensureActiveCaptureTab, mapCaptureVisibleTabError } from '../validation';

export interface VisibleTabBackendOptions {
  platform: Pick<CapturePlatform, 'captureVisibleTab' | 'queryActiveTab' | 'focusTab'>;
  rateLimiter?: Pick<ReturnType<typeof createCaptureRateLimiter>, 'run'>;
  rateLimiterOptions?: CaptureRateLimiterOptions;
}

export class VisibleTabBackend {
  private readonly platform: VisibleTabBackendOptions['platform'];
  private readonly rateLimiter: Pick<ReturnType<typeof createCaptureRateLimiter>, 'run'>;

  constructor({ platform, rateLimiter, rateLimiterOptions }: VisibleTabBackendOptions) {
    this.platform = platform;
    this.rateLimiter = rateLimiter ?? createCaptureRateLimiter(rateLimiterOptions);
  }

  async capture(expected: Pick<CaptureTab, 'id' | 'windowId'>, requiresPageAgent = false): Promise<string> {
    const active = await ensureActiveCaptureTab(this.platform, expected, requiresPageAgent);
    try {
      return await this.rateLimiter.run(active.windowId, () => this.platform.captureVisibleTab(active.windowId));
    } catch (error) {
      throw mapCaptureVisibleTabError(error);
    }
  }
}
