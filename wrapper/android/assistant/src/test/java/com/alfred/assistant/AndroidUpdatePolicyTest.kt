package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class AndroidUpdatePolicyTest {
    @Test fun onlyPinnedRepositoryReleaseDownloadsAreAccepted() {
        assertTrue(AndroidUpdatePolicy.releaseAsset("https://github.com/shashwat42/Alfred/releases/download/v0.1.0-beta.4/Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk"))
        for (url in listOf("http://github.com/shashwat42/Alfred/releases/download/v1/app.apk", "https://github.com.evil/shashwat42/Alfred/releases/download/v1/app.apk", "https://github.com/another/Alfred/releases/download/v1/app.apk", "https://user@github.com/shashwat42/Alfred/releases/download/v1/app.apk", "https://github.com/shashwat42/Alfred/releases/download/v1/../app.apk", "https://github.com/shashwat42/Alfred/releases/download/v1/app.apk?url=evil", "https://github.com/shashwat42/Alfred/releases/download/v1/%2e%2e")) assertFalse(url, AndroidUpdatePolicy.releaseAsset(url))
    }

    @Test fun androidHotfixManifestsAreDistinctFromWindowsUpdaterAssets() {
        assertTrue(AndroidUpdatePolicy.manifestName("android-release-manifest.json"))
        assertTrue(AndroidUpdatePolicy.manifestName("android-beta.4.1-release-manifest.json"))
        assertFalse(AndroidUpdatePolicy.manifestName("release-manifest.json"))
        assertFalse(AndroidUpdatePolicy.manifestName("latest.json"))
    }

    @Test fun updatesCannotDowngradeOrSwapPlatformOrInstallerName() {
        val hash = "a".repeat(64)
        assertTrue(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1004, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1005, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1003, 1004, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1004, "other.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1004, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", "not-a-checksum"))
    }
}
