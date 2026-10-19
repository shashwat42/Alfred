package com.alfred.assistant

/** Only public Settings actions: MANAGE_DEFAULT_APP requires system permissions. */
object AssistantSettingsPolicy {
    val actions = listOf("android.settings.VOICE_INPUT_SETTINGS", "android.settings.MANAGE_DEFAULT_APPS_SETTINGS")

    fun open(launch: (String) -> Unit): Boolean {
        for (action in actions) {
            try { launch(action); return true }
            catch (_: Exception) { /* OEM settings may resolve but still deny a launch. Try the next public action. */ }
        }
        return false
    }
}
