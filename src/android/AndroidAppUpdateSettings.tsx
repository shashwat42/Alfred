import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { androidAssistantRequest, hasAndroidAssistantBridge } from './assistantBridge.ts';
import { ErrorNotice } from '../components/reliability/Notifications';

interface AndroidUpdate { version: string; versionCode: number }
interface AndroidUpdateResult { currentVersion: string; update: AndroidUpdate | null }

export function AndroidAppUpdateSettings() {
  const [result, setResult] = useState<AndroidUpdateResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'download' | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const active = useRef(true);
  const operation = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const available = hasAndroidAssistantBridge();
  async function run(type: 'check' | 'download') {
    if (operation.current) return;
    operation.current = true; setBusy(type); setError(''); setFeedback('');
    try {
      const response = await androidAssistantRequest(type === 'check' ? 'checkUpdates' : 'downloadUpdate');
      if (!active.current) return;
      if (type === 'check') setResult(response as unknown as AndroidUpdateResult);
      else setFeedback('APK download opened in your browser. Open the downloaded file to install the update.');
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : 'Could not check Android updates.'); }
    finally { operation.current = false; if (active.current) setBusy(null); }
  }
  return <section className="settings-card-group android-app-updates">
    <h3 className="settings-group-header"><Download size={16} className="settings-group-icon" />App updates</h3>
    <div className="settings-feature-card">
      <div className="settings-feature-info">
        <span className="settings-feature-title" role="status" aria-live="polite">{busy === 'check' ? 'Checking for Android updates…' : result?.update ? `Alfred ${result.update.version} is available.` : result ? 'You’re up to date.' : 'Check for new Android releases'}</span>
        {result && <span className="settings-feature-desc">Installed version: {result.currentVersion}</span>}
        <span className="settings-feature-desc">Download the APK, then open it to install. Android verifies the app’s signing identity before updating your existing installation.</span>
      </div>
      <div className="android-update-actions">
        <button type="button" className="settings-action-btn" disabled={!available || busy !== null} onClick={() => void run('check')}><RefreshCw size={16} />{busy === 'check' ? 'Checking…' : 'Check for updates'}</button>
        {result?.update && <button type="button" className="settings-action-btn is-primary" disabled={busy !== null} onClick={() => void run('download')}><Download size={16} />{busy === 'download' ? 'Opening download…' : 'Download APK'}</button>}
      </div>
      {!available && <p className="settings-feature-desc">Update checking is available in the installed Android app.</p>}
      {feedback && <p className="settings-save-feedback" role="status">{feedback}</p>}
      <ErrorNotice message={error} />
    </div>
  </section>;
}
