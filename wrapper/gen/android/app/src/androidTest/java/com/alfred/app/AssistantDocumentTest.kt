package com.alfred.app

import android.app.KeyguardManager
import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.alfred.assistant.AlfredAssistantSession
import org.junit.Assert.*
import org.junit.Assume.assumeFalse
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/** Tests bundled rendering/profile sharing. Optional microphone probe discards all captured data. */
@RunWith(AndroidJUnit4::class)
class AssistantDocumentTest {
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()
    private fun captureUi(name: String) {
        if (InstrumentationRegistry.getArguments().getString("captureUi") != "true") return
        instrumentation.waitForIdleSync()
        instrumentation.uiAutomation.takeScreenshot()?.let { bitmap ->
            java.io.File(instrumentation.targetContext.filesDir, name).outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
            bitmap.recycle()
        }
    }
    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) for (index in 0 until view.childCount) findWebView(view.getChildAt(index))?.let { return it }
        return null
    }
    private fun evaluate(view: WebView, code: String): String {
        val result = AtomicReference<String>()
        val done = CountDownLatch(1)
        instrumentation.runOnMainSync { view.evaluateJavascript(code) { value -> result.set(value); done.countDown() } }
        assertTrue("WebView JavaScript callback", done.await(10, TimeUnit.SECONDS))
        return result.get()
    }
    private fun waitFor(view: WebView, expression: String, seconds: Long = 30) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(seconds)
        while (System.nanoTime() < deadline) {
            if (evaluate(view, expression) == "true") return
            // Polling belongs to the device test, not production startup.
            Thread.sleep(150)
        }
        fail("Bundled WebView did not become ready: $expression")
    }

    @Test fun regularAppAndSeparateAssistantShareOnlyTheTrustedProfile() {
        val context = instrumentation.targetContext
        assumeFalse("Unlock the test device to validate document rendering", context.getSystemService(KeyguardManager::class.java).isDeviceLocked)
        val activity = instrumentation.startActivitySync(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        var main: WebView? = null
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        while (main == null && System.nanoTime() < deadline) {
            instrumentation.runOnMainSync { main = findWebView(activity.window.decorView) }
            if (main == null) Thread.sleep(150)
        }
        assertNotNull("Tauri creates its normal activity WebView", main)
        waitFor(main!!, "location.origin === 'http://tauri.localhost' && document.getElementById('root')?.childElementCount > 0")
        waitFor(main!!, "document.querySelector('.App') !== null")
        assertEquals("Regular launch retains its own app UI", "true", evaluate(main!!,
            "!document.documentElement.classList.contains('is-android-assistant') && !document.documentElement.classList.contains('is-overlay') && document.querySelector('.android-assistant, .overlay-root') === null"))
        captureUi("assistant-regular-app.png")
        val marker = UUID.randomUUID().toString()
        val key = "alfred_instrumentation_${marker}"
        evaluate(main!!, "localStorage.setItem('$key', '$marker')")
        var session: AlfredAssistantSession? = null
        var assistant: WebView? = null
        try {
            instrumentation.runOnMainSync {
                session = AlfredAssistantSession(activity)
                val content = session!!.onCreateContentView()
                assistant = findWebView(content)
                activity.addContentView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            }
            assertNotNull("Updated Android System WebView supports the restricted bridge", assistant)
            waitFor(assistant!!, "document.querySelector('.android-assistant-composer') !== null")
            assertEquals("No second action panel", "true", evaluate(assistant!!, "document.querySelector('.android-assistant-toolbar') === null"))
            waitFor(assistant!!, "document.querySelector('.android-assistant-composer').getBoundingClientRect().width > 0")
            assertEquals("Compact input bar fits the native surface", "true", evaluate(assistant!!,
                "(() => { const bar = document.querySelector('.android-assistant-composer'); const input = bar.querySelector('input'); return bar.scrollWidth <= bar.clientWidth + 1 && input.getBoundingClientRect().width >= 50 && getComputedStyle(document.querySelector('.android-assistant')).backgroundColor === 'rgba(0, 0, 0, 0)'; })()"))
            captureUi("assistant-quick-input.png")
            assertEquals("\"$marker\"", evaluate(assistant!!, "localStorage.getItem('$key')"))
            assertEquals("true", evaluate(assistant!!, "typeof window.__TAURI_INTERNALS__ === 'undefined'"))
            assertEquals("true", evaluate(assistant!!, "window.isSecureContext === true && typeof navigator.mediaDevices?.getUserMedia === 'function'"))
            lateinit var surface: View
            instrumentation.runOnMainSync {
                assertFalse("Voice activity detection must work after asynchronous model loading", assistant!!.settings.mediaPlaybackRequiresUserGesture)
                surface = assistant!!.parent as View
                val params = assistant!!.layoutParams as android.widget.FrameLayout.LayoutParams
                assertEquals(android.view.Gravity.BOTTOM, params.gravity and android.view.Gravity.VERTICAL_GRAVITY_MASK)
                assertTrue("Conversation uses the available screen height", assistant!!.height >= surface.height - surface.paddingTop - surface.paddingBottom - (20 * context.resources.displayMetrics.density).toInt())
                assertTrue("Full-screen document is not capped at 620dp", assistant!!.width >= surface.width - surface.paddingLeft - surface.paddingRight - (28 * context.resources.displayMetrics.density).toInt())
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    val insets = android.view.WindowInsets.Builder()
                        .setInsets(android.view.WindowInsets.Type.systemBars(), android.graphics.Insets.of(0, 24, 0, 24))
                        .setInsets(android.view.WindowInsets.Type.ime(), android.graphics.Insets.of(0, 0, 0, 320))
                        .build()
                    surface.dispatchApplyWindowInsets(insets)
                    // Check synthetic inset math immediately. A full-screen
                    // relayout lets Android redispatch the real (closed) IME.
                    assertEquals("Use keyboard height once, rather than adding navigation bar padding", 320, surface.paddingBottom)
                }
            }
            instrumentation.waitForIdleSync()
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                instrumentation.runOnMainSync {
                    val gap = surface.height - surface.paddingBottom - assistant!!.bottom
                    assertTrue("Overlay stays just above the keyboard", gap in 1..(24 * context.resources.displayMetrics.density).toInt())
                    surface.dispatchApplyWindowInsets(android.view.WindowInsets.Builder()
                        .setInsets(android.view.WindowInsets.Type.systemBars(), android.graphics.Insets.of(0, 24, 0, 24)).build())
                    surface.requestApplyInsets()
                }
            }
            if (InstrumentationRegistry.getArguments().getString("microphoneSmoke") == "true") {
                assertEquals("This opt-in probe requires the user's existing microphone grant", android.content.pm.PackageManager.PERMISSION_GRANTED,
                    context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO))
                evaluate(assistant!!, """(() => {
                    window.alfredMicProbe = {done:false, error:null, running:false, bytes:0, stopped:false};
                    (async () => {
                        let stream, audio;
                        try {
                            stream = await navigator.mediaDevices.getUserMedia({audio:true});
                            audio = new AudioContext();
                            await audio.resume();
                            const source = audio.createMediaStreamSource(stream);
                            source.connect(audio.createAnalyser());
                            const recorder = new MediaRecorder(stream);
                            recorder.ondataavailable = e => { window.alfredMicProbe.bytes += e.data.size; };
                            recorder.start(100);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            window.alfredMicProbe.running = audio.state === 'running' && audio.currentTime > 0.1;
                            await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
                        } catch (e) { window.alfredMicProbe.error = e.name + ': ' + e.message; }
                        finally {
                            stream?.getTracks().forEach(track => track.stop());
                            window.alfredMicProbe.stopped = !!stream && stream.getTracks().every(track => track.readyState === 'ended');
                            await audio?.close();
                            window.alfredMicProbe.done = true;
                        }
                    })();
                })()""")
                waitFor(assistant!!, "window.alfredMicProbe.done", 15)
                assertEquals("Overlay WebView microphone probe", "null", evaluate(assistant!!, "window.alfredMicProbe.error"))
                assertEquals("Live Web Audio, encoded samples and stopped microphone tracks", "true", evaluate(assistant!!,
                    "window.alfredMicProbe.running && window.alfredMicProbe.bytes > 0 && window.alfredMicProbe.stopped"))
            }
            evaluate(assistant!!, "location.href = 'https://example.com/blocked'")
            instrumentation.waitForIdleSync()
            assertEquals("\"http://tauri.localhost\"", evaluate(assistant!!, "location.origin"))
            if (InstrumentationRegistry.getArguments().getString("voiceModelSmoke") == "true") {
                val worker = context.assets.list("assistant/assets")!!.single { it.startsWith("speech.worker-") && it.endsWith(".js") }
                evaluate(assistant!!, """(() => {
                    window.alfredModelProbe = {ready:false, error:null};
                    const worker = new Worker('/assets/$worker', {type:'module', name:'alfred-android-assistant'});
                    worker.onmessage = event => {
                        if (event.data.type === 'MODEL_STATUS' && event.data.status === 'ready') { window.alfredModelProbe.ready = true; worker.terminate(); }
                        if (event.data.type === 'MODEL_STATUS' && event.data.status === 'error') { window.alfredModelProbe.error = event.data.error; worker.terminate(); }
                    };
                    worker.onerror = event => { window.alfredModelProbe.error = event.message; worker.terminate(); };
                    worker.postMessage({type:'LOAD_MODEL', model:'onnx-community/whisper-tiny.en', devicePreference:'wasm'});
                    setTimeout(() => worker.terminate(), 180000);
                })()""")
                waitFor(assistant!!, "window.alfredModelProbe.ready || window.alfredModelProbe.error !== null", 180)
                assertEquals("Local Whisper model/runtime initialization error", "null", evaluate(assistant!!, "window.alfredModelProbe.error"))
                assertEquals("true", evaluate(assistant!!, "window.alfredModelProbe.ready"))
            }
            if (InstrumentationRegistry.getArguments().getString("aiSmoke") == "true") {
                evaluate(assistant!!, "(() => { const input = document.querySelector('.android-assistant-composer input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'Reply with ALFRED_ANDROID_SMOKE_OK. Do not create or modify any data.'); input.dispatchEvent(new Event('input', {bubbles:true})); })()")
                waitFor(assistant!!, "document.querySelector('.android-assistant-composer button[type=submit]').disabled === false")
                evaluate(assistant!!, "document.querySelector('.android-assistant-composer').requestSubmit()")
                waitFor(assistant!!, "document.querySelector('.android-assistant-message.is-assistant') !== null || document.querySelector('.android-assistant-error') !== null", 90)
                assertEquals("AI smoke error shown by the trusted assistant document", "null", evaluate(assistant!!, "document.querySelector('.android-assistant-error')?.textContent || null"))
            }
        } finally {
            evaluate(main!!, "localStorage.removeItem('$key')")
            instrumentation.runOnMainSync {
                val content = assistant?.parent as? View
                session?.onDestroy()
                (content?.parent as? ViewGroup)?.removeView(content)
                // Leave the real Tauri Activity lifecycle to the runner rather
                // than explicitly stopping its native event loop from this test.
            }
        }
    }
}
