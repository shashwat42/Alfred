# Alfred on Fedora Linux

Fedora Workstation is the primary Linux packaging target. Alfred uses the same
React UI, Tauri shell and existing API as Windows. Linux builds produce an RPM
with an `alfred` executable, application launcher, Quick Overlay launcher action
and `alfred://` OAuth association. Windows and Android keep their own builds.

## Build prerequisites

Use Node.js 24+ and Rust 1.90+ (edition 2024). On Fedora Workstation:

```bash
sudo dnf install gcc gcc-c++ make pkgconf-pkg-config openssl-devel \
  gtk3-devel webkit2gtk4.1-devel libappindicator-gtk3-devel \
  librsvg2-devel libxdo-devel desktop-file-utils xdg-utils gstreamer1-plugins-good
```

Install a current Rust toolchain using [rustup](https://rustup.rs/), or Fedora's
`rust` and `cargo` packages if they satisfy the minimum version. Install Node 24+
and npm through your preferred version manager or Fedora packages. Verify versions
with `node --version` and `rustc --version`. No Windows SDK, WebView2, Android SDK
or Android linker configuration is used for the native Linux target.

```bash
npm ci
npm run linux:check
```

These dependency instructions target mutable Fedora Workstation. Silverblue and
other Atomic desktops need an appropriate development container or layered
packages; the script does not install system packages automatically.

## Develop

Copy `.env.example` to `.env` only if you do not already have one. Set
`VITE_API_BASE_URL` to the backend you intend to use. For a local backend, configure
`Alfred_Backend/.env` using its README, then either start its Docker Compose stack
or use `npm run dev:backend` for Docker plus ngrok. Podman is not automatically
substituted for Docker by that helper. Restart the frontend after endpoint changes.

```bash
npm run dev:linux
```

This launches Tauri with the Vite watcher. `npm run tauri:dev` also works directly.
For a browser-only preview, use `npm run dev`.

## Build and install

Set the API URL before building; it is embedded in the frontend. For a production
package, use the production HTTPS API and `MODE=production`:

```bash
MODE=production VITE_API_BASE_URL=https://your-api.example npm run build:linux
find wrapper/target/release/bundle/rpm -name '*.rpm'
sudo dnf install ./wrapper/target/release/bundle/rpm/<exact-package-name>.rpm
alfred
```

Use the exact newly built RPM path. Install a newer RPM through `dnf install` to
upgrade. Linux uses package-manager upgrades; the Windows in-app updater is not
used. RPM signing is not configured by this change. The default Cargo target
directory is shown above; `CARGO_TARGET_DIR` changes the output location.

The backend must include `tauri://localhost` in its exact CORS origins. This is
included in this version of `Alfred_Backend/src/config/env.ts`; deploy that backend
change before testing Linux against an older server. `ALLOWED_ORIGINS` does not
need a wildcard. Google OAuth still returns through the registered `alfred://`
scheme. Keep `xdg-utils` installed and allow the browser to open Alfred.

## Fedora desktop behavior

- Closing the main Linux window quits Alfred. Minimize it to keep reminders active.
  GNOME does not display AppIndicator tray icons by default; Alfred does not require
  a tray extension to remain accessible. Tray creation failures do not abort startup.
- On Wayland, configure a GNOME custom keyboard shortcut whose command is
  `alfred --overlay`. Select an available key combination; GNOME commonly reserves
  Alt+Space. The launcher also exposes **Quick Overlay**. This works with an already
  running instance or starts Alfred. Automatic global shortcuts are enabled only
  in X11 sessions. Wayland controls positioning and focus, so exact overlay
  placement and always-on-top behavior depend on the compositor.
- **Settings → Startup** writes an XDG autostart entry for the current user.
  Enable it from the installed RPM, since development executables can move.
- Voice input asks for native microphone consent before WebKit capture. Linux uses
  WebKitGTK and the system audio stack; check the input device and mute controls
  in Fedora Settings if capture fails. Camera permission is not granted by this flow.
- Tasks, notes and schedules remain local by default. Cloud Sync and reminder
  requirements are the same as on Windows. Notifications require a running app,
  an available desktop notification service and appropriate desktop settings.

## Verification

```bash
npm test
npm run lint
npm run build
npm --prefix Alfred_Backend run check
cargo test --locked --manifest-path wrapper/Cargo.toml
npm run build:linux
```

The Fedora GitHub Actions workflow builds the RPM and runs Rust tests. Native
acceptance still requires a desktop session: launch from GNOME, create/reopen a
local note, sign in through the browser with Alfred running and closed, deny then
allow microphone access, send text/audio, invoke `alfred --overlay` twice, toggle
startup, deliver a cloud reminder, close/relaunch, and upgrade the RPM while
preserving device data. Check both Wayland and X11 where available.

Sources: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
[RPM packaging](https://v2.tauri.app/distribute/rpm/),
[deep links](https://v2.tauri.app/plugin/deep-linking/) and
[Wayland shortcut tracking](https://github.com/tauri-apps/tauri/issues/3578).
