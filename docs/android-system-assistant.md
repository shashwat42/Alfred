# Alfred Android system assistant

## Gradle project import

Open `wrapper/gen/android` as the Android Gradle project. The source-controlled
`wrapper/android/assistant` directory is its `:alfred-assistant` subproject; it
inherits Android and Kotlin plugin versions from that root build. It is not a
standalone Gradle project. The repository's VS Code settings point Gradle discovery
at `wrapper/gen/android` and exclude the assistant folder from independent Java
project discovery, while the Android root still includes it
through `settings.gradle`. If VS Code previously imported it independently, run
**Java: Clean Java Language Server Workspace** from the Command Palette and restart
when prompted to clear the stale project and its plugin-resolution diagnostic.

## Architecture

Android binds `AlfredVoiceService` and creates an `AlfredAssistantSession` through `AlfredSessionService`. The session owns a transparent Android voice-interaction window containing a full-screen **separate** WebView. The existing Tauri Activity/WebView is never moved, replaced or embedded in a service.

The lightweight persistent `AlfredVoiceService` runs in the app-private `:assistant` process. It owns no WebView, microphone or model. `AlfredSessionService`, its WebView and native capture remain in the ordinary application process so the existing Android WebView profile, sign-in storage and main-WebView reference remain shared. This follows [Android's recommendation to separate the persistent voice service from its UI/session service](https://developer.android.com/reference/android/service/voice/VoiceInteractionService). Closing the Tauri Activity can end its UI process; that must not also destroy Android's persistent assistant binding. Both processes use the same application UID and existing permissions.

The session serves Vite's **production bundle from APK assets**, using the existing `http://tauri.localhost` origin and the same Android WebView profile as the regular app. This preserves the location of existing sign-in storage. It does not send authentication tokens through the native bridge or a URL. The session document selects `AndroidAssistantApp` through a query parameter, bypasses Tauri IPC/bootstrap and uses the existing `apiFetch`, `buildSafeChatContext`, `sendChatMessage`, Gemini audio input and `SafeMarkdown`. Overlay microphone capture uses a bounded native `AudioRecord` turn with `VOICE_RECOGNITION`; regular app/Windows capture continues to use `AudioRecorder`. There is no second backend, prompt implementation, account database or conversation store.

The assistant opts out of `apiFetch`'s existing automatic guest replacement on 401; other app consumers retain their previous behavior. Requests are tied to the expected account, in-flight responses are discarded after account changes, and changed-account events clear the assistant's memory. Only action-invalidation types/account ID/revision are persisted for cross-WebView refresh. Prompts, transcripts and responses are not persisted. Dismissal destroys the session document, aborts requests and recording, and cancels synthesis. The next invocation starts a new conversation. Opening the system assistant also stops microphone capture in the regular app if it is still running in the same process.

Audio capture wraps native PCM as WAV and submits it as multipart data through the shared authenticated backend. Both configured Gemini models use the existing OpenAI-compatible endpoint and fallback service. The exact submitted WAV Blob stays in session memory for local voice-note playback; no speech model or runtime is packaged or downloaded.

The message bridge accepts bounded JSON from the **main frame of the exact packaged origin**. The main app exposes only `status` and `setup`. The session exposes `dismiss`, `openApp`, and explicit `recordVoice`/`cancelVoice`. Capture checks the existing RECORD_AUDIO runtime grant (using the permission Activity if needed), reads 16kHz mono signed PCM with the speech-recognition source, and releases the recorder on completion/cancel/dismissal. It detects trailing pauses locally, errors after 12 seconds without detected speech, and has a 30-second recording cap. Only the ephemeral packaged document receives the bounded base64 PCM result (maximum approximately 1.28MB), wraps it in a WAV container without changing samples, and sends it through the existing Gemini service. During capture, the same request sends intermediate `voiceLevel` replies at most once per 80ms with a clamped 0–1 scalar. These update the listening logo without settling the pending recording request or retaining raw audio. No capture files are written. It grants no arbitrary intents, filesystem access, HTTP request proxy or general native command interface. Remote document navigation, frames, file/content access and remote scripts are blocked. Same-origin asset misses fail closed rather than going to a remote host. HTTPS API fetches remain available to the trusted bundle.

The regular Android launch uses its existing application UI. `tauri.android.conf.json` overrides the desktop window array with a single `main` window at `index.html`; both Android build scripts merge that platform configuration into the runtime asset. This is required as well as the Rust desktop guards: copying the unmerged desktop config into an APK allowed its overlay window to replace the normal Android UI. A frontend route guard also prevents Android from rendering the desktop overlay if given its query/hash URL. Windows retains both of its original windows.

Only the separate assistant document uses the PC-style overlay: one compact quick-input or voice-status bar, with the same arrow-switch button in both modes, and left/right conversation bubbles over a transparent surface. There is no permanent second action panel. Open-app and clear-chat actions are in an on-demand options menu above the bar; send/Stop and dismiss stay in the main bar. The separate WebView always uses the full safe screen width and height, without an outer card, fixed conversation-height boundary, or expand/compact state. The conversation scrolls above the bottom-anchored bar; only the bar is capped at 620px for readability on wide displays. Android dims the underlying app slightly using its native window dim amount of 0.22. The native container applies the larger of keyboard and navigation-bar bottom insets, with an additional 8dp margin and 4px frontend padding. On API 30+ it owns inset handling with decor fitting disabled so keyboard height is not applied twice. No application-overlay window is used. Locked devices show an unlock/open-app fallback without loading the conversation surface.

The logo follows the app's voice-state visuals: live red listening border/glow driven by native microphone RMS, a rotating amber dashed transcription ring, a breathing double crimson response-generation border, and a soft ripple for spoken playback. Model preparation spins a red arc; errors retain a static paused border. Color/state cues remain visible with reduced motion enabled, while ring/pulse animations and amplitude scaling are disabled.

The assistant WebView permits Web Audio after asynchronous model loading (`mediaPlaybackRequiresUserGesture=false`); capture still requires explicitly entering voice mode and the existing origin/runtime permission checks. The shared recorder explicitly resumes a suspended AudioContext before starting its analyser, and cancels safely if recording was stopped during that resume. An analyser failure now rejects silence-detected capture instead of leaving a recording waiting on an unusable analyser. See [Android WebSettings](https://developer.android.com/reference/android/webkit/WebSettings#setMediaPlaybackRequiresUserGesture(boolean)) and [keyboard inset handling](https://developer.android.com/develop/ui/views/layout/sw-keyboard).

The earlier Web Audio change did not resolve background overlay capture: physical audio-policy logs showed Chromium's `VOICE_COMMUNICATION` recordings marked silenced when another app was foreground. The native `VOICE_RECOGNITION` path addresses this source mismatch; Android's [audio-policy implementation](https://android.googlesource.com/platform/frameworks/av/+/refs/heads/master/services/audiopolicy/service/AudioPolicyService.cpp) specifically permits speech-recognition capture for the active assistant. It uses ordinary runtime microphone permission, not hotword capture or a foreground/background recording service. No permissions were added.

Voice failures keep the overlay in a visible Paused state with a retry card above the bar. Capture/model/transcription failures offer Try again; AI failures preserve the recognized question and offer Retry response without recording or duplicating it. An empty HTTP-success AI response is an error too. Overlay response requests abort after 45 seconds. In the regular app, failed AI replies now transition the existing voice hero/header to its error/Retry UI instead of silently resuming listening; Retry replays the failed question.

## Setup

1. Install the Android APK and open Alfred normally. Existing accounts remain in the same storage origin; sign in normally if needed.
2. Open **Settings → Android system assistant → Open assistant setup**.
3. On Android 12/API 31 or newer, select **Choose default assistant** and explicitly choose Alfred in Android's chooser/settings. The assistant role is used when available; unavailable/already-held role cases use Android's voice/default-app settings.
4. Return to Alfred and verify it reports **active**. This is based on `VoiceInteractionService.isActiveService`, not an optimistic button state.
5. Open another app and invoke the assistant gesture/shortcut supported by the device and launcher. Type a prompt, or explicitly activate voice. Close with X or Android navigation.

Android may not provide an assistant role or a compatible gesture. Physical-button and launcher behavior varies; no universal long-press/power-button guarantee is made. If Alfred is absent, inspect service registration/metadata, role availability and Android WebView support. No key interception is used. Continue using Alfred as a regular app when assistant selection is unavailable. The native setup Activity can also be opened through Android's assistant settings when that UI offers an assistant configuration entry.

The regular application retains min SDK 24. **The system-assistant service is enabled only on Android 12/API 31 or newer.** Older Android releases require a real system-wide `RecognitionService`; Alfred uses direct Gemini audio input and does not implement that separate OS contract. Setup clearly explains the limitation on Android 7–11 and keeps the regular app available. No dummy recognizer is registered, and the system's existing speech recognizer is not replaced. Old API helper branches remain lint guarded, but do not establish assistant support on those releases.

Assistant metadata includes `android:recognitionService=""`. Although Android 12+ decouples assistant selection from system recognition, its service parser/role controller still requires that attribute to be present. Omitting it made the initial physical build discoverable as a service but absent from the chooser. The corrected build was listed and opened its floating panel on the SM-M366B, as confirmed by the user. Resource booleans disable this service on older platforms where an empty recognizer would not be safe. See [Android's parser](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/service/voice/VoiceInteractionServiceInfo.java) and [system role handling](https://android.googlesource.com/platform/frameworks/base/+/master/services/voiceinteraction/java/com/android/server/voiceinteraction/VoiceInteractionManagerService.java).

The origin remains HTTP on the reserved localhost domain to preserve existing storage; instrumentation checks Android's actual secure-context/getUserMedia capability. Do not change the scheme as a workaround: it moves account storage. Production CORS must allow the configured app origin, as for the existing Android app.

## Permissions

- `INTERNET`: the existing authenticated backend and explicit speech-model downloads.
- `RECORD_AUDIO`: existing runtime permission, requested only after the user activates voice and WebView requests audio capture. An unexported transient Activity hosts the Android dialog. Other capture resources/origins are denied.
- `MODIFY_AUDIO_SETTINGS`: already declared by the existing app; unchanged.
- `BIND_VOICE_INTERACTION`: a **protected service binding requirement**, not a runtime permission dialog; only Android can bind the assistant/session services.
- Narrow `<queries>` entries discover Android's voice-input/default-app settings for compatibility fallbacks.

No `SYSTEM_ALERT_WINDOW`, accessibility, notifications, boot receiver, screenshot/screen capture or battery-exemption permission is added. There is no wake-word or always-listening service. Spoken replies are used only if Android WebView exposes speech synthesis; text responses remain available otherwise. Voice input sends bounded WAV audio through the authenticated Gemini backend; playback uses the local recording.

## Source files and preservation

| File(s) | Purpose |
| --- | --- |
| `wrapper/android/assistant/build.gradle.kts`, `.gitignore` | Source-controlled native library; syncs production assets into an ignored APK asset directory. Uses existing project SDK/WebKit versions. |
| `wrapper/android/assistant/src/main/AndroidManifest.xml`, `res/xml/alfred_voice_interaction.xml`, `res/values/{strings,styles,bools}.xml`, `res/values-v31/bools.xml` | Protected service registration, supported setup/permission Activities, assistant metadata, Android-version capability gating and transparent theme. |
| `AlfredVoiceService.kt` | Lightweight Android service and session factory. |
| `AlfredAssistantSession.kt` | Native window, trusted local WebView, insets, explicit microphone permissions, cancellation and lifecycle. |
| `AssistantBridge.kt`, `AssistantAssetPath.kt` | Origin/action boundaries and safe packaged asset paths. |
| `AssistantSetupActivity.kt`, `MicrophonePermissionActivity.kt` | Capability-aware user selection and runtime audio permission host. |
| `src/android/{AndroidAssistantApp.tsx,androidAssistant.css}` | Compact floating UI and orchestration of existing AI/voice modules; ephemeral history. |
| `src/android/{assistantBridge.ts,AndroidAssistantSetup.tsx}` | Typed bounded message client, account/action invalidations, Settings setup/status. |
| `src/main.tsx` | Dedicated assistant document route; existing desktop/regular routes retained. |
| `src/components/dashboard/SettingsView.tsx` | Android-only setup section. |
| `src/components/Chat.tsx` | Stop regular-app capture when Android opens the system assistant. Earlier UI/composer changes are preserved. |
| `src/lib/{api,aiChat}.ts` | Optional expected-account/preserve-account request behavior used by the assistant; defaults unchanged. |
| `src/lib/audioRecorder.ts`, `src/lib/audio.ts`, `src/components/VoiceNote.tsx` | Microphone capture, WAV preparation and session-local playback. |
| `scripts/sync-android-assistant.js` | Idempotently restores three generated-project integration hooks and instrumentation runner configuration. |
| `scripts/build-android-assistant.js`, `package.json` | Reproducible copy-based debug build for Windows hosts without symlink support, plus test/sync commands. Does not install or select an assistant. |
| `wrapper/tauri.android.conf.json`, `scripts/android-runtime-config.js` | Android-only main-window configuration and shared merge/validation for standalone runtime assets; excludes desktop overlay windows from Android. |
| `src/lib/windowSurface.ts` | Platform-aware document routing; Android ignores desktop overlay URLs. |
| `scripts/dev-android.js` | Syncs hooks before its existing Android build/deploy workflow. |
| `wrapper/gen/android/{settings.gradle,app/build.gradle.kts,app/src/main/java/com/alfred/app/MainActivity.kt}` | Module include/dependency and main-WebView bridge hook; no generated Tauri bindings changed. |
| `scripts/tests/android-assistant.test.ts` | Account isolation, bounded contexts and existing-client regression checks. |
| `wrapper/android/assistant/src/test/.../AssistantAssetPathTest.kt` | Native path/traversal validation tests. |
| `wrapper/gen/android/app/src/androidTest/.../{AssistantRegistrationTest,AssistantDocumentTest}.kt` | Real Android registration, origin, permission, keyboard-inset and bundled-document/profile checks. Does not change the default assistant. Optional neutral AI/model probes and an opt-in one-second microphone capture probe that discards audio and verifies track cleanup. |
| `docs/android-assistant-audit.md`, this document, `android-assistant-validation.md` | Baseline, architecture/setup/build guide and actual test record/checklist. |

Native Kotlin filenames in this table are under `wrapper/android/assistant/src/main/java/com/alfred/assistant/` unless otherwise indicated. Existing frontend UI/settings edits from earlier tasks are not changes introduced by this feature.

The Android library lives **outside** Tauri's generated project. The generated project is tracked, but explicitly rerunning initialization can replace its hook files. After `tauri android init`, run `npm run android:sync-assistant`, inspect the diff, and keep/reapply source-controlled `app/src/androidTest` tests. Normal Tauri builds regenerate bindings and `tauri.*.gradle*` files, which this implementation never edits. No dependency, compile/target SDK or desktop configuration upgrade is required.

## Build and test commands

Run in the repository root, with the existing Android SDK/NDK, Java and Rust targets configured:

```powershell
npm run android:sync-assistant
npm run test:android-assistant
npm run build
cargo check --manifest-path wrapper/Cargo.toml --offline
node node_modules/@tauri-apps/cli/tauri.js android build --debug --target aarch64 x86_64 --apk --ci
```

On this Windows host, the official CLI successfully compiled ARM64 Rust but could not create its JNI symlink. Do not change Windows security settings merely to build: the repository already uses a copy-based workflow. The added helper reproduces that workflow and builds fresh frontend/native code:

```powershell
npm run android:build-assistant -- arm64
npm run android:build-assistant -- x86_64
# arm64: wrapper/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk
# x86_64: wrapper/gen/android/app/build/outputs/apk/x86_64/debug/app-x86_64-debug.apk

cd wrapper/gen/android
.\gradlew.bat :alfred-assistant:testDebugUnitTest :alfred-assistant:lintDebug
.\gradlew.bat :app:assembleArm64DebugAndroidTest -x rustBuildArm64Debug -x rustBuildUniversalDebug
.\gradlew.bat :app:assembleX86_64DebugAndroidTest -x rustBuildX86_64Debug -x rustBuildUniversalDebug
```

For a selected device/emulator (never pick the first device implicitly):

```powershell
adb devices -l
adb -s <serial> install -r <matching-app-debug.apk>
adb -s <serial> install -r <matching-app-debug-androidTest.apk>
adb -s <serial> shell am instrument -w com.alfred.app.test/androidx.test.runner.AndroidJUnitRunner
# Optional real authenticated AI request, no mutations requested:
adb -s <serial> shell am instrument -w -e aiSmoke true -e class com.alfred.app.AssistantDocumentTest com.alfred.app.test/androidx.test.runner.AndroidJUnitRunner
# Optional one-second microphone probe, only with the user's existing audio grant:
adb -s <serial> shell am instrument -w -e microphoneSmoke true -e class com.alfred.app.AssistantDocumentTest com.alfred.app.test/androidx.test.runner.AndroidJUnitRunner
# Run registration separately if this host's Tauri Activity teardown crashes the combined runner:
adb -s <serial> shell am instrument -w -e class com.alfred.app.AssistantRegistrationTest com.alfred.app.test/androidx.test.runner.AndroidJUnitRunner
```

The copy workflow requires the existing linker configuration in `wrapper/.cargo/config.toml`. Direct Gradle builds including Rust tasks require an active Tauri CLI options server; use the Tauri command or explicitly compile/copy fresh JNI before skipping those tasks. Never package old JNI and label it a fresh app build. Release signing remains the existing project's deployment concern; debug APKs are not production releases.

Instrumentation launches the regular Activity and tests a real separate **session content view** without selecting a system role. That proves rendering/profile behavior, not system gesture dispatch or a floating window above another app. Those require explicit user selection and the device checklist in the validation record.

On the tested Samsung device, instrumentation stopping the selected assistant's package can leave Android with a dead main voice-service binding even though the component remains selected and its session UI still opens. After instrumentation, check `node scripts/android-assistant-health.js --serial <serial>` and inspect actual capture. If disconnected, open Android digital assistant settings and have the user select None and then Alfred again; do not change their choice or app-ops using shell commands. Do not run instrumentation again after final manual reconnect/voice acceptance. A selected component, a visible floating window, or zero-valued logo-level events alone do not establish working microphone input.
