import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './components/reliability/reliability.css'
import { hasAndroidAssistantBridge, installAndroidAssistantSync } from './android/assistantBridge.ts'
import { resolveWindowSurface } from './lib/windowSurface.ts'
import { NotificationHost } from './components/reliability/Notifications.tsx'
import WindowSurface from './WindowSurface.tsx'

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
    <NotificationHost />
    <WindowSurface surface={surface} />
  </StrictMode>,
)
