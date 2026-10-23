# Windows and Android official release

The current stable release is `v1.0.0`, for Windows x64 and Android ARM64.
Beta testing is complete. The version lives in `package.json`, `package-lock.json`,
`wrapper/tauri.conf.json`, `wrapper/tauri.android.conf.json`, `wrapper/Cargo.toml`
and `wrapper/Cargo.lock`. The separately deployed backend has its own version.
Android version code is `1022`; preserve the existing protected Android release
certificate for in-place upgrades.

## Validate in development mode

Set `MODE=development`, then run `npm test`, `npm run lint`,
`npm --prefix Alfred_Backend run check`, `npm --prefix Alfred_Backend test`,
`npm run test:reliability-ui`, `npm run test:updates-ui`, `npm run test:startup-ui`,
`npm run test:overlay-lifecycle`, `npm run test:assistant-controls-ui`,
`npm run test:storage-ui`, `npm run test:workspace-ui`, `npm run test:profile-ui`,
`npm run test:monitor-ui` and `npm run build:development`.
Run native Windows updater and Android assistant unit tests in development mode.
Backend tests use temporary MongoDB replica sets and stub AI providers. Use dummy
configuration and ephemeral JWT/Google test secrets. Leave
`ALFRED_NOTIFICATION_TEST_MONGODB_URI` unset; never use the hosted database.

## Package and publish

Commit the release source and create `v1.0.0`. Build both platforms from that exact
clean tag. On Windows with Node 24 and Rust/MSVC tools, run
`npm run release:windows` with `TAURI_SIGNING_PRIVATE_KEY` and its optional password
supplied from protected storage. See [updater signing](../app-updates.md#release-signing-and-assets).
Actual release packaging uses production frontend behavior and the hosted HTTPS
API; it does not start or deploy a backend or alter developer app data.

Output is `.deployment/releases/v1.0.0/`. Preserve existing output rather than
overwriting it. Verify the installer signature, checksums and source manifest.
No Windows Authenticode certificate is currently configured; updater signatures
are separate. Package a non-debuggable Android ARM64 release APK using the existing
release keystore and verify its certificate, packaged version, HTTPS endpoint and
16 KB alignment.

The **Prepare Windows release draft** workflow validates in development mode and
packages Windows assets into a draft. Stable versions omit the prerelease flag;
numbered beta versions remain supported. Attach the Android assets before
publication. The final release must contain the Windows installer, its `.sig`,
`latest.json`, `SHA256SUMS.txt`, `release-manifest.json`, Android APK,
`SHA256SUMS-android.txt` and `android-release-manifest.json`.

Publish **Alfred v1.0.0** with tag `v1.0.0` as a regular release and mark it latest.
Use [1.0.0 notes](v1.0.0.md). Earlier Android betas require downloading the stable
APK manually because their update checker accepts beta version names only.
The matching certificate supports upgrading in place. Windows beta installations
with the signed updater can discover 1.0.0 through their existing release checks.

For installation and upgrade checks, use a separate Windows profile/VM or test
Android device. Preserve the developer's app data. Record actual checks without
claiming automated package checks are device acceptance testing.

Backend changes pushed to `main` trigger the Oracle deployment workflow. This
release uses the existing compatible backend and does not require a redeployment.
