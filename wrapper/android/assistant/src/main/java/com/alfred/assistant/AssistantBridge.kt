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
        fun publishViewport() {
            if (view.height <= 0) return
            val insets = view.rootWindowInsets ?: return
            val location = IntArray(2)
            view.getLocationOnScreen(location)
            val window = if (android.os.Build.VERSION.SDK_INT >= 30) activity.windowManager.currentWindowMetrics.bounds else {
                val rootLocation = IntArray(2)
                view.rootView.getLocationOnScreen(rootLocation)
                android.graphics.Rect(rootLocation[0], rootLocation[1], rootLocation[0] + view.rootView.width, rootLocation[1] + view.rootView.height)
            }
            val modern = android.os.Build.VERSION.SDK_INT >= 30
            val system = if (modern) insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout()) else null
            val visibleFrame = android.graphics.Rect()
            view.getWindowVisibleDisplayFrame(visibleFrame)
            val keyboardVisible = if (modern) insets.isVisible(android.view.WindowInsets.Type.ime()) else window.bottom - visibleFrame.bottom > 100 * view.resources.displayMetrics.density
            // Older Android versions use adjustResize, so the WebView already excludes the IME.
            val keyboard = if (modern) insets.getInsets(android.view.WindowInsets.Type.ime()).bottom else 0
            val bounds = mainViewportBounds(location[1], view.height, window.top, window.bottom, system?.top ?: insets.systemWindowInsetTop, system?.bottom ?: insets.systemWindowInsetBottom, keyboard, keyboardVisible)
            val density = view.resources.displayMetrics.density
            view.evaluateJavascript("""
                (() => {
                    const root = document.documentElement;
                    if (!root) return;
                    root.style.setProperty('--android-viewport-height', '${bounds.height / density}px');
                    root.style.setProperty('--android-safe-top', '${bounds.safeTop / density}px');
                    root.style.setProperty('--android-safe-bottom', '${bounds.safeBottom / density}px');
                    root.dataset.androidKeyboard = '$keyboardVisible';
                })()
            """.trimIndent(), null)
        }
        view.setOnApplyWindowInsetsListener { _, insets -> view.post { publishViewport() }; insets }
        view.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> view.post { publishViewport() } }
        view.post { view.requestApplyInsets(); publishViewport() }
        ScheduleNotifications.install(activity, view)
        installAsync(view) { type, _, complete ->
            when (type) {
                "viewport" -> activity.runOnUiThread { publishViewport(); complete(JSONObject().put("updated", true)) }
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
