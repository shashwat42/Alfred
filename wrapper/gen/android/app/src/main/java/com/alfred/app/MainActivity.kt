package com.alfred.app

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onWebViewCreate(webView: android.webkit.WebView) {
    super.onWebViewCreate(webView)
    com.alfred.assistant.AssistantBridge.installMain(this, webView)
    onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        if (android.os.Build.VERSION.SDK_INT >= 30 && webView.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime()) == true) {
          webView.windowInsetsController?.hide(android.view.WindowInsets.Type.ime())
          return
        }
        webView.evaluateJavascript("window.dispatchEvent(new Event('alfred:back', {cancelable:true}))", null)
      }
    })
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
