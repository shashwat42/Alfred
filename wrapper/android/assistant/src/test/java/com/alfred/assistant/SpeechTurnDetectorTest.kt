package com.alfred.assistant

import org.junit.Assert.*
import org.junit.Test

class SpeechTurnDetectorTest {
    @Test fun shortGreetingEndsAfterSilence() {
        val detector = SpeechTurnDetector(1500)
        for (frame in 1..7) assertFalse(detector.update(0.04, 20.0, frame * 20L))
        assertTrue(detector.heardSpeech)
        assertFalse(detector.update(0.0, 20.0, 1639))
        assertTrue(detector.update(0.0, 20.0, 1640))
    }
    @Test fun isolatedClicksCannotAccumulateAcrossSilentPauses() {
        val detector = SpeechTurnDetector(1500)
        for (burst in 0..20) {
            assertFalse(detector.update(0.1, 20.0, burst * 2000L))
            assertFalse(detector.update(0.0, 20.0, burst * 2000L + 1500))
            assertFalse(detector.heardSpeech)
        }
    }
    @Test fun shortGreetingRespectsTheConfiguredPause() {
        for (pause in listOf(1000, 2500)) {
            val detector = SpeechTurnDetector(pause)
            for (frame in 1..7) detector.update(0.04, 20.0, frame * 20L)
            assertFalse(detector.update(0.0, 20.0, 140L + pause - 1))
            assertTrue(detector.update(0.0, 20.0, 140L + pause))
        }
    }
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
