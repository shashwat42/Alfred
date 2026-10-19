# Windows and Android beta release

The current beta is `v0.1.0-beta.6`, for Windows x64 and Android ARM64. The desktop version lives in
`package.json`, `package-lock.json`, `wrapper/tauri.conf.json`, `wrapper/Cargo.toml`
and `wrapper/Cargo.lock`. The separately deployed backend has its own version.

Android uses the same beta version in `wrapper/tauri.android.conf.json`, with
monotonically increasing version code `1009`. Package a non-debuggable release APK
using the existing protected Android release keystore, verify its certificate,
packaged version, HTTPS endpoint and 16 KB alignment, and include it with
`android-release-manifest.json` and `SHA256SUMS-android.txt` in the same GitHub
prerelease. Preserve the existing certificate to support in-place upgrades.

## Validate in development mode

Set `MODE=development`, then run `npm test`, `npm run lint`,
`npm --prefix Alfred_Backend run check`, `npm --prefix Alfred_Backend test`,
`npm run test:reliability-ui`, `npm run test:updates-ui`, `npm run test:startup-ui`,
`npm run test:overlay-lifecycle`, `npm run test:assistant-controls-ui`,
`npm run test:storage-ui` and `npm run build:development`.
Backend tests use temporary MongoDB replica sets and stub AI providers. They need
permission to start local processes and listen on ephemeral ports. Use the dummy
environment from `.github/workflows/deploy-oracle.yml` and generate ephemeral
JWT/Google test secrets rather than supplying real credentials.
Leave `ALFRED_NOTIFICATION_TEST_MONGODB_URI` unset so notification tests use a
temporary database. Never point integration tests at the hosted database.

## Package

On Windows with Node 24, npm dependencies and Rust/MSVC build tools installed:

```powershell
npm run release:windows
```

The command requires `TAURI_SIGNING_PRIVATE_KEY` in its process environment.
The CI workflow inherits this from the GitHub Actions secret of the same name;
an optional password comes from `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. See
[updater signing](../app-updates.md#release-signing-and-assets) for key management.

This performs the actual release packaging, with production frontend behavior,
an explicit x64 target, the hosted HTTPS API and a CSP restricted to that API.
It does not start or deploy a backend, install the app or modify local environment
files. `ALFRED_RELEASE_API_URL` may override the HTTPS API origin explicitly.
Existing `.env` tunnel and development-mode settings cannot override this build.

Find the installer, its `.sig`, `latest.json`, `SHA256SUMS.txt`, release notes and source manifest in
`.deployment/releases/v0.1.0-beta.6/`. The directory is ignored by Git. Existing
version output is preserved; move it aside deliberately before rebuilding.
The manifest records the source commit and whether source changes were present
(including untracked files; generated caches and logs are ignored by Git).
For a published release, commit the intended changes, create the version tag and
build again from that exact tag. Do not publish an uncommitted local candidate.

## Acceptance and publication

For a clean CI build, push the reviewed source changes and manually run
**Prepare Windows beta draft** in GitHub Actions on the intended release branch.
The workflow runs development checks on Linux, packages on Windows and creates a
draft prerelease with the installer and checksums. It does not publish the draft
or overwrite an existing release. GitHub Actions must have permission to create
releases. Review the draft after completing the acceptance checks below.

Use a separate Windows profile or VM to avoid altering the developer's app data.
Check clean installation, launch, guest continuation, Google browser sign-in and
deep-link return, note/task/schedule creation, text and voice responses,
microphone denial and retry, notifications while running, tray/overlay behavior,
restart persistence and upgrade from an existing install. Record actual results
before removing the release-notes testing caveat. Public `/health` and `/ready`
responses confirm API/database availability only.

Check the installer's signature with `Get-AuthenticodeSignature` and its checksum
with `Get-FileHash -Algorithm SHA256`. This beta currently has no configured signing
certificate. For a signed build, configure the Tauri Windows signing settings
using credentials outside source control, then rebuild and regenerate checksums.

Create a **draft GitHub prerelease** titled `Alfred v0.1.0-beta.6` using the tag
`v0.1.0-beta.6`. Paste the version's notes and attach the installer, its `.sig`,
`latest.json`, `SHA256SUMS.txt` and `release-manifest.json`. Mark it as a prerelease and review
the assets and acceptance results before publishing to testers.

Changes to `Alfred_Backend/**` merged/pushed to `main` trigger the existing Oracle
deployment workflow. Review that separately when committing lint cleanup; a
desktop beta does not require redeploying the backend.

Beta 6 requires the matching backend deployed before publication: local AI tools,
Cloud Sync and cloud profiles use new account-scoped endpoints.
