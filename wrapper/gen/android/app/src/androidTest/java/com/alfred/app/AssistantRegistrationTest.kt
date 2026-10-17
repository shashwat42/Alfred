package com.alfred.app

import android.Manifest
import android.content.ComponentName
import android.content.pm.PackageManager
import android.net.Uri
import android.service.voice.VoiceInteractionService
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.alfred.assistant.AssistantBridge
import com.alfred.assistant.AlfredVoiceService
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.xmlpull.v1.XmlPullParser

/** Registration/security checks only. Never changes the user's default assistant or requests microphone access. */
@RunWith(AndroidJUnit4::class)
class AssistantRegistrationTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun systemServiceMetadataIsEligibleAndBindingIsProtected() {
        val component = ComponentName(context, AlfredVoiceService::class.java)
        @Suppress("DEPRECATION")
        val service = context.packageManager.getServiceInfo(component, PackageManager.GET_META_DATA)
        assertTrue(service.exported)
        assertEquals(Manifest.permission.BIND_VOICE_INTERACTION, service.permission)
        assertEquals("Persistent assistant binding must survive Tauri UI process death", "${context.packageName}:assistant", service.processName)
        val parser = service.loadXmlMetaData(context.packageManager, VoiceInteractionService.SERVICE_META_DATA)
        assertNotNull(parser)
        parser!!.use {
            var event = it.eventType
            while (event != XmlPullParser.START_TAG && event != XmlPullParser.END_DOCUMENT) event = it.next()
            assertEquals("voice-interaction-service", it.name)
            val ns = "http://schemas.android.com/apk/res/android"
            assertEquals("com.alfred.assistant.AlfredSessionService", it.getAttributeValue(ns, "sessionService"))
            // Android's role controller rejects an absent recognitionService even on 12+.
            assertEquals("", it.getAttributeValue(ns, "recognitionService"))
            val attributes = context.resources.obtainAttributes(it, intArrayOf(android.R.attr.recognitionService))
            try { assertEquals("", attributes.getString(0)) } finally { attributes.recycle() }
            assertTrue(it.getAttributeBooleanValue(ns, "supportsAssist", false))
        }
        @Suppress("DEPRECATION")
        val session = context.packageManager.getServiceInfo(ComponentName(context.packageName, "com.alfred.assistant.AlfredSessionService"), 0)
        assertEquals(Manifest.permission.BIND_VOICE_INTERACTION, session.permission)
        assertEquals("Session retains the existing main-process WebView profile", context.packageName, session.processName)
        assertNotEquals(service.processName, session.processName)
    }

    @Test fun packageIncludesTheRealBundledAssistantFrontend() {
        val runtime = org.json.JSONObject(context.assets.open("tauri.conf.json").bufferedReader().use { it.readText() })
        val windows = runtime.getJSONObject("app").getJSONArray("windows")
        assertEquals("Android APK must not include the desktop overlay window", 1, windows.length())
        assertEquals("main", windows.getJSONObject(0).getString("label"))
        assertEquals("index.html", windows.getJSONObject(0).getString("url"))
        val html = context.assets.open("assistant/index.html").bufferedReader().use { it.readText() }
        assertTrue(html.contains("type=\"module\""))
        val script = Regex("src=\"(/assets/[^\"]+\\.js)\"").find(html)?.groupValues?.get(1)
        assertNotNull(script)
        val js = context.assets.open("assistant${script}").bufferedReader().use { it.readText() }
        assertTrue(js.contains("android-assistant"))
        assertFalse(context.assets.list("assistant")!!.contains("speech-runtime"))
        assertFalse(context.assets.list("assistant")!!.contains("ort"))
    }

    @Test fun privilegedBridgeRejectsRemoteAndMalformedOrigins() {
        assertTrue(AssistantBridge.trusted(Uri.parse("http://tauri.localhost")))
        for (origin in listOf("https://example.com", "http://tauri.localhost.evil", "file:///index.html", "http://user@tauri.localhost", "http://tauri.localhost:5173")) {
            assertFalse(origin, AssistantBridge.trusted(Uri.parse(origin)))
        }
    }

    @Test fun noOverlayOrInterceptionPermissionsAreRequested() {
        @Suppress("DEPRECATION")
        val permissions = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions?.toSet() ?: emptySet()
        assertTrue(permissions.contains(Manifest.permission.RECORD_AUDIO))
        for (permission in listOf(Manifest.permission.SYSTEM_ALERT_WINDOW, Manifest.permission.BIND_ACCESSIBILITY_SERVICE, Manifest.permission.RECEIVE_BOOT_COMPLETED, Manifest.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)) {
            assertFalse(permission, permissions.contains(permission))
        }
    }
}
