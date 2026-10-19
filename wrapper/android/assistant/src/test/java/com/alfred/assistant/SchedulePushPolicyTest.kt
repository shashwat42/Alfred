package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class SchedulePushPolicyTest {
    private val now = 1792404000000L
    private val id = "111111111111111111111111"
    private fun data() = mapOf("key" to "$id:${now + 600000}:lead", "eventAt" to (now + 600000).toString(), "scheduleId" to id, "accountId" to "account", "sessionHash" to "session", "date" to "2026-10-19", "dueAt" to now.toString(), "title" to "Call", "body" to "At 10:10")
    private fun accept(d: Map<String, String>) = SchedulePushPolicy.accepts(d, "account", "session", now + 60000, now)
    @Test fun duePushCanDisplayWithoutAnyNetworkRequest() { assertTrue(accept(data())) }
    @Test fun oldAccountExpiredSessionAndMalformedPayloadAreRejected() {
        assertFalse(accept(data() + ("accountId" to "other")))
        assertFalse(accept(data() + ("sessionHash" to "old")))
        assertFalse(SchedulePushPolicy.accepts(data(), "account", "session", now, now))
        assertFalse(accept(data() + ("key" to "malformed")))
        assertFalse(accept(data() + ("scheduleId" to "222222222222222222222222")))
        assertFalse(accept(data() + mapOf("key" to "$id:$now:lead", "eventAt" to now.toString())))
    }
    @Test fun staleAndFuturePayloadsAreRejectedWithSmallClockSkewTolerance() {
        assertFalse(accept(data() + ("dueAt" to (now - 120001).toString())))
        assertFalse(accept(data() + ("dueAt" to (now + 30001).toString())))
        assertTrue(accept(data() + ("dueAt" to (now + 1000).toString())))
    }
}
