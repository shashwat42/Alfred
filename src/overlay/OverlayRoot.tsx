import { AuthProvider } from '../auth/AuthContext.tsx';
import { OverlaySessionBoundary } from '../components/OverlaySessionBoundary.tsx';
import OverlayApp from './OverlayApp.tsx';
import { useEffect } from 'react';
import { isTauri } from '../auth/auth.ts';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export default function OverlayRoot() {
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTauri()) return;
      void getCurrentWebviewWindow().close().catch(() => {});
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  return <AuthProvider><OverlaySessionBoundary><OverlayApp /></OverlaySessionBoundary></AuthProvider>;
}
