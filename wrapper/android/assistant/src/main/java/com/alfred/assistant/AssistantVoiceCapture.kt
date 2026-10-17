package com.alfred.assistant

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.sqrt

/** Explicit, bounded speech capture for a visible assistant session. No files or background service. */
class AssistantVoiceCapture {
    private val executor = Executors.newSingleThreadExecutor()
    private val generation = AtomicInteger()
    private val main = Handler(Looper.getMainLooper())

    fun cancel() { generation.incrementAndGet() }
    fun close() { cancel(); executor.shutdownNow() }

    @SuppressLint("MissingPermission") // Session checks RECORD_AUDIO before invoking capture.
    fun record(silenceMs: Int, complete: (JSONObject) -> Unit, onLevel: (Double) -> Unit = {}) {
        val turn = generation.incrementAndGet()
        executor.execute {
            var recorder: AudioRecord? = null
            var result: JSONObject
            try {
                val minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
                check(minimum > 0) { "Microphone does not support speech capture on this device." }
                recorder = AudioRecord.Builder()
                    .setAudioSource(SOURCE)
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(minimum * 2, 6400)).build()
                check(recorder.state == AudioRecord.STATE_INITIALIZED) { "Could not initialize the microphone. Please retry." }
                recorder.startRecording()
                check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Could not start the microphone. Please retry." }
                val started = SystemClock.elapsedRealtime()
                val detector = SpeechTurnDetector(silenceMs.coerceIn(1000, 2500))
                val output = ByteArrayOutputStream()
                val samples = ShortArray(320)
                var lastLevelAt = 0L
                while (turn == generation.get() && !Thread.currentThread().isInterrupted) {
                    val elapsed = SystemClock.elapsedRealtime() - started
                    check(elapsed < 30000) { "Recording reached its limit. Please try a shorter question." }
                    val count = recorder.read(samples, 0, samples.size, AudioRecord.READ_NON_BLOCKING)
                    check(count >= 0) { "Microphone capture was interrupted. Please retry." }
                    if (count == 0) { Thread.sleep(10); continue }
                    var power = 0.0
                    for (index in 0 until count) {
                        val sample = samples[index].toInt()
                        output.write(sample and 255); output.write((sample shr 8) and 255)
                        power += (sample / 32768.0) * (sample / 32768.0)
                    }
                    val rms = sqrt(power / count)
                    if (elapsed - lastLevelAt >= 80) {
                        lastLevelAt = elapsed
                        val level = (rms * 4).coerceIn(0.0, 1.0)
                        main.post { if (turn == generation.get()) onLevel(level) }
                    }
                    if (detector.update(rms, count * 1000.0 / RATE, elapsed)) break
                    check(detector.heardSpeech || elapsed < 12000) {
                        "No speech reached Alfred. Check microphone access or another app using the mic, then retry."
                    }
                }
                check(turn == generation.get()) { "Voice capture cancelled." }
                check(detector.heardSpeech) { "No speech was detected. Please retry." }
                result = JSONObject().put("pcm", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP)).put("sampleRate", RATE)
            } catch (error: Exception) {
                result = JSONObject().put("error", error.message ?: "Voice capture failed. Please retry.")
            } finally {
                try { recorder?.stop() } catch (_: Exception) { }
                recorder?.release()
            }
            main.post { complete(result) }
        }
    }

    companion object {
        const val RATE = 16000
        // WebRTC uses VOICE_COMMUNICATION, which Android can silence for a
        // background assistant. The selected assistant uses speech recognition.
        const val SOURCE = MediaRecorder.AudioSource.VOICE_RECOGNITION
    }
}

internal class SpeechTurnDetector(private val silenceMs: Int) {
    private var speechMs = 0.0
    private var lastSpeechAt = 0L
    val heardSpeech get() = speechMs >= 300
    fun update(rms: Double, frameMs: Double, elapsedMs: Long): Boolean {
        if (rms >= 0.015) { speechMs += frameMs; lastSpeechAt = elapsedMs }
        return heardSpeech && elapsedMs - lastSpeechAt >= silenceMs
    }
}
