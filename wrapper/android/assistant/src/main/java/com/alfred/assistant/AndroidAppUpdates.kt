package com.alfred.assistant

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

object AndroidAppUpdates {
    private data class Update(val version: String, val code: Long, val url: String)
    private val executor = Executors.newSingleThreadExecutor()
    private val checking = AtomicBoolean(false)
    @Volatile private var available: Update? = null

    private fun read(initial: String, deadline: Long): String {
        var url = URI(initial)
        repeat(6) {
            val remaining = (deadline - SystemClock.elapsedRealtime()).coerceAtMost(8_000).toInt()
            check(remaining > 0) { "Update check timed out" }
            check(url.scheme == "https" && url.host in setOf("api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"))
            val connection = url.toURL().openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = remaining
                connection.readTimeout = remaining
                connection.setRequestProperty("User-Agent", "Alfred-Android-Updater")
                val status = connection.responseCode
                if (status in 300..399) {
                    url = url.resolve(connection.getHeaderField("Location") ?: error("Missing download location"))
                } else {
                    check(status == 200) { "GitHub update check failed ($status). Try again later." }
                    val output = ByteArrayOutputStream()
                    connection.inputStream.use { input ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            check(SystemClock.elapsedRealtime() < deadline) { "Update check timed out" }
                            val count = input.read(buffer)
                            if (count < 0) break
                            check(output.size() + count <= 1_048_576) { "Update information is too large" }
                            output.write(buffer, 0, count)
                        }
                    }
                    return output.toString("UTF-8")
                }
            } finally { connection.disconnect() }
        }
        error("Too many update redirects")
    }

    fun check(activity: Activity, complete: (JSONObject) -> Unit) {
        if (!checking.compareAndSet(false, true)) {
            complete(JSONObject().put("error", "An update check is already running.")); return
        }
        executor.execute {
            val deadline = SystemClock.elapsedRealtime() + 45_000
            val response = try {
                @Suppress("DEPRECATION")
                val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
                @Suppress("DEPRECATION")
                val currentCode = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
                var newest: Update? = null
                if (Build.SUPPORTED_ABIS.contains("arm64-v8a")) {
                    val releases = JSONArray(read("https://api.github.com/repos/shashwat42/Alfred/releases?per_page=20", deadline))
                    var manifests = 0
                    for (index in 0 until releases.length()) {
                        val release = releases.getJSONObject(index)
                        if (release.optBoolean("draft")) continue
                        val assets = release.optJSONArray("assets") ?: continue
                        for (assetIndex in 0 until assets.length()) {
                            val asset = assets.getJSONObject(assetIndex)
                            val manifestUrl = asset.optString("browser_download_url")
                            if (!AndroidUpdatePolicy.manifestName(asset.optString("name")) || !AndroidUpdatePolicy.releaseAsset(manifestUrl)) continue
                            if (++manifests > 20) break
                            val manifest = JSONObject(read(manifestUrl, deadline))
                            val version = manifest.optString("version")
                            val code = manifest.optLong("versionCode")
                            val apk = manifest.optString("apk")
                            if (manifest.optString("applicationId") != activity.packageName ||
                                manifest.optString("architecture") != "arm64-v8a" ||
                                manifest.optInt("minSdk", Int.MAX_VALUE) > Build.VERSION.SDK_INT ||
                                !AndroidUpdatePolicy.validUpdate(version, code, currentCode, apk, manifest.optString("sha256"))) continue
                            for (apkIndex in 0 until assets.length()) {
                                val apkAsset = assets.getJSONObject(apkIndex)
                                val apkUrl = apkAsset.optString("browser_download_url")
                                if (apkAsset.optString("name") == apk && AndroidUpdatePolicy.releaseAsset(apkUrl) &&
                                    URI(apkUrl).rawPath.substringBeforeLast('/') == URI(manifestUrl).rawPath.substringBeforeLast('/') &&
                                    code > (newest?.code ?: currentCode)) newest = Update(version, code, apkUrl)
                            }
                        }
                    }
                }
                available = newest
                JSONObject().put("currentVersion", info.versionName ?: "Unknown")
                    .put("update", newest?.let { JSONObject().put("version", it.version).put("versionCode", it.code) } ?: JSONObject.NULL)
            } catch (_: Exception) {
                JSONObject().put("error", "Could not check Android updates. Check your connection or try again later.")
            } finally { checking.set(false) }
            activity.runOnUiThread { complete(response) }
        }
    }

    fun openDownload(activity: Activity): JSONObject {
        val update = available ?: return JSONObject().put("error", "Check for an available update first.")
        if (!AndroidUpdatePolicy.releaseAsset(update.url)) return JSONObject().put("error", "Invalid update download.")
        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(update.url)).addCategory(Intent.CATEGORY_BROWSABLE))
        return JSONObject().put("opened", true)
    }
}
