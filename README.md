# Alfred

Windows and Android beta release: [release guide](docs/releases/README.md), [0.1.0-beta.6 notes](docs/releases/v0.1.0-beta.6.md) and [in-app updates](docs/app-updates.md).

Backend Docker setup and deployment instructions: [Alfred backend](Alfred_Backend/README.md).

Tasks, notes and schedules use device storage by default. Enable **Settings →
Cloud storage → Cloud Sync** to store content in your cloud account. See
[local storage and cloud sync](docs/local-storage.md) for migration and reminders.

## Local logs and generated files

Keep build, test and diagnostic output in `logs/` (for example,
`npm test > logs/frontend-tests.log 2>&1`). Create the folder before redirecting
output on a fresh checkout. Logs, Gradle caches, compiler state, dependencies and
build output are ignored by Git. Dependency lockfiles and the Android Gradle
wrapper remain tracked so builds can be reproduced.

## Update the installed Windows app

Run `npm run dev:backend` in one terminal for the Atlas-backed container and ngrok.
Then run `npm run dev:pc` from the repository root. It selects the backend URL,
packages a development frontend and debug Windows installer, updates the installed
Alfred app, and launches that installed copy. If Alfred is not installed, it installs
it first. Existing app data is preserved by the installer's update mode.

The Windows Rust/MSVC build tools and WebView2 are required. The first installer
build may download Tauri's NSIS tooling. Keep this command running until the
installer finishes; it may ask to close Alfred if it is already running.

`npm run dev:pc` does not start a Vite server or watch for changes. Run it again to
install your next change. `npm run tauri:dev` remains available for live development.
The normal release build configuration is unchanged.
