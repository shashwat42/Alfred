# Alfred

Windows beta release: [release guide](docs/releases/README.md) and [0.1.0-beta.1 notes](docs/releases/v0.1.0-beta.1.md).

Backend Docker setup and deployment instructions: [Alfred backend](Alfred_Backend/README.md).

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
