import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import OverlayApp from './overlay/OverlayApp.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import AndroidAssistantApp from './android/AndroidAssistantApp.tsx'
import { hasAndroidAssistantBridge, installAndroidAssistantSync } from './android/assistantBridge.ts'
import { resolveWindowSurface } from './lib/windowSurface.ts'
import { ScheduleNotificationRuntime } from './components/ScheduleNotificationRuntime.tsx'

const surface = resolveWindowSurface(window.location.search, window.location.hash,
  hasAndroidAssistantBridge() || /Android/i.test(navigator.userAgent))
const isAndroidAssistant = surface === 'android-assistant'
installAndroidAssistantSync()
if (isAndroidAssistant) document.documentElement.classList.add('is-android-assistant')

const isOverlayWindow = surface === 'desktop-overlay'

if (isOverlayWindow && typeof document !== 'undefined') {
  document.documentElement.classList.add('is-overlay')
  document.body.classList.add('is-overlay')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAndroidAssistant ? <AndroidAssistantApp /> : <AuthProvider>
      {!isOverlayWindow && <ScheduleNotificationRuntime />}
      {isOverlayWindow ? <OverlayApp /> : <App />}
    </AuthProvider>}
  </StrictMode>,
)

