package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class AssistantSettingsPolicyTest {
    @Test fun setupUsesOnlyPublicActions() {
        assertEquals(listOf("android.settings.VOICE_INPUT_SETTINGS", "android.settings.MANAGE_DEFAULT_APPS_SETTINGS"), AssistantSettingsPolicy.actions)
    }
    @Test fun aResolvableButDeniedSettingsScreenFallsBackToDefaultApps() {
        val attempted = mutableListOf<String>()
        assertTrue(AssistantSettingsPolicy.open {
            attempted.add(it)
            if (attempted.size == 1) throw SecurityException("OEM denied voice input settings")
        })
        assertEquals(AssistantSettingsPolicy.actions, attempted)
    }
    @Test fun unavailableSettingsReturnFailureWithoutCrashing() {
        assertFalse(AssistantSettingsPolicy.open { throw IllegalStateException("Unavailable") })
    }
}
