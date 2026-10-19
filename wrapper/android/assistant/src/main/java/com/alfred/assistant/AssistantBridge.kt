package com.alfred.assistant

import android.app.Activity
import android.net.Uri
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.lang.ref.WeakReference

object AssistantBridge {
    // Matches the existing Tauri Android origin; do not migrate account storage.
    const val ORIGIN = "http://tauri.localhost"
    const val NAME = "AlfredAndroid"
    private var mainView = WeakReference<WebView>(null)

    fun trusted(uri: Uri): Boolean = uri.scheme == "http" && uri.host == "tauri.localhost" && uri.port == -1 && uri.userInfo == null

    fun install(view: WebView, handler: (String, JSONObject) -> JSONObject): Boolean {
        return installAsync(view) { type, request, complete -> complete(handler(type, request)) }
    }

    fun installAsync(view: WebView, handler: (String, JSONObject, (JSONObject) -> Unit) -> Unit): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(view, NAME, setOf(ORIGIN)) { _, message, source, mainFrame, reply ->
            if (!mainFrame || !trusted(source)) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            if (data.length > 256) return@addWebMessageListener
            try {
                val request = JSONObject(data)
                val id = request.optString("id")
                if (!id.matches(Regex("[a-zA-Z0-9-]{1,64}"))) return@addWebMessageListener
                val type = request.optString("type")
                val complete: (JSONObject) -> Unit = { result ->
                    // Capture can finish after dismissal. Never reply into a destroyed document.
                    if (view.parent != null) reply.postMessage(result.put("id", id).toString())
                }
                try { handler(type, request, complete) }
                catch (_: Exception) { complete(JSONObject().put("error", "Android could not complete this action.")) }
            } catch (_: Exception) { /* Invalid or binary messages receive no native access. */ }
        }
        return true
    }

    fun installMain(activity: Activity, view: WebView) {
        mainView = WeakReference(view)
        activity.window.setSoftInputMode(if (android.os.Build.VERSION.SDK_INT >= 30) android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING else android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        if (android.os.Build.VERSION.SDK_INT >= 30) view.setOnApplyWindowInsetsListener { _, insets ->
            val keyboard = insets.getInsets(android.view.WindowInsets.Type.ime()).bottom
            val system = insets.getInsets(android.view.WindowInsets.Type.systemBars()).bottom
            val cssPixels = ((keyboard - system).coerceAtLeast(0) / view.resources.displayMetrics.density).toInt()
            view.evaluateJavascript("document.documentElement.style.setProperty('--keyboard-inset', '${cssPixels}px')", null)
            insets
        }
        ScheduleNotifications.install(activity, view)
        installAsync(view) { type, _, complete ->
            when (type) {
                "status" -> complete(AssistantAvailability.status(activity))
                "setup" -> activity.runOnUiThread {
                    complete(if (AssistantAvailability.openSetup(activity)) JSONObject().put("opened", true)
                        else JSONObject().put("error", "Open Android Settings → Apps → Default apps → Digital assistant to select Alfred."))
                }
                "checkUpdates" -> AndroidAppUpdates.check(activity, complete)
                "downloadUpdate" -> complete(AndroidAppUpdates.openDownload(activity))
                else -> complete(JSONObject().put("error", "Unsupported assistant action."))
            }
        }
    }

    fun stopMainVoice() {
        mainView.get()?.let { view -> view.post {
            if (view.url?.let { trusted(Uri.parse(it)) } == true) {
                view.evaluateJavascript("window.dispatchEvent(new Event('alfred:android_assistant_opened'))", null)
            }
        } }
    }
}
