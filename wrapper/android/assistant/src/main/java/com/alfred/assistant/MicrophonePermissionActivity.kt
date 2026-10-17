package com.alfred.assistant

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.ResultReceiver

/** A transient, unexported permission host. Started only by explicit WebView microphone capture. */
class MicrophonePermissionActivity : Activity() {
    private var receiver: ResultReceiver? = null
    private var delivered = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        receiver = intent.getParcelableExtra("result")
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) complete(true)
        else if (savedInstanceState == null) requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 7)
    }
    override fun onRequestPermissionsResult(code: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(code, permissions, results)
        if (code == 7) complete(results.isNotEmpty() && results[0] == PackageManager.PERMISSION_GRANTED)
    }
    private fun complete(granted: Boolean) {
        if (delivered) return
        delivered = true
        receiver?.send(if (granted) Activity.RESULT_OK else Activity.RESULT_CANCELED, Bundle())
        finish()
    }
    override fun onDestroy() {
        if (isFinishing && !delivered) receiver?.send(Activity.RESULT_CANCELED, Bundle())
        super.onDestroy()
    }
}
