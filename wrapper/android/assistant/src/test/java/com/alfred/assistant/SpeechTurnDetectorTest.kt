package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class SpeechTurnDetectorTest {
    @Test fun silenceCannotBecomeAQuestion() {
        val detector = SpeechTurnDetector(1500)
        for (frame in 0..600) assertFalse(detector.update(0.0, 20.0, frame * 20L))
        assertFalse(detector.heardSpeech)
    }
    @Test fun shortNoiseIsIgnoredAndSpeechEndsAfterTheConfiguredPause() {
        val detector = SpeechTurnDetector(1500)
        assertFalse(detector.update(0.1, 20.0, 0))
        assertFalse(detector.update(0.0, 20.0, 2000))
        for (frame in 1..20) assertFalse(detector.update(0.04, 20.0, 2000 + frame * 20L))
        assertTrue(detector.heardSpeech)
        assertFalse(detector.update(0.0, 20.0, 3800))
        assertTrue(detector.update(0.0, 20.0, 3900))
    }
}
