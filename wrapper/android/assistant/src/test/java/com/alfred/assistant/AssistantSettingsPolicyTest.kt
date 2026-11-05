package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class AssistantSettingsPolicyTest {
    @Test fun setupUsesOnlyPublicActions() {
        assertEquals(listOf("android.settings.MANAGE_DEFAULT_APPS_SETTINGS", "android.settings.VOICE_INPUT_SETTINGS", "android.settings.SETTINGS"), AssistantSettingsPolicy.actions)
    }
    @Test fun aResolvableButDeniedDefaultAppsScreenFallsBackToVoiceSettings() {
        val attempted = mutableListOf<String>()
        assertTrue(AssistantSettingsPolicy.open {
            attempted.add(it)
            if (attempted.size == 1) throw SecurityException("OEM denied default apps settings")
        })
        assertEquals(AssistantSettingsPolicy.actions.take(2), attempted)
    }
    @Test fun missingDedicatedScreensFallBackToGeneralSettings() {
        val attempted = mutableListOf<String>()
        assertTrue(AssistantSettingsPolicy.open {
            attempted.add(it)
            if (it != "android.settings.SETTINGS") throw IllegalStateException("Unavailable")
        })
        assertEquals(AssistantSettingsPolicy.actions, attempted)
    }
    @Test fun unavailableSettingsReturnFailureWithoutCrashing() {
        assertFalse(AssistantSettingsPolicy.open { throw IllegalStateException("Unavailable") })
    }
}
