# Audio migration audit and validation

## Baseline (2026-10-17, before edits)

Repository: React 19 / TypeScript / Vite 8 / Tailwind 4, Tauri 2 with Windows tray,
global shortcuts and transparent overlay, generated Android app plus isolated native
system-assistant library, Express 5 backend with JWT/account lookup and rate limits.
No AGENTS.md was found. Existing user edits: backend env.ts and .env.example, and
an Android Gradle lock; unrelated edits must be preserved.

Main chat and overlay use MediaRecorder with RMS metering, silence detection and a
60-second watchdog. Android system assistant uses native bounded 16-bit mono PCM
(16 kHz, 30-second limit), level events and cancellation through its existing bridge.
All paths previously passed audio to speechManager / speech.worker for local model
inference before submitting text through apiFetch. Main chat push-to-talk staged
text in the composer until Send; hands-free modes auto-submit and repeat.
Chat state is ephemeral React state; overlay clears on dismissal/10-minute idle,
main chat on New Chat/reload, Android on dismissal/account switch/New Conversation.
There was no user-audio playback component. Android spoken replies use system TTS.

Backend sends OpenAI-compatible requests to configured baseUrl + /chat/completions,
with Bearer credentials, max_tokens, tools, and a five-iteration account-scoped tool
loop. Timeout maps to 504; network/auth/credits/general upstream errors to 502;
404/429/503 retain their codes. Fallback eligibility is 504/503/502/429/404, one
attempt per configured candidate, with no delay. Startup probes and successful
fallbacks previously promoted a sticky active model. Working defaults were 3.1
primary / 3.5 fallback, contrary to the requested 3.5 / 3.1 priority. The migration
corrects that priority and prevents probe/fallback promotion across requests;
error classification, candidate count, timeouts and tool loop remain shared.

Baseline checks: frontend production build PASS (chunk-size and existing Tauri
dynamic-import warnings); backend tsc --noEmit PASS; 13 Android assistant Node
tests PASS; cargo check --offline PASS (filesystem hard-link warnings).
No physical-device recording, playback or visual acceptance was established.

## API references

- https://ai.google.dev/gemini-api/docs/openai documents input_audio with base64
  WAV on the existing /v1beta/openai/chat/completions endpoint, choices/message
  parsing and function tools.
- https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite and
  https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite list audio
  input, text output and function calling for both exact configured identifiers.
- https://ai.google.dev/gemini-api/docs/audio documents inline request limits;
  application limits are deliberately lower (12 MiB WAV, 60 seconds).

Documentation establishes format support, not live project quota/model availability.

## Implemented flow

The existing controls acquire the same microphones and retain existing RMS, silence
detection, permissions and watchdogs. Desktop/regular Android MediaRecorder output
is decoded and encoded as PCM16 WAV at its original sample rate/channel count;
there is no model, tensor, transcription, or STT resampling. This conversion is for
the documented WAV compatibility request format. Native Android PCM is wrapped in
a WAV header with sample bytes unchanged. One finalized WAV Blob is shared by
upload and playback. Push-to-talk still stages in the existing composer until Send
(the composer displays “Voice message”); hands-free modes still submit each turn.
Editing the staged composer discards its pending recording and resumes text input.

apiFetch sends bounded multipart audio and JSON context through the new
`/api/ai/chat/audio` route under the existing auth/account lookup and AI/API rate
limiters. The route validates multipart structure, context schema, WAV signatures,
PCM encoding, byte lengths, duration and audible samples before base64 encoding.
No files, recordings or transcripts are written to disk or MongoDB. The existing
generateChatCompletion service receives input_audio parts and uses its same
endpoint, credentials, error mapping, fallback loop, response parser and scoped
function/tool execution. Normal all-text requests keep the original JSON endpoint
and contracts. Recent voice recordings are included as audio context in follow-up
voice and text turns, within the existing message/character limits and audio budget.

`gemini-3.5-flash-lite` is primary and `gemini-3.1-flash-lite` fallback. Both text and
audio try candidates in that order. Existing fallback eligibility (504/503/502/429/404)
and one attempt per candidate remain unchanged. This includes existing mapping of
upstream authentication, credits and unexpected 4xx errors to eligible 502 errors.
Missing local configuration and post-request missing-message parsing errors retain
their prior non-fallback behavior. Primary success never sends a fallback request.
Startup probes/fallback success no longer promote the secondary for later requests;
this is the explicitly documented correction needed to guarantee primary-first
behavior, rather than a claim that the old sticky selection behavior was preserved.

Existing user-message bubbles now contain a small play/pause button and duration.
Playback reads a local Blob URL and imports no API/AI code: it sends no request and
uses no AI tokens. Pause/resume retains the audio element position. Only one note
plays at a time. Recording start, page hiding, document hiding, and player disposal
pause playback. Removal/unmount revokes URLs, unloads media, and removes listeners.
Retry reuses the captured Blob. Synchronous submission guards prevent duplicate
requests; cancelled sessions discard late results. Tracks stop before conversion,
including late permission grants; obsolete decode work cannot clean up newer turns.

No branding, layout CSS, tray/shortcut implementation, navigation, safe-area or
keyboard configuration was changed. A dead overlay transcript pill was removed
because voice submissions now appear in their existing chat positions. Existing
processing-state CSS identifiers containing “transcribing” are intentionally retained
to preserve styling; they perform no transcription. Android TTS replies remain.

## Limits and lifecycle

- Each request carries at most 12 MiB of WAV bytes, including historical recordings.
  Recent audio is prioritized; older audio context can be omitted when the budget
  is reached, while its existing text/assistant context remains.
- Backend accepts PCM16 WAV, 1–2 channels, 8–96 kHz, 250 ms–60.5 seconds. Capture
  limits remain 60 seconds in MediaRecorder and 30 seconds for native assistant
  capture. Very high-rate/channel configurations that exceed the WAV budget fail.
- Native capture remains mono 16 kHz. Browser recording detects supported MIME
  types, then requires Web Audio to decode that format for WAV preparation.
  Physical Windows WebView2/Android WebView codec behavior still needs acceptance.
- Retained session audio is capped at 48 MiB; oldest recordings expire with an
  explicit unavailable label rather than growing memory indefinitely. Clearing a
  conversation or restarting loses its recordings, as expected for ephemeral state.
- Playback works offline while the Blob remains available. Unsupported playback
  is shown as “Audio unavailable”. No continuous listening or permissions were added.
- Gemini keys remain backend-only. No new environment variables. Backend defaults,
  `.env.example`, and this checkout's ignored `.env` now specify 3.5 primary / 3.1
  fallback. Existing endpoint, credentials, provider settings and timeout values remain.
- Downloaded browser model caches/user data were deliberately not removed.

## Validation obtained

| Check | Result |
| --- | --- |
| Frontend `npm run build` / `tsc -b` | PASS; existing chunk-size/Tauri import warnings |
| Frontend `npm test` | PASS, 17 tests |
| Backend `npm run check` | PASS |
| Backend `npm test` | PASS, 20 tests; mocked provider/account lookup, temporary localhost Express server |
| Live `npm run verify:audio-models` | PASS, each exact configured model HTTP 200 with nonempty assistant text from synthetic WAV |
| Windows `cargo check --offline` | PASS; filesystem hard-link warning |
| Android native unit tests | PASS, 4 tests across asset-path and speech-turn detector suites |
| Android instrumentation Kotlin compilation | PASS; device instrumentation was not run |
| `npm run android:build-assistant` | PASS; fresh ARM64 Rust build, frontend and debug APK |
| APK archive inspection | PASS; no speech worker, speech-runtime, ONNX or Whisper asset entries |
| Scoped ESLint on new/changed audio code | No errors; existing Chat exhaustive-deps suppression warnings |
| Repository `npm run lint` | FAIL in unchanged SafeMarkdown.tsx, WheelPicker.tsx and useTasks.ts (3 errors) |
| `git diff --check` | PASS |
| ADB device discovery | No connected physical device or emulator |

The automated tests cover primary/fallback order for text/audio, no fallback after
success, policy-preserving status classification, timeout/network failures, missing
configuration, malformed provider messages, startup probes, multipart auth/account
scope, rejected client account overrides, invalid uploads, exact audio bytes,
follow-up audio context, local pause/resume after upload, URL/listener cleanup,
bounded audio memory, cancellation, microphone release, duplicate capture rejection,
watchdog finalization, voice-state transitions and existing client auth recovery.
The live probes used a synthetic tone, requested no tool mutations, and printed only
model/status/response-presence metadata. Initial sandbox network/localhost/Gradle
cache failures were rerun with access and passed; they are not application failures.

Windows launch/tray/shortcut/overlay interactions, physical microphone permissions,
real speech capture, playback quality, scrolling/keyboard/safe-area appearance and
cross-navigation playback have **not** been physically verified in this migration.
Source inspection and automated platform/configuration tests support layout/workflow
preservation; they do not establish visual or physical-device acceptance. The existing
historical Android validation record is explicitly marked as applying to older builds.
The APK was built and inspected, not installed, and no device roles/settings changed.

## Measured cleanup

Removed `@huggingface/transformers`; npm removed 36 packages including its exclusive
inference dependencies. `npm ls` confirms no Transformers, onnxruntime-web or
onnxruntime-node dependency remains. Deleted 19 packaged ONNX JS/WASM files totaling
52,921,300 bytes and the unused speech manager/worker/types. There were no tracked
model-weight files to remove. The final source/dependency search has no active
Whisper/inference references; the negative APK assertion and historical audit records
are intentional matches.

Uncompressed `dist` measured 56,489,154 bytes before and 2,733,779 bytes after:
53,755,375 bytes removed (about 51.27 MiB). This is not an installed-app/APK reduction
measurement. The ARM64 debug APK is at
`wrapper/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`.

Retained modules: audioRecorder.ts owns browser capture/metering/silence detection;
audio.ts performs WAV preparation; audioPlayback.ts owns temporary playback resources;
voiceCapture.ts validates/wraps native PCM; voicePreferences.ts retains pause settings;
types/audio.ts retains recorder and voice-mode state. Native AssistantVoiceCapture
still owns hardware capture, speech-turn detection and level events.

## File manifest

The following table lists all source/configuration/document changes. Build outputs
and incidental Gradle caches are generated artifacts; the pre-existing user edit to
the 9.8.1 Gradle lock was retained. No unrelated application modules were refactored.

| Change | File | Purpose |
| --- | --- | --- |
| M | `Alfred_Backend/.env.example` | Document requested primary/fallback order. |
| M | `Alfred_Backend/package.json` | Add backend check/test and explicit live audio-probe commands. |
| A | `Alfred_Backend/scripts/verify-audio-models.ts` | Explicit synthetic-WAV live compatibility probe for configured models. |
| M | `Alfred_Backend/src/config/env.ts` | Set requested 3.5/3.1 defaults while retaining configuration parsing. |
| A | `Alfred_Backend/src/modules/ai/audio.test.ts` | Model policy, validation, auth/account and upload regression tests. |
| A | `Alfred_Backend/src/modules/ai/audio.ts` | Bounded multipart/WAV validation and existing-service dispatch. |
| M | `Alfred_Backend/src/modules/ai/route.ts` | Register authenticated/rate-limited multipart route. |
| M | `Alfred_Backend/src/modules/ai/service.ts` | Share audio parts, tools, parsing and fallback; preserve configured priority. |
| M | `docs/android-assistant-validation.md` | Mark earlier device/inference validation as historical. |
| M | `docs/android-system-assistant.md` | Replace obsolete runtime instructions with direct-audio architecture. |
| A | `docs/gemini-audio-migration.md` | Baseline, flow, actual validation, limits, cleanup and file manifest. |
| M | `package-lock.json` | Remove exclusive inference dependency graph using npm. |
| M | `package.json` | Remove Transformers dependency and add combined frontend tests. |
| D | `public/ort/ort-wasm-simd-threaded.jsep.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort-wasm-simd-threaded.jsep.wasm` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort-wasm-simd-threaded.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort-wasm-simd-threaded.wasm` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.all.bundle.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.all.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.all.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.bundle.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.node.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.wasm.bundle.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.wasm.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.wasm.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.webgl.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.webgl.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.webgpu.bundle.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.webgpu.min.mjs` | Remove unused packaged ONNX runtime asset. |
| D | `public/ort/ort.webgpu.mjs` | Remove unused packaged ONNX runtime asset. |
| M | `scripts/tests/android-assistant.test.ts` | Retain platform/auth regressions; test exact WAV upload and follow-ups. |
| A | `scripts/tests/audio.test.ts` | WAV/playback/lifecycle/memory/recording regression tests. |
| M | `src/android/AndroidAssistantApp.tsx` | Submit/play native recordings within existing assistant message flow. |
| M | `src/android/voiceCapture.ts` | Wrap bounded native PCM as exact playable/uploadable WAV. |
| M | `src/components/Chat.tsx` | Direct hands-free audio; stage push-to-talk; render voice notes and guard retries. |
| A | `src/components/VoiceNote.tsx` | Compact play/pause and duration inside existing user bubbles. |
| M | `src/lib/aiChat.ts` | Shared multipart transport, voice metadata, bounded memory and audio context. |
| A | `src/lib/audio.ts` | Minimal WAV encoding/preparation without speech inference. |
| A | `src/lib/audioPlayback.ts` | Local media toggling, coordination and URL/listener cleanup. |
| M | `src/lib/audioRecorder.ts` | Retain capture/RMS/VAD; return Blob and harden lifecycle/watchdog handling. |
| D | `src/lib/speechManager.ts` | Delete unused model loading, inference and STT resampling. |
| M | `src/overlay/OverlayApp.tsx` | Direct audio/voice notes and stale-response cancellation in existing overlay. |
| M | `src/types/audio.ts` | Replace Float32 recording payload with finalized Blob. |
| D | `src/types/speech.ts` | Delete inference-only types. |
| D | `src/workers/speech.worker.ts` | Delete local speech inference worker. |
| M | `wrapper/android/assistant/build.gradle.kts` | Remove exclusive speech-runtime packaging step. |
| M | `wrapper/android/assistant/src/main/java/com/alfred/assistant/AlfredAssistantSession.kt` | Remove obsolete WASM CSP allowance and update capture comments. |
| M | `wrapper/android/assistant/src/main/res/values/bools.xml` | Update obsolete recognition comment; preserve support policy. |
| M | `wrapper/android/assistant/src/test/java/com/alfred/assistant/AssistantAssetPathTest.kt` | Use an active asset-name example. |
| M | `wrapper/gen/android/app/src/androidTest/java/com/alfred/app/AssistantDocumentTest.kt` | Remove obsolete local-model smoke probe. |
| M | `wrapper/gen/android/app/src/androidTest/java/com/alfred/app/AssistantRegistrationTest.kt` | Assert removed inference runtime is absent from packaged assets. |
| M | `wrapper/tauri.conf.json` | Remove exclusive model-download/WASM allowances; retain blob media support. |
| M (local, ignored) | `Alfred_Backend/.env` | Correct this checkout's explicit model priority; no credential changes. |

## Follow-up: waveform voice notes

The shared VoiceNote player now shows 36 amplitude bars from the actual recorded
PCM, with played bars highlighted as playback progresses. The waveform and play
icon form one accessible play/pause button; duration and existing message-bubble
styles remain. This automatically covers main chat, Windows overlay and Android
assistant. Waveforms are calculated locally once per Blob and weakly cached, with
no network, inference, additional AudioContext or retained PCM buffers.

New files: `src/lib/audioWaveform.ts` (PCM amplitude extraction/cache) and
`src/components/VoiceNote.css` (compact shared styling). Updated
`src/components/VoiceNote.tsx` and `scripts/tests/audio.test.ts`. Frontend production
build, 18 frontend tests and scoped ESLint passed. Storage measurements above
describe the migration build before this follow-up UI addition.

The push-to-talk composer also previews its pending recording using the same
playable waveform, replacing the former “Voice message” placeholder. All four
main-chat composer variants support preview/discard/Send. Pending audio is tracked
in reactive state alongside the existing synchronous submission ref; it can be sent
with an empty text input and is cleared on submission, discard or conversation reset.
