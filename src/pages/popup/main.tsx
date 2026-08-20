import { render } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../../ui/tokens.css';
import { t } from '../../shared/i18n';
import { sendMessage } from '../../shared/messages';
import type { JobState } from '../../shared/types/capture';
import type { Settings } from '../../shared/types/settings';

const modes = [
  ['fullPage', 'Full page'],
  ['visible', 'Visible area'],
  ['selection', 'Selection'],
  ['element', 'Element'],
  ['scrollContainer', 'Scrolling area'],
  ['allTabs', 'All tabs'],
] as const;

function Popup(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([sendMessage('settings.get', undefined), sendMessage('capture.listActive', undefined)]).then(([nextSettings, activeJobs]) => {
      setSettings(nextSettings);
      setJobs(activeJobs);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Unable to load extension state'));
  }, []);

  const startCapture = async (mode: typeof modes[number][0]): Promise<void> => {
    if (!settings) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await sendMessage('capture.start', {
        mode,
        target: {},
        options: structuredClone(settings.capture),
        export: structuredClone(settings.export),
        trigger: 'popup',
      });
      setJobs((current) => current.filter((job) => job.jobId !== result.jobId));
      window.close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Capture failed.');
    } finally {
      setBusy(false);
    }
  };

  return <div class="page">
    <header class="header"><strong>FullPageLab</strong><span class="muted">{settings?.general.language === 'tr' ? 'Yakalama' : 'Capture'}</span></header>
    {busy && <div class="card" role="status">Capturing…</div>}
    {jobs.length > 0 && <div class="card" role="status">Capturing {jobs[0]?.progress.done ?? 0}/{jobs[0]?.progress.total ?? 0}</div>}
    {message && <div class="card" role="alert">{message}</div>}
    <div class="actions">
      {modes.map(([mode, label]) => <button class="action" type="button" key={mode} aria-label={label} disabled={busy || !settings} onClick={() => void startCapture(mode)}>{label}</button>)}
    </div>
    <div class="card muted">{t('privacy_tagline')}</div>
  </div>;
}

render(<Popup />, document.getElementById('app')!);
