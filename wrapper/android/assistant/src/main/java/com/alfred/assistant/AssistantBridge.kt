package com.alfred.assistant

import android.app.Activity
import android.content.Intent
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
        install(view) { type, _ ->
            when (type) {
                "status" -> AssistantAvailability.status(activity)
                "setup" -> {
                    activity.startActivity(Intent(activity, AssistantSetupActivity::class.java))
                    JSONObject().put("opened", true)
                }
                else -> JSONObject().put("error", "Unsupported assistant action.")
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
