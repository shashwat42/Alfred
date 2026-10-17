package com.alfred.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    com.alfred.assistant.AssistantBridge.installMain(this, webView)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    com.alfred.assistant.ScheduleNotifications.openIntent(this, intent)
  }

  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    com.alfred.assistant.ScheduleNotifications.openIntent(this, intent)
  }
}
