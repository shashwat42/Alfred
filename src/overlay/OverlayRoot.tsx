import { AuthProvider } from '../auth/AuthContext.tsx';
import { useAuth } from '../auth/authContext.ts';
import { OverlaySessionBoundary } from '../components/OverlaySessionBoundary.tsx';
import OverlayApp from './OverlayApp.tsx';
import { positionOverlayAtTop } from '../lib/overlayWindow.ts';
import { useEffect, useState } from 'react';
import { isTauri } from '../auth/auth.ts';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

function AccountOverlay() {
  const accountId = useAuth().session?.account.id;
  return <OverlayApp key={accountId} />;
}

export default function OverlayRoot() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    void positionOverlayAtTop().then(async () => {
      if (disposed) return;
      setReady(true);
      if (isTauri()) {
        const win = getCurrentWebviewWindow(); await win.show(); await win.setFocus();
      }
    }).catch(() => {});
    return () => { disposed = true; };
  }, []);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTauri()) return;
      void getCurrentWebviewWindow().close().catch(() => {});
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  return <div className={ready ? 'overlay-window-surface is-ready' : 'overlay-window-surface'}><AuthProvider><OverlaySessionBoundary><AccountOverlay /></OverlaySessionBoundary></AuthProvider></div>;
}
