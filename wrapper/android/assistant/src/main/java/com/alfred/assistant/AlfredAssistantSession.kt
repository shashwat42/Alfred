package com.alfred.assistant

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ResultReceiver
import android.service.voice.VoiceInteractionSession
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.WindowInsets
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import java.io.ByteArrayInputStream
import java.net.URLConnection
import org.json.JSONObject

class AlfredAssistantSession(context: Context) : VoiceInteractionSession(context) {
    private var browser: WebView? = null
    private var root: FrameLayout? = null
    private var pendingPermission: PermissionRequest? = null
    private var permissionInProgress = false
    private var nativePermission: ((Boolean) -> Unit)? = null
    private var voiceCapture: AssistantVoiceCapture? = null
    private var destroyed = false
    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()

    override fun onCreate() {
        setTheme(R.style.AlfredAssistantSession)
        super.onCreate()
        setDisabledShowContext(SHOW_WITH_ASSIST or SHOW_WITH_SCREENSHOT)
        window.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setDimAmount(0.22f)
            setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            // Own the system/IME insets below; do not also fit them in the decor.
            if (Build.VERSION.SDK_INT >= 30) setDecorFitsSystemWindows(false)
        }
    }

    override fun onCreateContentView(): View {
        val container = object : FrameLayout(context) {
            override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
                super.onSizeChanged(w, h, oldw, oldh)
                post { resizePanel() }
            }
        }
        container.setBackgroundColor(Color.TRANSPARENT)
        container.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val safe = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsets.Type.ime())
                view.setPadding(safe.left, safe.top, safe.right, maxOf(safe.bottom, keyboard.bottom))
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop,
                    insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            view.post { resizePanel() }
            insets
        }
        root = container
        createBrowser()
        return container
    }

    private fun createBrowser() {
        if (browser != null || destroyed) return
        if (context.getSystemService(KeyguardManager::class.java)?.isDeviceLocked == true) {
            showFallback("Unlock your device to use Alfred. Tap to open the regular app.")
            return
        }
        val view = WebView(context)
        browser = view
        view.setBackgroundColor(Color.TRANSPARENT)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            // Voice is explicitly started/stopped by our UI. Web Audio must
            // continue across asynchronous capture and preparation for VAD.
            mediaPlaybackRequiresUserGesture = false
        }
        voiceCapture = AssistantVoiceCapture()
        val installed = AssistantBridge.installAsync(view) { type, request, complete ->
            if (type == "recordVoice") {
                requestNativeMicrophone { granted ->
                    if (browser !== view || destroyed) return@requestNativeMicrophone
                    if (granted) voiceCapture?.record(request.optInt("silenceMs", 1500), complete) { level ->
                        complete(JSONObject().put("event", "voiceLevel").put("level", level))
                    }
                    else complete(JSONObject().put("error", "Microphone permission was denied. Allow it in Alfred's Android app settings, then retry."))
                }
            } else complete(when (type) {
                "cancelVoice" -> { nativePermission = null; voiceCapture?.cancel(); JSONObject().put("ok", true) }
                "dismiss" -> { Handler(Looper.getMainLooper()).post { finish() }; JSONObject().put("ok", true) }
                "openApp" -> {
                    openMainApp()
                    Handler(Looper.getMainLooper()).post { finish() }
                    JSONObject().put("ok", true)
                }
                else -> JSONObject().put("error", "Unsupported assistant action.")
            })
        }
        if (!installed) {
            view.destroy(); browser = null
            showFallback("Update Android System WebView to use the floating assistant. Tap to open Alfred normally.")
            return
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, request: WebResourceRequest): Boolean = true
            override fun shouldInterceptRequest(v: WebView, request: WebResourceRequest): WebResourceResponse? {
                if (!AssistantBridge.trusted(request.url)) return null // Authenticated backend fetches; CSP forbids remote documents/scripts.
                val path = AssistantAssetPath.fromDecodedPath(request.url.path) ?: return blocked()
                return try {
                    val mime = when {
                        path.endsWith(".js") || path.endsWith(".mjs") -> "application/javascript"
                        path.endsWith(".css") -> "text/css"
                        path.endsWith(".wasm") -> "application/wasm"
                        path.endsWith(".svg") -> "image/svg+xml"
                        else -> URLConnection.guessContentTypeFromName(path) ?: "application/octet-stream"
                    }
                    val response = WebResourceResponse(mime, "UTF-8", context.assets.open("assistant/$path"))
                    response.responseHeaders = mapOf("Content-Security-Policy" to CSP, "Cache-Control" to "no-store", "X-Content-Type-Options" to "nosniff")
                    response
                } catch (_: Exception) { blocked() }
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                Handler(Looper.getMainLooper()).post { requestMicrophone(request) }
            }
            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingPermission === request) pendingPermission = null
            }
        }
        root?.addView(view, panelParams(ViewGroup.LayoutParams.MATCH_PARENT))
        view.loadUrl("${AssistantBridge.ORIGIN}/index.html?window=android-assistant")
    }

    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 404, "Not found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    private fun showFallback(message: String) {
        root?.removeAllViews()
        root?.addView(TextView(context).apply {
            text = message
            setTextColor(Color.WHITE); setBackgroundColor(Color.rgb(24, 24, 24))
            setPadding(dp(20), dp(20), dp(20), dp(20))
            setOnClickListener {
                try { openMainApp(); finish() }
                catch (_: Exception) { text = "Android could not open Alfred. Tap to retry." }
            }
        }, panelParams(dp(180)))
    }
    private fun panelParams(height: Int): FrameLayout.LayoutParams {
        val availableWidth = ((root?.width?.takeIf { it > 0 } ?: context.resources.displayMetrics.widthPixels)
            - (root?.paddingLeft ?: 0) - (root?.paddingRight ?: 0) - dp(24)).coerceAtLeast(1)
        return FrameLayout.LayoutParams(availableWidth, height, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            setMargins(dp(12), dp(8), dp(12), dp(8))
        }
    }
    private fun resizePanel() {
        val parent = root ?: return
        val child = browser ?: return
        if (parent.height <= 0) return
        val available = (parent.height - parent.paddingTop - parent.paddingBottom - dp(16)).coerceAtLeast(1)
        child.layoutParams = panelParams(available)
    }

    private fun requestMicrophone(request: PermissionRequest) {
        if (destroyed || !AssistantBridge.trusted(request.origin) || request.resources.toSet() != setOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE) || pendingPermission != null) {
            request.deny(); return
        }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)); return
        }
        pendingPermission = request
        permissionInProgress = true
        val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
            override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
                permissionInProgress = false
                val pending = pendingPermission ?: return
                pendingPermission = null
                if (destroyed) { pending.deny(); return }
                show(Bundle(), 0)
                if (resultCode == Activity.RESULT_OK) pending.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else pending.deny()
            }
        }
        try { launchAssistantActivity(Intent(context, MicrophonePermissionActivity::class.java).putExtra("result", receiver)) }
        catch (_: Exception) { pendingPermission = null; permissionInProgress = false; request.deny() }
    }

    private fun requestNativeMicrophone(complete: (Boolean) -> Unit) {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            complete(true); return
        }
        if (permissionInProgress) { complete(false); return }
        nativePermission = complete
        permissionInProgress = true
        val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
            override fun onReceiveResult(resultCode: Int, resultData: Bundle?) {
                permissionInProgress = false
                if (destroyed) { nativePermission = null; return }
                show(Bundle(), 0)
                val pending = nativePermission; nativePermission = null
                pending?.invoke(resultCode == Activity.RESULT_OK)
            }
        }
        try { launchAssistantActivity(Intent(context, MicrophonePermissionActivity::class.java).putExtra("result", receiver)) }
        catch (_: Exception) { nativePermission = null; permissionInProgress = false; complete(false) }
    }

    private fun launchAssistantActivity(intent: Intent) {
        if (Build.VERSION.SDK_INT >= 26) startAssistantActivity(intent)
        else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun openMainApp() {
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: throw IllegalStateException("Alfred's launcher activity is unavailable")
        // The regular app must survive dismissal of this voice session. Assistant
        // activities belong to the session's special task layer instead.
        intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        context.startActivity(intent)
    }

    override fun onComputeInsets(outInsets: Insets) {
        val view = browser ?: root?.getChildAt(0)
        outInsets.contentInsets.set(0, 0, 0, 0)
        outInsets.touchableInsets = Insets.TOUCHABLE_INSETS_REGION
        outInsets.touchableRegion.setEmpty()
        if (view != null) {
            val location = IntArray(2)
            view.getLocationInWindow(location)
            outInsets.touchableRegion.set(Rect(location[0], location[1], location[0] + view.width, location[1] + view.height))
        }
    }
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        AssistantBridge.stopMainVoice()
        createBrowser()
    }
    override fun onHide() {
        super.onHide()
        if (!permissionInProgress) { releaseBrowser(); finish() }
    }
    override fun onBackPressed() { finish() }
    override fun onDestroy() { destroyed = true; releaseBrowser(); super.onDestroy() }
    private fun releaseBrowser() {
        nativePermission = null
        voiceCapture?.close(); voiceCapture = null
        pendingPermission?.deny(); pendingPermission = null
        browser?.let { view ->
            // pagehide cancels requests/recording; destroying the document discards chat memory.
            view.evaluateJavascript("window.dispatchEvent(new Event('pagehide'))", null)
            view.stopLoading(); (view.parent as? ViewGroup)?.removeView(view); view.destroy()
        }
        browser = null
    }
    companion object {
        private const val CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https: http://localhost:8000 http://127.0.0.1:8000; worker-src 'self' blob:; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    }
}
