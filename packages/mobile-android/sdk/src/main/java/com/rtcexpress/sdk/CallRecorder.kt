package com.rtcexpress.sdk

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/**
 * Records local microphone audio during an active call to a 3gp file.
 * For full two-party recording use web SDK or server-side cloud recording.
 */
class CallRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startedAt = 0L

    val isRecording: Boolean
        get() = recorder != null

    fun startRecording(): File {
        if (recorder != null) throw IllegalStateException("Already recording")
        val file = File(context.cacheDir, "rtc-call-${System.currentTimeMillis()}.3gp")
        outputFile = file
        val mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(context)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }
        mediaRecorder.setAudioSource(MediaRecorder.AudioSource.MIC)
        mediaRecorder.setOutputFormat(MediaRecorder.OutputFormat.THREE_GPP)
        mediaRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AMR_NB)
        mediaRecorder.setOutputFile(file.absolutePath)
        mediaRecorder.prepare()
        mediaRecorder.start()
        recorder = mediaRecorder
        startedAt = System.currentTimeMillis()
        return file
    }

    fun stopRecording(): RecordingResult {
        val mediaRecorder = recorder ?: throw IllegalStateException("Not recording")
        val file = outputFile ?: throw IllegalStateException("No recording file")
        mediaRecorder.stop()
        mediaRecorder.release()
        recorder = null
        return RecordingResult(
            file = file,
            durationMs = System.currentTimeMillis() - startedAt,
            mimeType = "audio/3gpp",
            sizeBytes = file.length()
        )
    }
}

data class RecordingResult(
    val file: File,
    val durationMs: Long,
    val mimeType: String,
    val sizeBytes: Long
)
