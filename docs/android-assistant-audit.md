# Android assistant baseline audit — 16 October 2026

Recorded before implementation. Existing uncommitted UI/settings/composer changes are preserved.

## Repository and lifecycle

- Frontend: React 19 / TypeScript / Vite 8. `src/main.tsx` selects the regular app or Windows overlay by query parameter. `AuthProvider` initializes an existing or guest session. Conversation history is component memory only.
- Native: Tauri 2, Rust 2024, app identifier `com.alfred.app`. Windows tray, overlay and global shortcut setup are inside `cfg(desktop)` in `wrapper/src/lib.rs`.
- Android: generated project under `wrapper/gen/android`, tracked in Git; only generated Tauri bindings, runtime config, JNI binaries and build outputs are ignored. `MainActivity` extends the generated `TauriActivity`. Wry owns its WebView and lifecycle; it must not be reparented into a service window.
- Gradle: AGP 9.3.1, Kotlin 2.2.10, Gradle 9.6.1, compile/target SDK 37, min SDK 24 (Android 7). Existing WebKit 1.14.0 dependency supports an origin-scoped message bridge and asset loader.
- Build scripts: `scripts/dev-android.js` builds Vite, cross-compiles Rust, copies JNI, then packages with Gradle excluding Rust tasks. Direct Gradle Rust tasks require a running Tauri CLI options server. `tauri.build.gradle.kts`, `tauri.settings.gradle` and generated Kotlin are regenerated; do not edit them.
- Preservation: put new native functionality in a separate source-controlled Android library outside `gen`. Three integration hooks (settings include, app dependency, MainActivity bridge) must be checked/reapplied after a deliberate `tauri android init`; an idempotent script will do this. Normal builds do not require reinitialization.

## Shared contracts and constraints

- `aiChat.ts` bounds history to 20 messages, 4,000 characters/message, 20,000 total; calls `apiFetch` at `/api/ai/chat`. Backend authenticates and scopes actions to `req.accountId`, validates with Zod and rate-limits. No new backend or prompts are needed.
- `apiFetch` presently replaces a 401 session with a guest automatically. The assistant must opt out of that recovery to avoid changing the selected account on expiry; existing consumers retain their behavior.
- `audioRecorder` uses explicit `getUserMedia` activation and local VAD. `speechManager` owns the existing Whisper Web Worker. Preserve both; a session WebView needs a narrowly scoped microphone permission handler because it is not a Tauri Activity.
- The configured Android app origin defaults to **http://tauri.localhost**, not HTTPS (verified in the installed Tauri source). Changing its scheme would move localStorage and sign users out. The separate session must serve only packaged assets at that same origin to reuse the existing WebView profile/session; never inject tokens into URLs or bridge messages. Confirm sharing on a real Android runtime.
- A VoiceInteractionSession is the primary surface. No SYSTEM_ALERT_WINDOW, AccessibilityService, key interception, wake word, screenshot or foreground-app data is needed. Android controls eligibility/invocation; selecting a role must remain a user action.
- Settings currently has device-specific preferences and a responsive layout; add capability-aware Android setup there. Keep normal launch and Windows routing intact.

## Baseline validation

- `npm run build`: passed (existing chunk/dynamic-import warnings).
- `cargo check --manifest-path wrapper/Cargo.toml --offline`: passed (filesystem hard-link warnings).
- No existing automated frontend/backend test script or test suite was found.
- Direct `gradlew :app:assembleArm64Debug --offline`: failed in existing Rust task because `.tauri/cli-options-server.json` is absent, as expected without `tauri android build/dev` running.
- Repository packaging path `:app:assembleArm64Debug -x rustBuildArm64Debug -x rustBuildUniversalDebug --offline`: passed using the existing JNI library. This does not prove a fresh Rust/Android build.
- Connected physical device: Samsung SM-M366B, Android 16, API 36 (ADB). Device registration, gestures, permission or AI flows have not yet been tested. Emulator AVD available: `Medium_Phone_API_37.0`; not yet booted/tested. One manufacturer cannot establish general compatibility.
- Gradle and ADB require access outside the workspace sandbox; approved tool calls are used for their normal caches/server. No app has been installed or default assistant changed during this audit.

## References used

- https://developer.android.com/reference/android/service/voice/VoiceInteractionService
- https://developer.android.com/reference/android/service/voice/VoiceInteractionSession
- https://developer.android.com/reference/android/app/role/RoleManager
- https://developer.android.com/develop/ui/views/layout/webapps/load-local-content
- Installed Tauri/Wry Android source and Android SDK 37 source.
