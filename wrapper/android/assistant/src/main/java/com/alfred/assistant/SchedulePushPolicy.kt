package com.alfred.assistant

/** Validate before displaying data-only push. FCM can outlive an app login. */
object SchedulePushPolicy {
    fun accepts(data: Map<String, String>, account: String, sessionHash: String, sessionExpiresAt: Long, now: Long): Boolean {
        if (account.isEmpty() || sessionHash.isEmpty() || sessionExpiresAt <= now) return false
        if (data["accountId"] != account || data["sessionHash"] != sessionHash) return false
        val key = data["key"] ?: return false
        val due = data["dueAt"]?.toLongOrNull() ?: return false
        val eventAt = data["eventAt"]?.toLongOrNull() ?: return false
        if (!key.matches(Regex("[a-f0-9]{24}:[0-9]{10,16}:(lead|start)")) || due > now + 30000 || now - due > 120000) return false
        if (key.split(':')[1] != eventAt.toString() || (key.endsWith(":lead") && eventAt <= now)) return false
        if (key.substringBefore(':') != data["scheduleId"] || !data["date"].orEmpty().matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}"))) return false
        return data["title"].orEmpty().length in 1..160 && data["body"].orEmpty().length in 1..240
    }
}
