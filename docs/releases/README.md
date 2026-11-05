# Alfred releases

Alfred 1.0.2 adds configurable overlay shortcuts and fixes Fedora settings
rendering. Release branches use `releases/`; this source is `releases/1.0.2`.
Windows and Fedora packages use matching version `1.0.2` and tag `v1.0.2`.
Android remains on its existing signed 1.0.0 APK.

Run frontend tests, lint, UI checks and native Rust tests before packaging. The
Windows draft workflow builds signed Windows updater assets. Manually dispatch
**Fedora Linux** on the release branch to build and sign the RPM with the same
protected updater key. Ordinary push and pull-request builds do not receive it.

`npm run release:linux` packages clean committed release source with the protected
signing key from the environment. Output is under
`.deployment/linux-releases/v<version>/`. Attach the RPM, signature, Linux update
manifest, checksums and source manifest to the matching Windows draft before
publishing. All artifacts must identify the same source commit. Never rename an
older binary to impersonate a newer version.

See [1.0.2 notes](v1.0.2.md), [Fedora setup](../linux-fedora.md) and
[overlay shortcuts](../overlay-shortcuts.md). Linux in-app installation is not
included in 1.0.2; Linux users install this RPM manually with their package manager.
