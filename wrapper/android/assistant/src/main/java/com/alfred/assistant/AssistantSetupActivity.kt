package com.alfred.assistant

import android.app.Activity
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.service.voice.VoiceInteractionService
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.ScrollView
import org.json.JSONObject

object AssistantAvailability {
    fun supported() = Build.VERSION.SDK_INT >= 31
    fun status(context: Context): JSONObject {
        val manager = if (Build.VERSION.SDK_INT >= 29) context.getSystemService(RoleManager::class.java) else null
        val roleAvailable = Build.VERSION.SDK_INT >= 29 && manager?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true
        val active = VoiceInteractionService.isActiveService(context, ComponentName(context, AlfredVoiceService::class.java))
        return JSONObject().put("active", active).put("roleAvailable", roleAvailable)
            .put("supported", supported())
            .put("sdk", Build.VERSION.SDK_INT)
            .put("settingsAvailable", settingsIntent(context) != null)
    }

    fun settingsIntent(context: Context): Intent? = listOf(
        Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS
    ).map { Intent(it) }.firstOrNull { it.resolveActivity(context.packageManager) != null }
}

class AssistantSetupActivity : Activity() {
    private lateinit var statusText: TextView
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val padding = (24 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding * 2, padding, padding)
            setBackgroundColor(Color.rgb(24, 24, 24))
        }
        fun text(value: String, size: Float) = TextView(this).apply {
            text = value; textSize = size; setTextColor(Color.WHITE)
            setPadding(0, 0, 0, padding)
            column.addView(this)
        }
        text("Alfred as your system assistant", 24f)
        text("Choose Alfred in Android’s digital assistant settings. Then use the assistant gesture or shortcut supported by your device. Availability depends on Android, your launcher and device settings.", 16f)
        statusText = text("", 16f)
        column.addView(Button(this).apply {
            text = "Choose default assistant"
            isEnabled = AssistantAvailability.supported()
            setOnClickListener { chooseAssistant() }
        })
        column.addView(Button(this).apply { text = "Back"; setOnClickListener { finish() } })
        text("No screen reading, wake word or draw-over-other-apps permission is used. The microphone is requested only when you activate voice. If Alfred is unavailable in the chooser, you can continue using the normal app.", 14f)
        setContentView(ScrollView(this).apply { setBackgroundColor(Color.rgb(24, 24, 24)); addView(column) })
    }

    override fun onResume() {
        super.onResume()
        statusText.text = if (!AssistantAvailability.supported())
            "Floating system assistant requires Android 12 or newer in this build. On this version, open Alfred normally for text and local voice."
        else if (AssistantAvailability.status(this).optBoolean("active"))
            "Alfred is the active system assistant. Try your device’s assistant gesture from another app."
        else "Alfred is not currently the active system assistant."
    }

    private fun chooseAssistant() {
        if (!AssistantAvailability.supported()) return
        if (Build.VERSION.SDK_INT >= 29) {
            val manager = getSystemService(RoleManager::class.java)
            if (manager != null && manager.isRoleAvailable(RoleManager.ROLE_ASSISTANT) && !manager.isRoleHeld(RoleManager.ROLE_ASSISTANT)) {
                try {
                    @Suppress("DEPRECATION")
                    startActivityForResult(manager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT), 1)
                    return
                } catch (_: Exception) { /* Use supported settings below when a role chooser is unavailable. */ }
            }
        }
        val intent = AssistantAvailability.settingsIntent(this)
        if (intent != null) {
            try { startActivity(intent) }
            catch (_: Exception) { statusText.text = "Android could not open assistant settings. Open Settings → Apps → Default apps → Digital assistant manually." }
        } else statusText.text = "This device does not expose assistant selection. Alfred remains available as a regular app."
    }
}
