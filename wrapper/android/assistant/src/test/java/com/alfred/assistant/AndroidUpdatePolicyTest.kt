package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class AndroidUpdatePolicyTest {
    @Test fun onlyPinnedRepositoryReleaseDownloadsAreAccepted() {
        assertTrue(AndroidUpdatePolicy.releaseAsset("https://github.com/shashwat42/Alfred/releases/download/v0.1.0-beta.4/Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk"))
        for (url in listOf("http://github.com/shashwat42/Alfred/releases/download/v1/app.apk", "https://github.com.evil/shashwat42/Alfred/releases/download/v1/app.apk", "https://github.com/another/Alfred/releases/download/v1/app.apk", "https://user@github.com/shashwat42/Alfred/releases/download/v1/app.apk", "https://github.com/shashwat42/Alfred/releases/download/v1/../app.apk", "https://github.com/shashwat42/Alfred/releases/download/v1/app.apk?url=evil", "https://github.com/shashwat42/Alfred/releases/download/v1/%2e%2e")) assertFalse(url, AndroidUpdatePolicy.releaseAsset(url))
    }

    @Test fun updateCertificateMustMatchTheInstalledSigner() {
        val installed = "a".repeat(64)
        assertTrue(AndroidUpdatePolicy.matchesCertificate(installed, installed))
        assertFalse(AndroidUpdatePolicy.matchesCertificate(installed, "b".repeat(64)))
        assertFalse(AndroidUpdatePolicy.matchesCertificate(installed, ""))
        assertFalse(AndroidUpdatePolicy.matchesCertificate("", ""))
    }

    @Test fun updatesCannotDowngradeOrSwapPlatformOrInstallerName() {
        val hash = "a".repeat(64)
        assertTrue(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1004, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", hash))
        assertTrue(AndroidUpdatePolicy.validUpdate("1.0.0", 1022, 1021, "Alfred_1.0.0_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("1.0.0", 1022, 1022, "Alfred_1.0.0_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("1.0.0-rc.1", 1022, 1021, "Alfred_1.0.0-rc.1_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1005, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1003, 1004, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1004, "other.apk", hash))
        assertFalse(AndroidUpdatePolicy.validUpdate("0.1.0-beta.4.1", 1005, 1004, "Alfred_0.1.0-beta.4.1_android_arm64-v8a.apk", "not-a-checksum"))
    }
}
