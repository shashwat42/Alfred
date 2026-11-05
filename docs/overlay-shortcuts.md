# Global overlay shortcuts

On the first Linux launch, Alfred offers **Open Alfred from anywhere**. Record a
keybind (the default is Ctrl+Alt+Space), select **Enable global shortcut**, and
approve or choose the binding in the desktop dialog. Alt+Space is often reserved
by the desktop. **Settings → Global overlay shortcut** shows the binding actually
granted by the desktop, supports changing it, and can disable it. **Set up later**
defers setup until the user enables it in Settings.

Keep Alfred running or minimized for a portal shortcut to work. Closing the Linux
main window quits the app. A desktop custom shortcut whose command is
`alfred --overlay` can also launch a closed app; **Open Keyboard settings** exposes
this fallback when the desktop does not implement the portal.

## Native ownership

`wrapper/src/shortcuts.rs` owns the device configuration and command boundary.
The file `overlay-shortcut.json` lives in Tauri's app configuration directory.
It is independent of accounts, local workspace content and Cloud Sync. Only the
trusted main application window can configure it; the overlay cannot request
new permissions or change keybinds.

Windows and X11 use Tauri's global-shortcut plugin. Rebinding registers the new
shortcut before removing the old one, so a conflict preserves the working
binding. Registration and file errors appear in Settings.

Wayland uses `wrapper/src/shortcuts/portal.rs` and the standard XDG GlobalShortcuts
portal through ashpd. Each binding owns a dedicated D-Bus connection, a registered
`com.alfred.app` host identity, a portal session and signal listeners. The RPM
includes a hidden matching desktop entry so GNOME can identify Alfred without
adding a duplicate launcher.

The native main window is exported for the desktop permission dialog. The initial
binding sends a preferred trigger; the desktop decides the final assignment.
`ShortcutsChanged` updates the displayed assignment. `Activated` is accepted only
for the current session and Alfred's overlay action. Its activation token is
forwarded to GTK so Wayland can focus the overlay in response to the user's
shortcut, including while another application is focused.

Saved enabled settings restore a new session on restart; Alfred does not treat a
saved preference as permission. The desktop can ask again after revocation.
Disabling closes the session and aborts listeners. A closed session or restarted
portal marks the shortcut unavailable and offers retry. Session generations keep
stale events from reactivating a disabled or replaced binding. A single operation
guard prevents duplicate permission dialogs.

Changing an active portal binding opens the desktop's configuration UI. Some
Fedora backends expose `ConfigureShortcuts` while advertising interface version 1,
so Alfred calls the method and handles lack of support without destroying the
current binding. Cancelled or denied initial requests close their temporary
session and can be retried. Unsupported desktops retain the explicit Keyboard
settings fallback; Alfred does not silently edit GNOME's custom shortcuts.

## Verification

- `npm test` covers key capture, stale responses, one request per operation,
  cancellation/retry, disable and deferring setup.
- `npm run test:overlay-shortcut-ui` mounts the actual first-run and Settings UI
  with mocked native IPC. It checks explicit approval, cancellation, recording,
  the authoritative desktop assignment, fallback and disable.
- `cargo test --locked --manifest-path wrapper/Cargo.toml` checks native shortcut
  validation, portal trigger conversion, session/action filtering, trusted origins
  and startup entry escaping.
- A Fedora WebKitGTK snapshot checks that the dark settings selects render their
  selected labels and arrow without a conflicting native light background.

Real desktop acceptance requires user interaction: install the RPM, approve the
system dialog, focus another application and press the granted binding, change
it through the desktop dialog, restart Alfred, then disable it and verify it no
longer activates. Also check cancellation, a reserved binding and portal restart.
Automated tests do not click the user's desktop permission dialog.

Sources: [GlobalShortcuts portal](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.GlobalShortcuts.html),
[host registration](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.host.portal.Registry.html),
[shortcut syntax](https://specifications.freedesktop.org/shortcuts/latest/).
