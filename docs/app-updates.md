# Desktop in-app updates

The main desktop window checks GitHub on startup and every six hours. Settings
provides a manual check and downloads/installs only on a button click. The update
controller survives navigating away from Settings and prevents overlapping
checks, downloads and installations. Network and verification errors preserve the
existing app and allow retry.

## Windows installation

Native code queries the public GitHub releases API, including all pages, and
selects the highest semantic version above the installed version. Published beta
releases participate; drafts, malformed versions and releases without a
`latest.json` asset are ignored. Manifest and installer URLs must belong to this
repository's GitHub release downloads. Native commands accept no arbitrary URLs
and are restricted to the main window's trusted app origin.

Tauri downloads the installer, verifies its signature with the embedded public
key and requires the signature's version to match the manifest. Only then does
it launch the NSIS updater in passive mode, exit Alfred and restart after install.
Browser previews do not offer desktop updates. Android keeps its separate APK
update flow. Desktop updates do not change backend deployment.

## Linux RPM installation

Starting with 1.0.3, **Settings → App updates → Check for updates** also supports
installed Linux RPMs. Earlier Linux builds need one manual RPM upgrade to obtain
the updater; an already installed binary cannot acquire this feature remotely.

Linux checks published releases for `linux-update.json` and an RPM matching its
version and architecture (`x86_64` or `aarch64`). Drafts, older versions, unrelated
asset URLs and releases without matching Linux assets are ignored. Manifest and
RPM URLs must match the exact repository, release tag and expected filename.
The download is bounded to 128 MB. Size, SHA-256, the pinned Minisign/Ed25519
signature and its signed version are verified before installation. The RPM
header must also identify the `alfred` package with the expected version and
architecture. Checksums alone do not authorize an update.

Installation requires an explicit click. Alfred confirms it is running from an
installed Alfred RPM, checks the installed RPM version to prevent downgrade or
duplicate installation, downloads and verifies the file, then invokes PackageKit
over the system bus. The desktop's administrator authorization flow remains in
control. No shell command or password is embedded in the app. PackageKit resolves
dependencies and reports its actual transaction result. Alfred restarts only
after a successful `Finished` signal; cancellation and errors remain retryable.
If installer completion is uncertain, the staged file is retained and the user
is asked to check the software manager before retrying.

Linux must have PackageKit and a desktop authorization agent. The RPM declares
the PackageKit dependency. Development executables, AppImages and other package
formats do not install RPM updates through this flow. App data and account
workspaces remain outside the package installation directory.

## Release signing and assets

The GitHub workflow obtains `TAURI_SIGNING_PRIVATE_KEY` and optional
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` from GitHub Actions secrets. No private key
or password is in source or workflow literals. The public verification key in
`wrapper/tauri.conf.json` is intentionally distributable. The initial key was
generated into ignored `.deployment/windows-updater.key`; keep a secure backup
because GitHub cannot return the plaintext secret and existing installs trust
this key. Do not rotate it without an updater migration plan.

`npm run release:windows` requires the private key in the process environment
(CI supplies it from secrets). It creates the installer, its `.sig`, a Tauri
`latest.json` manifest, checksums, release notes and source manifest. The draft
release workflow uploads all five assets. Publishing the draft exposes it to
update checks; a draft alone never makes an update available to installed apps.
The signature covers the installer and version. Windows Authenticode signing is
separate and remains unconfigured.

For Linux, run `npm run release:linux` from clean, committed release source on a
Linux build host with the same protected signing key. It builds production code
with a restricted API CSP, signs the actual RPM using `--app-version`, and writes
the RPM, `.sig`, `linux-update.json`, checksums and source manifest beneath
`.deployment/linux-releases/v<version>/`. This updater signature is separate from
RPM/GPG package signing. Keep the existing public key trusted by installed apps.

The **Fedora Linux** workflow signs only on explicit manual dispatch from a
`releases/` branch. Push and pull-request builds do not receive the signing key
or produce trusted update metadata. Download the `alfred-linux-signed-release`
artifact and attach all its files to the matching GitHub release before
publication. A draft or an unsigned RPM alone never appears as an update.
When publishing multiple architectures, merge their `platforms` entries into one
`linux-update.json` for the same version; preserve each package's signature.

The first updater-enabled installer is 0.1.0-beta.2. Users of beta.1 must install
it manually once; adding updater code cannot retrofit an already installed binary.

Beta.3 fixes first-run account selection: all windows restore sessions without
creating guests, and both onboarding and the overlay wait for an explicit guest
choice or verified Google account. An existing unconfirmed guest is reused after
confirmation, and the choice is remembered for later launches.

Beta.4 creates the desktop overlay on demand, releases its renderer on explicit
dismissal, and loads only the selected window surface. Hidden/minimized Windows
views request lower WebView2 memory use without suspending reminder timers.

## Verification

Use `MODE=development` for `npm test`, `npm run test:updates-ui`, `npm run lint`,
`npm run build:development` and `cargo test --manifest-path wrapper/Cargo.toml
--locked --lib updates::tests`. Tests cover semantic version ordering, ignoring
drafts and unsafe assets, concurrent operations, explicit installation, progress,
retry paths, UI states and escaped release notes. Automated tests never install
an update or use real account data.

Before publication, use an isolated Windows profile/VM to test installation and
restart from one updater-enabled version to a higher published signed version,
offline/rate-limit errors, a corrupt/signature-mismatched package and preservation
of local app data. No actual self-update is run against the developer's profile.

On Linux, native tests additionally verify signed payloads and signed version
binding, metadata and RPM-header rejection, and PackageKit completion handling.
The installer protocol test runs against a fake service on a private D-Bus bus:

```bash
dbus-run-session -- cargo test --locked --manifest-path wrapper/Cargo.toml --lib updates::packagekit::tests::private_bus_install_waits_for_success_and_reports_cancel_and_failure -- --ignored
```

It never contacts the real system installer. Physical acceptance still requires
a published signed newer RPM and the user's desktop authorization; automated
tests do not replace the developer's installed application.
