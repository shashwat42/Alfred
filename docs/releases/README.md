# Alfred releases

The current release is **Alfred 1.0.01**, packaged as semantic version `1.0.1`
with Git tag `v1.0.1`. Release work uses the `releases/` branch prefix; this
release is prepared on `releases/1.0.01`.

Windows x64 and Fedora Linux x86_64 are updated in this release. Android remains
on the existing signed 1.0.0 APK (version code 1022). Its separate platform
configuration is preserved until a new signed Android build is prepared.

## Validate and package

Run `npm test`, `npm run lint`, `npm run build`,
`npm --prefix Alfred_Backend run check` and backend tests with isolated fixtures.
Backend integration tests require local subprocesses and ephemeral listening
ports. Never point them at the hosted database.

The Windows version must match in `package.json`, `package-lock.json`,
`wrapper/tauri.conf.json`, `wrapper/Cargo.toml` and `wrapper/Cargo.lock`.
Build from the committed release source. On Windows use `npm run release:windows`
with the existing protected updater signing key. The **Prepare Windows release
draft** workflow validates and builds the installer, signature, updater metadata,
checksums and source manifest in a draft GitHub release.

For Fedora, follow [Linux setup](../linux-fedora.md) and run
`npm run build:linux`. The **Fedora Linux** workflow builds an RPM and checksums
from the same commit and runs native Rust tests. Its artifacts include
`SHA256SUMS-linux.txt` and `linux-release-manifest.json`.

## Publish

Use tag `v1.0.1` and title **Alfred 1.0.01**. Verify both builds reference the same
source commit, the Windows updater signature is present, and checksums match the
downloadable files. Attach the Fedora RPM and its checksums/source manifest to
the Windows draft, then publish it as a regular release and mark it latest.
Do not attach an older APK under a new version name.

Deploy the matching backend before publication so Linux's `tauri://localhost`
origin is accepted. **Deploy backend to Oracle** supports manual dispatch from
`releases/` branches as well as the existing automatic deployment from `main`.
The deployment uses the existing protected credentials and readiness checks.

Keep release outputs under ignored `.deployment/releases/`. Preserve developer
app data during installation and upgrade checks. Record actual desktop checks
without claiming automated package checks are physical-device acceptance tests.

Release notes: [Alfred 1.0.01](v1.0.1.md), [Alfred 1.0.0](v1.0.0.md).
