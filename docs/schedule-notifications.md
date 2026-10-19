# Schedule notifications

## Pre-implementation baseline (17 October 2026)

Audited React entry points, authenticated API/session handling, settings, schedule
hooks and dashboard, all schedule routes/controllers/Zod schemas/services/models,
AI schedule tools, Tauri Rust/Cargo/capabilities/window lifecycle/tray, and Android
assistant service/session/bridge/manifest/Gradle/generated integration hooks.
Existing unrelated working changes in .gitignore, Android assistant documentation,
Gradle caches and .vscode were preserved.

- Frontend TypeScript and production build passed (existing chunk-size/import warnings).
- Backend TypeScript passed.
- Frontend tests: 18/18 passed.
- Backend tests: 19/20 in sandbox (localhost EACCES); 20/20 outside sandbox.
- Rust offline check passed (incremental-cache hardlink warnings).
- Android baseline initially blocked by sandbox Gradle-cache access; the retry
  passed the existing JVM unit tests and Android lint.

## Architecture and delivery contract

Schedules remain the only source of event data. There are no existing recurrence,
cancellation, per-event reminder, or explicit timezone fields. Deletion is the
existing cancellation operation. Repeated events represented as separate schedule
records have distinct occurrence identities; this feature does not add recurrence.

The dedicated Express schedule-notification module derives a bounded 48-hour plan
from current schedules on every authenticated sync and revalidates the original
schedule and current preferences at delivery time. This read-through reconciliation
automatically covers every schedule mutation through the shared service, including
AI calls, without requiring a successful notification write during schedule saves.
Deleted, edited or disabled occurrences cannot pass a subsequent delivery check.
No notification queue copies titles, dates or schedule content into MongoDB.

Desktop pulls over the existing authenticated HTTPS API with a 15-second coordinator in the main document,
including when hidden in the tray. The overlay never runs a second coordinator.
Android uses Firebase Cloud Messaging plus native AlarmManager alarms and a persisted JobScheduler job, rather
than assuming a WebView stays alive. Its network operations run off the UI thread.
Alarms/jobs request a fresh server claim before showing anything. Thus remote edits,
deletions, destination changes, session expiry and device removal are respected at
delivery time. A bounded 15-second backend worker checks registered mobile installations
and sends due reminders as high-priority, data-only FCM messages. The receiver posts
directly without a WebView or network fetch, checking its active account, session
fingerprint, token expiry and reminder expiry first. Push and alarms share server
claims and a native receipt history to prevent duplicate notifications. Different
installations each receive their own eligible delivery.

MongoDB atomic unique delivery keys include account, installation, schedule ID,
event instant and reminder kind. Claims survive restarts and concurrent server
instances. Lead-time/preference changes do not reset an already claimed occurrence.
This deliberately chooses at-most-once *attempts*: if the process dies after claim,
or the native API fails after claim, that notification may be lost. Retrying an
ambiguous OS submission would permit duplicates; exactly-once visible delivery
across MongoDB and a remote OS notification API is not transactional.

Late attempts have a two-minute grace window; lead reminders never fire after the
event begins. There is no burst catch-up after downtime. Plans use an account/date
index and keyset pagination. The backend push timer does not overlap passes, uses
bounded indexed device pages and stops on shutdown. Native timers and credentials
are cancelled on sign-out. The server rechecks installation and account session
version before sending; it never stores a user bearer token for push.

## Settings and storage

Settings default to Both, enabled, ten-minute lead, no additional start alert.
Lead time accepts 0–10080 minutes. Zero lead produces one start-time alert.
Preferences are account-scoped and revisioned to prevent concurrent lost updates.
New settings use automatic device time-zone detection. The main app resolves its
IANA zone with Intl, persists it with a revision check before notification sync,
and checks for device-zone changes while running. Settings shows Automatic with
the detected zone; selecting a named zone opts into a fixed manual override.
The account's most recently detected zone is shared by desktop and Android
background delivery. Choose a fixed zone for devices in different time zones.
Legacy UTC settings without a mode are upgraded to automatic; legacy custom
zones remain fixed. An explicitly selected UTC zone remains manual. No location
permission or geolocation request is needed. Older clients preserve the mode
when editing other preferences. Legacy free-form
times are parsed strictly as 24-hour HH:mm or 12-hour h:mm AM/PM (whole hours also
accepted); ambiguous prose is skipped without changing the schedule. DST gaps are
skipped; repeated wall-clock times choose the first instant.

New collections: ScheduleNotificationSettings (one/account),
ScheduleNotificationDevices (hashed installation secret and session fingerprint,
platform and expiry), ScheduleNotificationDeliveries (minimal atomic claim ledger).
Indexes initialize before accepting API requests; existing schedule rows need no
migration. The installation capability is generated from 32 random bytes. Account
identity always comes from existing JWT/account middleware. Device claims also
require the original session fingerprint. Sign-out deregisters best-effort and
native credentials are cleared; expired tokens cannot fetch/claim. Existing JWT
auth has no central session-revocation endpoint; deleting the account is enforced
by the existing middleware. Device registrations expire after 30 days unless renewed.

## Limitations and setup

FCM uses the project's free Spark plan; Analytics and a billing account are not
required. Configure both FCM_PROJECT_ID and FCM_SERVICE_ACCOUNT_BASE64 on the
existing API deployment to enable push. The credential belongs to a dedicated
service account with the Firebase Cloud Messaging API Admin role, and is stored
as an encrypted GitHub Actions secret. Never commit or bundle this private key.
Android's public SDK configuration is source-controlled and copied by
scripts/sync-android-assistant.js. No wake-word service or battery exemption is introduced.
Notification permission must be granted separately from
the account destination choice. Android 13+ uses POST_NOTIFICATIONS and an ordinary
schedule channel. Settings offers Android 12+ “Alarms & reminders” special access
(SCHEDULE_EXACT_ALARM); it is optional and user-controlled. Without access, alarms
use an inexact fallback that may be substantially delayed. With access, alarms use
setExactAndAllowWhileIdle; the alarm receiver submits a network-constrained
expedited JobScheduler job on Android 12+ (ordinary fallback when quota is denied).
Jobs and network may still be deferred by Doze, battery restrictions, force-stop
or OEM policy. A delay beyond two minutes
skips the reminder intentionally. Android jobs discover remote schedule changes
periodically (minimum 15 minutes); running-app sync refreshes sooner. Push covers
new short-notice events created elsewhere without waiting for that periodic sync.
Network/backend access is required at claim time; offline delivery is deliberately
suppressed so cancelled schedules and changed preferences cannot produce stale
alerts. Push has a short TTL and the same at-most-once attempt policy; FCM and
device delivery are not guaranteed. Open the updated app once with notification
permission and internet access to register for push. Google Play services are
required. Settings reports whether phone registration completed. Reboot restores jobs;
force-stopped apps must be opened again. Desktop must remain running (tray is
supported); quitting it stops delivery. OS focus/do-not-disturb settings may suppress
presentation despite a successful native submission.

Windows notifications require an installed application for proper app identity;
notification actions depend on platform support. Taps navigate to the original
schedule date, with the schedule ID provided for highlighting. Notification text
contains only the event title and event time, never tokens or device secrets.
Preference changes establish a new effective time: already elapsed reminder windows
are not revived when toggling a destination or re-enabling reminders.
The maintained Tauri plugin reports Windows clicks while a toast is visible;
clicks after it moves to Action Center are not reported by this plugin version.
Native Android credentials are in application-private preferences excluded from
both cloud backup and device transfer. Native sync never follows HTTP redirects.

Schedule notifications request a native chime: the default Windows notification
sound, macOS Ping, the Linux message-new-instant theme sound, and Android's default
notification tone. Android 8+ uses the existing Schedule events channel; older
Android versions set the sound directly on the notification. Existing channel
sound choices, muted channels, silent mode and Do Not Disturb remain controlled by
the operating system. Use Open Android settings to change an existing channel's
tone; the application does not replace its channel to override a user's choice.

When permission is already granted, Settings shows a disabled “Notifications enabled”
indicator instead of a clickable Enable button. Tauri's desktop permission request
does not open a system prompt. Windows has a separate “Open Windows notification
settings” action using the documented ms-settings:notifications URI, scoped to
that exact URL and the main Windows document. Android retains its runtime request
and system-settings action. Both actions show progress and success/failure feedback.

## Changed files

- `Alfred_Backend/src/modules/schedule-notifications/{policy,models,service,route}.ts`:
  time calculation, account settings, device registration, persistent claims,
  indexed plans and authenticated endpoints.
- `Alfred_Backend/src/modules/schedule-notifications/{notifications,mongo}.test.ts`:
  policy/service/API tests and an opt-in real MongoDB concurrency test.
- `Alfred_Backend/src/models/schedule.model.ts`, `server.ts`, `package.json`:
  compound pagination index, module/index startup and expanded test command.
- `src/lib/{scheduleNotifications,scheduleNotificationCoordinator}.ts`, `src/components/ScheduleNotificationRuntime.tsx`:
  authenticated native adapters, one main-window scheduler, cleanup and action handling.
- `src/components/dashboard/ScheduleNotificationSettings.tsx`, `SettingsView.tsx`,
  `src/index.css`: accessible responsive account preferences and OS status/setup.
- `src/{main,App}.tsx`, `src/components/Dashboard.tsx`,
  `src/components/dashboard/ScheduleTimelineView.tsx`: main-only coordinator and
  navigation to the selected event/date.
- `scripts/tests/schedule-notifications.test.ts`: client/account/permission/native IPC tests.
- `wrapper/{Cargo.toml,Cargo.lock,src/lib.rs}`, `package{,-lock}.json`,
  `wrapper/capabilities/{schedule-notifications,windows-notification-settings}.json`: compatible maintained desktop
  notification plugin and permissions restricted to the main desktop document.
- `wrapper/android/assistant/src/main/java/com/alfred/assistant/ScheduleNotifications.kt`,
  `AssistantBridge.kt`, module manifest and backup-rule resources: native scheduling,
  background jobs, permission flow, trusted origin bridge, taps and private credentials.
- `wrapper/gen/android/app/src/main/java/com/alfred/app/MainActivity.kt`,
  `scripts/sync-android-assistant.js`: intent hooks preserved by the existing sync script.

## Manual acceptance

1. Run the backend with MongoDB and install fresh desktop/Android builds. Open each
   installation and sign into the same account (independent guest sessions are
   different accounts). Enable notifications on receiving devices. Android can
   optionally grant Alarms & reminders access through Settings.
2. Create events through both chat and the dashboard. Test each destination,
   disable/re-enable, change lead time and enable start alerts. Use events far
   enough in the future to allow a full lead-time window after saving settings.
3. Hide the desktop app in the tray; close the Android main/assistant WebViews.
   Verify one notification per eligible installation. Tap and verify the event's
   date opens and the event receives focus. Check denied-permission behavior.
4. Edit/delete events from another device before delivery. Restart the backend.
   Verify old occurrences do not notify. Sign out and confirm no subsequent alerts.
5. Test offline/Doze/reboot separately; expect suppressed or missed alerts under
   the limitations above, not guaranteed push delivery. Do not run Android
   instrumentation against a selected system assistant without considering the
   existing assistant-service binding warning in the Android validation docs.

To run the real database test, set ALFRED_NOTIFICATION_TEST_MONGODB_URI to a
dedicated MongoDB database whose name ends in `_test`, then run the backend tests.
The test refuses application database names and cleans only its own account data.
The ordinary suite uses a repository fixture for Mongo persistence and real HTTP/JWT
middleware for endpoint tests; it does not claim to prove live MongoDB behavior.

## Historical verification results (17 October 2026)

- Frontend production build (including TypeScript): passed. Existing large-chunk
  and ineffective dynamic-import warnings remain.
- Backend `npm run check`: passed.
- Frontend `npm test`: 28/28 passed, including permission/native IPC adapters,
  account-switch isolation, overlapping-poll prevention, sign-out cleanup, and
  Windows notification-settings IPC success/failure handling.
- Backend `npm test`: 49 passed, 1 skipped, no failures. The skipped check is the
  opt-in real MongoDB test; no isolated test database was supplied. Policy/service
  concurrency tests use a persistent repository fixture; API tests use real HTTP,
  JWT and Express middleware with fixture-backed persistence.
- Rust desktop `cargo check --manifest-path wrapper/Cargo.toml`: passed with the
  notification plugin resolved and compiled. Fresh ARM64 Android Rust build passed.
- Android assistant JVM tests: 4/4 passed; Android lint and app ARM64 Kotlin
  compilation passed. Existing Android lint warnings remain; durable background
  SharedPreferences commits also produce advisory lint warnings.
- `npm run android:build-assistant -- arm64`: passed using the repository's fresh
  Rust/copy-JNI workflow. APK: `wrapper/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`.
- ESLint for all changed frontend source files: passed. Repository-wide ESLint
  remains blocked by unchanged errors in SafeMarkdown.tsx, WheelPicker.tsx and
  useTasks.ts, with existing unused-disable warnings in Chat.tsx.
- `git diff --check`: passed. Reviewed tracked changes and new source files;
  unrelated pre-existing edits were preserved. No credentials or new external
  service configuration were added. The only new dependency is the maintained
  Tauri notification plugin (JavaScript and desktop Rust packages).

Physical OS notification presentation, action taps, multiple real installations,
Doze/reboot behavior, and real MongoDB integration have not been accepted on live
devices/services. No release signing, installation, deployment or default-assistant
selection was performed. macOS/Linux notification binaries were not built on this
Windows host. Run the manual acceptance checklist before calling this production
validated. No provider credentials or push setup are required for the implemented
pull/native-alarm transport.

References used to verify platform contracts:
- [Tauri notification API](https://v2.tauri.app/reference/javascript/notification/)
- [Android alarm and background execution guidance](https://developer.android.com/develop/background-work/services/alarms)

## Beta 5.1 verification (19 October 2026)

Frontend tests, automatic IST/manual UTC UI checks, note autosave regression checks,
Android settings checks and TypeScript checks passed. Native JVM tests cover push
expiry/account/session checks and assistant settings fallbacks. Isolated MongoDB
tests exercise phone registration, real indexed worker discovery, schedule claims,
duplicate suppression and session revocation with a stub push transport. FCM's
validation-only API accepted the dedicated sender without sending a notification.
Physical phone notification presentation after installation remains to be confirmed.

- [Firebase Android setup](https://firebase.google.com/docs/android/setup)
- [FCM Android delivery priorities](https://firebase.google.com/docs/cloud-messaging/android-message-priority)
