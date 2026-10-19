package com.alfred.assistant

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class SchedulePushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        ScheduleNotifications.registerPush(this, token)
    }
    override fun onMessageReceived(message: RemoteMessage) {
        // Post immediately within FCM's processing window; no network/React needed.
        ScheduleNotifications.receivePush(this, message.data)
    }
}
