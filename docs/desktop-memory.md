# Desktop memory optimization — 18 October 2026

The desktop overlay is now created on first use instead of at application startup.
Explicit dismissal (Escape/close) destroys the overlay WebView after resetting its
session. Alt+Space and the tray toggle still hide/show the existing overlay and
preserve its conversation; hidden voice mode is unmounted, releasing capture and
aborting its active request, and resumes when summoned again.

Each WebView loads only its selected surface: main app, desktop overlay, or Android
assistant. The main app continues to own schedule notifications and update checks.
Windows views request WebView2's low memory target when hidden/minimized and return
to the normal target on activation/restore. JavaScript is not suspended, so reminder
timers remain available. Older WebView2 versions without the optional interface
continue normally. Asynchronous overlay subscriptions are cleaned up even when
React StrictMode unmounts before listener registration finishes. Quick-input
requests and queued prompts are released on unmount.

## Measurements

Read-only process measurements used a separate development profile at its welcome
screen, with no guest creation, sign-in, content writes, microphone permission, or
AI calls. The installed Alfred instance remained running with its existing data.
The eager-start comparison enabled the configured hidden overlay at startup; both
variants used the new surface-specific frontend. These samples isolate the cost
of eager overlay creation rather than quantify all changes against the old app.

| State | Renderers | Private committed memory | Summed working set |
| --- | ---: | ---: | ---: |
| Eager hidden overlay at startup | 2 | 255.14 MiB | 496.36 MiB |
| On-demand overlay at startup | 1 | 193.76 MiB | 397.53 MiB |
| Overlay opened in a subsequent run | 2 | 220.73 MiB | 467.21 MiB |
| Overlay dismissed in that same run | 1 | 186.96 MiB | 403.41 MiB |
| Main window minimized after dismissal/reopening checks | 1 | 188.52 MiB | 349.84 MiB |

The startup sample used about 24% less private committed memory. These are single
development snapshots, not guarantees or a long-running workload benchmark. Summed
working sets include shared pages and must not be compared directly to Task
Manager's default Memory column. The measurement script counts the native host and
matching browser/GPU/renderer/utility processes; it excludes the separate crash
handler. It never enumerates user records or prints browser command lines.

Run `powershell -NoProfile -File scripts/measure-desktop-memory.ps1` for the normal
app. Optional `-AppIdentifier` selects an isolated profile, and `-OutputPath` saves
aggregate JSON. Windows may require permission to inspect the process inventory.
Local audit samples/configurations are under ignored `.deployment/performance/`.

## Validation

- 48 frontend tests passed with MODE=development.
- Startup/authentication UI checks passed using mocked fetches.
- `npm run test:overlay-lifecycle` passed with stubbed native events and capture:
  hide cancels recording, summon resumes, dismissal closes, and root/quick-input
  subscriptions are removed under StrictMode.
- TypeScript, targeted ESLint, Rust compilation, development frontend build,
  development native builds, changed Rust formatting, and diff whitespace passed.
- Native isolated UI checks confirmed cold overlay creation, Escape destruction,
  recreation after dismissal, and minimizing/restoring the main window.

The native lifecycle audit used a temporarily substituted shortcut so it would
not conflict with the installed app; source Alt+Space was restored automatically.
The app's existing protocol registration was preserved/restored, and only the
isolated audit process was stopped. No installer was run, no production service
was started, and no Git commits or pushes were made. The installed binary does
not include these changes until rebuilt/installed. Signed-in real microphone/AI
use and long-duration memory profiling remain unmeasured.
