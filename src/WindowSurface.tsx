import { lazy, Suspense } from 'react';
import type { WindowSurface as Surface } from './lib/windowSurface.ts';

const MainApp = lazy(() => import('./MainApp.tsx'));
const Overlay = lazy(() => import('./overlay/OverlayRoot.tsx'));
const AndroidAssistant = lazy(() => import('./android/AndroidAssistantApp.tsx'));

/** Load only the interface hosted by this WebView. */
export default function WindowSurface({ surface }: { surface: Surface }) {
  const Component = surface === 'android-assistant' ? AndroidAssistant
    : surface === 'desktop-overlay' ? Overlay : MainApp;
  return <Suspense fallback={null}><Component /></Suspense>;
}
