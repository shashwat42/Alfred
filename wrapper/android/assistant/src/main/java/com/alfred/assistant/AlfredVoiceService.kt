package com.alfred.assistant

import android.os.Bundle
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService

// Runs in :assistant, separate from Tauri's Activity/session process. Android's
// persistent binding must survive UI process teardown. No WebView or microphone here.
class AlfredVoiceService : VoiceInteractionService() {
    override fun onReady() {
        super.onReady()
        // Disable context before Android starts a session, not only after its window exists.
        setDisabledShowContext(VoiceInteractionSession.SHOW_WITH_ASSIST or VoiceInteractionSession.SHOW_WITH_SCREENSHOT)
    }
}

class AlfredSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = AlfredAssistantSession(this)
}
