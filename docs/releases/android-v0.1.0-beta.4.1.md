# Android beta 4.1

Android-only hotfix distributed as an APK in the existing `v0.1.0-beta.4` GitHub release. Desktop versions and release assets remain at beta 4.

- Notification settings use compact, aligned switches, equal-width delivery choices, full-width selects and visible action buttons on Android.
- Android settings include App updates. Check for updates manually, then choose Download APK to open the repository download in a browser. Open the downloaded APK to install it through Android.
- Update discovery supports Android hotfix manifests alongside an existing release, compares Android version codes and accepts only matching ARM64 APK assets from this repository. Failed checks preserve an already discovered update.
- Open assistant setup opens Android's default-assistant selection settings, falling back to voice-input settings or default-app settings when required by the device.
- APK version `0.1.0-beta.4.1`, version code `1005`, ARM64, Android 7.0/API 24 or newer. System assistant support still requires Android 12 or newer.
- Uses the same Android release certificate as beta 4, allowing an in-place upgrade from that signed APK.

Validation: 48 frontend tests, Android settings interaction checks, lint, TypeScript and development build; 10 native unit tests and Android Kotlin compilation. Notification layout inspected at 320, 393 and 460 CSS pixels with isolated stubs. Release packaging checks the APK version, signing identity, manifest, packaged assets, ARM64 native library and 16 KB alignment. No physical-device install, settings navigation or upgrade was performed.
