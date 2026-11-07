# Alfred releases

Alfred 1.0.31 adds device-specific schedule reminders, background operation on
Linux and click-outside dismissal for Quick Overlay. The Windows and Fedora
packages use release branch `releases/1.0.31` and Git tag `v1.0.31`.
Android packages are built and signed separately.

Merge features into `main` before cutting a release. Tag the exact commit
that ships. Use release branches to stabilize or maintain a version, and
merge or cherry-pick fixes from those branches back into `main`.

## Validate and package

Run frontend tests, lint, UI checks and native Rust tests before packaging. The
Windows draft workflow validates and builds the installer, updater signature,
`latest.json`, checksums and source manifest. Use the same clean release commit
for the Windows and Fedora builds.

Manually dispatch **Fedora Linux** on the release branch to build and sign its
RPM with the existing protected updater key. Ordinary push and pull-request
builds never receive the key. The signed artifact is named
`alfred-linux-signed-release`. Linux packaging can also be run with
`npm run release:linux` from clean committed source with the protected key in the
environment. Output lives under `.deployment/linux-releases/v<version>/`.

Native installer protocol tests use a fake PackageKit service on a private
D-Bus session. They do not install updates on the build machine. Physical
upgrade acceptance requires user interaction with the desktop authorization.

## Publish

Attach the Fedora RPM, `.sig`, `linux-update.json`, checksums and Linux source
manifest to the matching Windows draft. Verify both source manifests, hashes and
pinned-key signatures before publishing the regular GitHub release and marking
it latest. Never relabel an older package with a new version name.

Linux clients running 1.0.3 or later require a newer published version with signed
Linux updater metadata. Earlier Linux versions need one manual bootstrap upgrade.
Windows keeps its existing signed updater. Do not attach the older Android APK
under a newer version name.

See [desktop app updates](../app-updates.md), [Fedora setup](../linux-fedora.md),
and the [1.0.31 notes](v1.0.31.md).
