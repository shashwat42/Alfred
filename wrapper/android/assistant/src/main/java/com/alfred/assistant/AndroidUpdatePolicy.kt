package com.alfred.assistant

import java.net.URI

/** Download destinations are repository assets, never URLs supplied by a web document. */
object AndroidUpdatePolicy {
    fun releaseAsset(url: String): Boolean = try {
        val uri = URI(url)
        uri.scheme == "https" && uri.host == "github.com" && uri.port == -1 &&
            uri.userInfo == null && uri.query == null && uri.fragment == null &&
            uri.rawPath.matches(Regex("/shashwat42/Alfred/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+")) &&
            uri.path.split('/').none { it == "." || it == ".." }
    } catch (_: Exception) { false }

    fun manifestName(name: String) = name.matches(Regex("android(?:-beta\\.\\d+(?:\\.\\d+)?)?-release-manifest\\.json"))

    fun validUpdate(version: String, code: Long, currentCode: Long, apk: String, sha256: String): Boolean =
        code > currentCode && code <= 2_100_000_000L &&
            version.matches(Regex("\\d+\\.\\d+\\.\\d+(?:-beta\\.\\d+(?:\\.\\d+)?)?")) &&
            apk == "Alfred_${version}_android_arm64-v8a.apk" &&
            sha256.matches(Regex("[a-f0-9]{64}"))
}
