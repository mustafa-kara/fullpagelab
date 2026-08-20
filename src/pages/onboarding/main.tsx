import { render } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { defaultSettings } from '../../shared/defaults';
import { t } from '../../shared/i18n';
import { sendMessage } from '../../shared/messages';
import type { Settings } from '../../shared/types/settings';
import '../../ui/tokens.css';
import './onboarding.css';

type StepIndex = 0 | 1 | 2;
type IconName = 'arrow-left' | 'arrow-right' | 'browser' | 'check' | 'cloud-off' | 'command' | 'lock' | 'pin' | 'scan' | 'shield' | 'sparkle' | 'storage';

const steps = [
  { number: '01', label: 'onboarding.step.welcome', meta: 'onboarding.step.welcomeMeta' },
  { number: '02', label: 'onboarding.step.privacy', meta: 'onboarding.step.privacyMeta' },
  { number: '03', label: 'onboarding.step.try', meta: 'onboarding.step.tryMeta' },
] as const;

function Icon({ name, size = 20 }: { name: IconName; size?: number }): JSX.Element {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'arrow-left': return <svg {...common}><path d="m15 18-6-6 6-6" /><path d="M9 12h10" /></svg>;
    case 'arrow-right': return <svg {...common}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>;
    case 'browser': return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8h18" /><path d="M7 6h.01M10 6h.01M13 6h.01" /></svg>;
    case 'check': return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case 'cloud-off': return <svg {...common}><path d="m2 2 20 20" /><path d="M7.5 7.5A6 6 0 0 1 18 10a4 4 0 0 1 .5 7.97" /><path d="M5.5 17.97A4 4 0 0 1 6 10.03" /><path d="M3 18h1" /><path d="M16 18h3" /></svg>;
    case 'command': return <svg {...common}><path d="M18 2a4 4 0 1 0 0 8H6a4 4 0 1 0 0 8 4 4 0 0 0 0-8h12a4 4 0 1 0 0-8Z" /><path d="M6 10V6a4 4 0 1 0-4 0v12a4 4 0 1 0 4-4V6" /></svg>;
    case 'lock': return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></svg>;
    case 'pin': return <svg {...common}><path d="m15 4 5 5-3 1-3 4 1 3-1 1-4-4-4 1-1-1 4-4 1-3Z" /><path d="m5 19 5-5" /></svg>;
    case 'scan': return <svg {...common}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M7 12h10" /></svg>;
    case 'shield': return <svg {...common}><path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></svg>;
    case 'sparkle': return <svg {...common}><path d="m12 3-1.2 5.8L5 10l5.8 1.2L12 17l1.2-5.8L19 10l-5.8-1.2Z" /><path d="m19 16-.6 2.4L16 19l2.4.6L19 22l.6-2.4L22 19l-2.4-.6Z" /></svg>;
    case 'storage': return <svg {...common}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /><path d="M8 8h.01M8 15h.01" /></svg>;
  }
}

function extensionVersion(): string {
  try {
    const manifest = chrome.runtime.getManifest() as { version_name?: string; version?: string };
    return manifest.version_name ?? manifest.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function isTurkish(settings: Settings): boolean {
  if (settings.general.language === 'tr') return true;
  if (settings.general.language === 'en') return false;
  try {
    return chrome.i18n.getUILanguage().toLowerCase().startsWith('tr');
  } catch {
    return false;
  }
}

function StepRail({ activeStep }: { activeStep: StepIndex }): JSX.Element {
  return <ol class="onboarding-steps" aria-label={t('onboarding.progress')}>
    {steps.map((step, index) => {
      const state = index < activeStep ? 'complete' : index === activeStep ? 'active' : 'upcoming';
      return <li class={`onboarding-step onboarding-step-${state}`} key={step.number} data-testid={`onboarding-step-${index}`}>
        <span class="step-number">{state === 'complete' ? <Icon name="check" size={16} /> : step.number}</span>
        <span class="step-copy"><strong>{t(step.label)}</strong><small>{t(step.meta)}</small></span>
      </li>;
    })}
  </ol>;
}

function CapturePreview(): JSX.Element {
  return <div class="capture-preview" aria-label={t('onboarding.preview.label')}>
    <div class="preview-glow" />
    <div class="preview-window">
      <div class="preview-toolbar"><span class="window-dots"><i /><i /><i /></span><span class="preview-url">example.com / documentation</span><span class="preview-menu">•••</span></div>
      <div class="preview-content">
        <div class="preview-sidebar"><span /><span /><span /><span /><span /><span /></div>
        <div class="preview-article"><div class="preview-kicker" /><div class="preview-title" /><div class="preview-line preview-line-wide" /><div class="preview-line" /><div class="preview-line" /><div class="preview-chart"><span /><span /><span /><span /><span /></div><div class="preview-line preview-line-wide" /><div class="preview-line" /></div>
      </div>
      <div class="preview-scan-line" />
      <div class="preview-chip"><span class="chip-icon"><Icon name="scan" size={15} /></span><span><strong>{t('onboarding.preview.mode')}</strong><small>{t('onboarding.preview.ready')}</small></span><span class="chip-check"><Icon name="check" size={14} /></span></div>
    </div>
    <div class="preview-float preview-float-top"><Icon name="sparkle" size={15} /> {t('onboarding.preview.badge')}</div>
    <div class="preview-float preview-float-bottom"><span class="mini-avatar">F</span><span>{t('onboarding.preview.local')}</span><Icon name="lock" size={14} /></div>
  </div>;
}

function FeatureCard({ icon, title, body }: { icon: IconName; title: string; body: string }): JSX.Element {
  return <article class="feature-card"><span class="feature-icon"><Icon name={icon} size={19} /></span><div><h3>{title}</h3><p>{body}</p></div></article>;
}

function WelcomeStep(): JSX.Element {
  return <div class="step-panel" data-testid="onboarding-welcome">
    <div class="step-heading"><span class="eyebrow">{t('onboarding.welcome.eyebrow')}</span><h2>{t('onboarding.welcome.title')}</h2><p>{t('onboarding.welcome.body')}</p></div>
    <CapturePreview />
    <div class="feature-grid">
      <FeatureCard icon="scan" title={t('onboarding.feature.fullPage.title')} body={t('onboarding.feature.fullPage.body')} />
      <FeatureCard icon="sparkle" title={t('onboarding.feature.smart.title')} body={t('onboarding.feature.smart.body')} />
      <FeatureCard icon="lock" title={t('onboarding.feature.private.title')} body={t('onboarding.feature.private.body')} />
    </div>
    <ShortcutCard />
    <PinCard />
  </div>;
}

function ShortcutCard(): JSX.Element {
  return <div class="shortcut-card"><div class="shortcut-icon"><Icon name="command" size={21} /></div><div class="shortcut-copy"><span class="eyebrow">{t('onboarding.shortcut.eyebrow')}</span><h3>{t('onboarding.shortcut.title')}</h3><p>{t('onboarding.shortcut.body')}</p></div><kbd>Alt</kbd><span class="key-plus">+</span><kbd>Shift</kbd><span class="key-plus">+</span><kbd>P</kbd></div>;
}

function PinCard(): JSX.Element {
  return <div class="pin-card"><span class="pin-icon"><Icon name="pin" size={19} /></span><div><strong>{t('onboarding.pin.title')}</strong><p>{t('onboarding.pin.body')}</p></div><span class="pin-arrow" aria-hidden="true"><Icon name="arrow-right" size={17} /></span></div>;
}

function PrivacyStep({ telemetry, onTelemetryChange, storageState, onPersist }: { telemetry: boolean; onTelemetryChange: (value: boolean) => void; storageState: 'idle' | 'busy' | 'granted' | 'declined'; onPersist: () => void }): JSX.Element {
  const storageMessage = storageState === 'granted' ? t('onboarding.privacy.storageGranted') : storageState === 'declined' ? t('onboarding.privacy.storageDeclined') : '';
  return <div class="step-panel" data-testid="onboarding-privacy">
    <div class="step-heading"><span class="eyebrow">{t('onboarding.privacy.eyebrow')}</span><h2>{t('onboarding.privacy.title')}</h2><p>{t('privacy_tagline')}</p></div>
    <div class="privacy-hero"><span class="privacy-shield"><Icon name="shield" size={28} /></span><div><strong>{t('onboarding.privacy.heroTitle')}</strong><span>{t('onboarding.privacy.heroBody')}</span></div><span class="privacy-check"><Icon name="check" size={16} /></span></div>
    <div class="privacy-points">
      <div class="privacy-point"><span class="point-icon"><Icon name="storage" size={18} /></span><div><strong>{t('onboarding.privacy.localTitle')}</strong><p>{t('onboarding.privacy.localBody')}</p></div></div>
      <div class="privacy-point"><span class="point-icon"><Icon name="cloud-off" size={18} /></span><div><strong>{t('onboarding.privacy.permissionTitle')}</strong><p>{t('onboarding.privacy.permissionBody')}</p></div></div>
    </div>
    <div class="privacy-controls">
      <div class="storage-card"><div class="control-copy"><span class="control-icon"><Icon name="storage" size={18} /></span><div><strong>{t('onboarding.privacy.storageTitle')}</strong><p>{t('onboarding.privacy.storageBody')}</p>{storageMessage && <small class={storageState === 'granted' ? 'control-success' : 'control-muted'}>{storageMessage}</small>}</div></div><button class="button button-secondary button-small" type="button" data-testid="onboarding-persist" onClick={onPersist} disabled={storageState === 'busy' || storageState === 'granted'}>{storageState === 'busy' ? t('onboarding.privacy.storageBusy') : storageState === 'granted' ? t('onboarding.privacy.storageEnabled') : t('onboarding.privacy.storageAction')}</button></div>
      <label class="toggle-card"><span class="control-copy"><span class="control-icon"><Icon name="sparkle" size={18} /></span><span><strong>{t('onboarding.privacy.telemetryTitle')}</strong><small>{t('onboarding.privacy.telemetryBody')}</small></span></span><input data-testid="onboarding-telemetry" type="checkbox" checked={telemetry} onChange={(event) => onTelemetryChange((event.currentTarget as HTMLInputElement).checked)} /><span class="toggle-track" aria-hidden="true"><span /></span></label>
    </div>
  </div>;
}

function TryStep({ captureState, error, onCapture }: { captureState: 'idle' | 'busy' | 'started'; error: string; onCapture: () => void }): JSX.Element {
  return <div class="step-panel" data-testid="onboarding-try">
    <div class="step-heading"><span class="eyebrow">{t('onboarding.try.eyebrow')}</span><h2>{t('onboarding.try.title')}</h2><p>{t('onboarding.try.body')}</p></div>
    {captureState === 'started' ? <div class="success-panel" role="status"><span class="success-icon"><Icon name="check" size={26} /></span><h3>{t('onboarding.try.startedTitle')}</h3><p>{t('onboarding.try.startedBody')}</p></div> : <>
      <div class="try-card"><div class="try-card-window"><div class="try-window-top"><span class="window-dots"><i /><i /><i /></span><span>{t('onboarding.try.previewLabel')}</span></div><div class="try-window-body"><div class="try-page-title" /><div class="try-page-line" /><div class="try-page-line short" /><div class="try-page-blocks"><span /><span /><span /></div><div class="try-page-line" /><div class="try-page-line short" /></div><div class="try-cursor"><Icon name="scan" size={17} /></div></div><div class="try-card-copy"><span class="eyebrow">{t('onboarding.try.cardEyebrow')}</span><strong>{t('onboarding.try.cardTitle')}</strong><span>{t('onboarding.try.cardBody')}</span></div></div>
      {error && <p class="inline-error" role="alert">{error}</p>}
      <button class="button button-primary try-button" type="button" data-testid="onboarding-capture" onClick={onCapture} disabled={captureState === 'busy'}><Icon name="scan" size={18} />{captureState === 'busy' ? t('common_working') : t('onboarding.try.capture')}</button>
    </>}
  </div>;
}

function CompleteStep(): JSX.Element {
  return <div class="step-panel complete-panel" data-testid="onboarding-complete"><span class="complete-mark"><Icon name="check" size={30} /></span><span class="eyebrow">{t('onboarding.complete.eyebrow')}</span><h2>{t('onboarding.complete.title')}</h2><p>{t('onboarding.complete.body')}</p><div class="complete-pills"><span><Icon name="scan" size={15} />{t('onboarding.complete.pillCapture')}</span><span><Icon name="lock" size={15} />{t('onboarding.complete.pillPrivate')}</span><span><Icon name="storage" size={15} />{t('onboarding.complete.pillHistory')}</span></div></div>;
}

function Onboarding(): JSX.Element {
  const [settings, setSettings] = useState<Settings>(structuredClone(defaultSettings));
  const [step, setStep] = useState<StepIndex>(0);
  const [completed, setCompleted] = useState(false);
  const [storageState, setStorageState] = useState<'idle' | 'busy' | 'granted' | 'declined'>('idle');
  const [captureState, setCaptureState] = useState<'idle' | 'busy' | 'started'>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    void sendMessage('settings.get', undefined).then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = isTurkish(settings) ? 'tr' : 'en';
  }, [settings.general.language]);

  const updateTelemetry = async (value: boolean): Promise<void> => {
    setSettings((current) => ({ ...current, privacy: { ...current.privacy, telemetry: value } }));
    try {
      const next = await sendMessage('settings.set', { patch: { privacy: { telemetry: value } } });
      setSettings(next);
    } catch (cause: unknown) {
      setSettings((current) => ({ ...current, privacy: { ...current.privacy, telemetry: !value } }));
      setError(cause instanceof Error ? cause.message : t('error_E_UNKNOWN_body'));
    }
  };

  const persistStorage = async (): Promise<void> => {
    setStorageState('busy');
    try {
      const persisted = await navigator.storage?.persist?.();
      setStorageState(persisted ? 'granted' : 'declined');
    } catch {
      setStorageState('declined');
    }
  };

  const markOnboardingDone = async (): Promise<boolean> => {
    try {
      const next = await sendMessage('settings.set', { patch: { general: { onboardingDone: true } } });
      setSettings(next);
      return true;
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('error_E_UNKNOWN_body'));
      return false;
    }
  };

  const skip = async (): Promise<void> => {
    if (await markOnboardingDone()) setCompleted(true);
  };

  const captureThisPage = async (): Promise<void> => {
    setError('');
    setCaptureState('busy');
    if (!(await markOnboardingDone())) {
      setCaptureState('idle');
      return;
    }
    try {
      await sendMessage('capture.start', { mode: 'fullPage' });
      setCaptureState('started');
    } catch (cause: unknown) {
      setCaptureState('idle');
      setError(cause instanceof Error ? cause.message : t('error_E_UNKNOWN_body'));
    }
  };

  const next = (): void => {
    setError('');
    if (step < 2) setStep((current) => (current + 1) as StepIndex);
    else void captureThisPage();
  };

  const back = (): void => {
    setError('');
    if (step > 0) setStep((current) => (current - 1) as StepIndex);
  };

  if (completed) return <main class="onboarding-page"><div class="ambient ambient-one" /><div class="ambient ambient-two" /><header class="onboarding-topbar"><a class="brand-lockup" href="#top" aria-label="FullPageLab"><span class="brand-icon"><span>F</span></span><span>FullPageLab</span></a><span class="version-label">{extensionVersion()}</span></header><div class="complete-wrap"><CompleteStep /></div></main>;

  const activeStep = steps[step];
  return <main class="onboarding-page" id="top">
    <div class="ambient ambient-one" /><div class="ambient ambient-two" />
    <header class="onboarding-topbar"><a class="brand-lockup" href="#top" aria-label="FullPageLab"><span class="brand-icon"><span>F</span></span><span>FullPageLab</span></a><div class="topbar-actions"><span class="version-label">{extensionVersion()}</span><button class="skip-button" type="button" data-testid="onboarding-skip" onClick={() => void skip()}>{t('onboarding.skip')}<Icon name="arrow-right" size={15} /></button></div></header>
    <div class="onboarding-layout">
      <aside class="onboarding-rail"><div class="rail-copy"><span class="eyebrow">{t('onboarding.rail.eyebrow')}</span><h1>{t('onboarding.rail.title')}</h1><p>{t('onboarding.rail.body')}</p></div><StepRail activeStep={step} /><div class="rail-trust"><span class="trust-icon"><Icon name="shield" size={17} /></span><div><strong>{t('onboarding.rail.trustTitle')}</strong><span>{t('onboarding.rail.trustBody')}</span></div></div></aside>
      <section class="onboarding-content" aria-live="polite"><div class="content-progress"><span>{t('onboarding.progressLabel')} <strong>{activeStep.number}</strong> / 03</span><div class="progress-track"><span style={{ width: `${((step + 1) / 3) * 100}%` }} /></div></div>{step === 0 && <WelcomeStep />}{step === 1 && <PrivacyStep telemetry={settings.privacy.telemetry} onTelemetryChange={(value) => void updateTelemetry(value)} storageState={storageState} onPersist={() => void persistStorage()} />}{step === 2 && <TryStep captureState={captureState} error={error} onCapture={() => void captureThisPage()} />}{error && step !== 2 && <p class="inline-error" role="alert">{error}</p>}<div class="onboarding-actions">{step > 0 ? <button class="button button-quiet action-back" type="button" onClick={back}><Icon name="arrow-left" size={17} />{t('onboarding.back')}</button> : <span class="action-spacer" />}{step < 2 ? <button class="button button-primary action-next" type="button" data-testid="onboarding-next" onClick={next}>{t('onboarding.continue')}<Icon name="arrow-right" size={17} /></button> : captureState !== 'started' ? <button class="button button-primary action-next" type="button" data-testid="onboarding-next" onClick={next} disabled={captureState === 'busy'}>{captureState === 'busy' ? t('common_working') : t('onboarding.try.capture')}<Icon name="arrow-right" size={17} /></button> : <span class="action-spacer" />}</div><p class="onboarding-footer"><Icon name="lock" size={14} />{t('onboarding.footer')}</p></section>
    </div>
  </main>;
}

if (document.getElementById('app')) render(<Onboarding />, document.getElementById('app')!);

export { Onboarding, ShortcutCard };
