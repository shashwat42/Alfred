import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import OverlayApp from './overlay/OverlayApp.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'

const isOverlayWindow =
  typeof window !== 'undefined' &&
  (window.location.search.includes('window=overlay') ||
    window.location.hash.includes('window=overlay'))

if (isOverlayWindow && typeof document !== 'undefined') {
  document.documentElement.classList.add('is-overlay')
  document.body.classList.add('is-overlay')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      {isOverlayWindow ? <OverlayApp /> : <App />}
    </AuthProvider>
  </StrictMode>,
)

