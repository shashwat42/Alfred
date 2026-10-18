# Windows in-app updates

The main Windows window checks GitHub on startup and every six hours. Settings
provides a manual check and downloads/installs only on a button click. The update
controller survives navigating away from Settings and prevents overlapping
checks, downloads and installations. Network and verification errors preserve the
existing app and allow retry.

Native code queries the public GitHub releases API, including all pages, and
selects the highest semantic version above the installed version. Published beta
releases participate; drafts, malformed versions and releases without a
`latest.json` asset are ignored. Manifest and installer URLs must belong to this
repository's GitHub release downloads. Native commands accept no arbitrary URLs
and are restricted to the main window's trusted app origin.

Tauri downloads the installer, verifies its signature with the embedded public
key and requires the signature's version to match the manifest. Only then does
it launch the NSIS updater in passive mode, exit Alfred and restart after install.
There is no browser/Android update path and no change to backend deployment.

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

The first updater-enabled installer is 0.1.0-beta.2. Users of beta.1 must install
it manually once; adding updater code cannot retrofit an already installed binary.

Beta.3 fixes first-run account selection: all windows restore sessions without
creating guests, and both onboarding and the overlay wait for an explicit guest
choice or verified Google account. An existing unconfirmed guest is reused after
confirmation, and the choice is remembered for later launches.

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
