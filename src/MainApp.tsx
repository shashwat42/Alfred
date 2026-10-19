import App from './App.tsx';
import { AuthProvider } from './auth/AuthContext.tsx';
import { ScheduleNotificationRuntime } from './components/ScheduleNotificationRuntime.tsx';
import { AppUpdateRuntime } from './components/AppUpdateRuntime.tsx';
import { StorageRuntime } from './components/StorageRuntime.tsx';
import { ApplicationBoundary } from './components/reliability/ApplicationBoundary.tsx';
import { PresenceRuntime } from './components/PresenceRuntime.tsx';

export default function MainApp() {
  return <AuthProvider>
    <PresenceRuntime />
    <ScheduleNotificationRuntime />
    <AppUpdateRuntime />
    <StorageRuntime />
    <ApplicationBoundary><App /></ApplicationBoundary>
  </AuthProvider>;
}
