package com.rtcexpress.sdk

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import org.webrtc.RendererCommon

/** All track and renderer changes run on the main thread, including teardown. */
object CallVideoTracks {
    private val main = Handler(Looper.getMainLooper())
    private var local: VideoTrack? = null
    private var remote: VideoTrack? = null
    private val users = mutableMapOf<String, VideoTrack>() // group video: one camera per person
    private val screens = linkedMapOf<String, VideoTrack>() // shared screens, newest last
    private val views = mutableSetOf<CallVideoView>()
    fun update(isLocal: Boolean, track: VideoTrack?) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { update(isLocal, track) }
            return
        }
        if (isLocal) local = track else remote = track
        views.filter { !it.screen && it.local == isLocal && it.userId.isNullOrBlank() }.forEach { it.bind(track) }
    }
    fun updateUser(userId: String, track: VideoTrack?) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { updateUser(userId, track) }
            return
        }
        if (track == null) users.remove(userId) else users[userId] = track
        views.filter { !it.screen && !it.local && it.userId == userId }.forEach { it.bind(track) }
    }
    /** A remote person started (track) or stopped (null) sharing their screen. */
    fun updateScreen(userId: String, track: VideoTrack?) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { updateScreen(userId, track) }
            return
        }
        screens.remove(userId)
        if (track != null) screens[userId] = track
        views.filter { it.screen }.forEach { it.bind(trackFor(it)) }
    }
    fun clearUsers() {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            main.post { clearUsers() }
            return
        }
        users.clear()
        screens.clear()
        views.filter { !it.userId.isNullOrBlank() || it.screen }.forEach { it.bind(null) }
    }
    private fun trackFor(view: CallVideoView): VideoTrack? = when {
        view.screen -> if (!view.userId.isNullOrBlank()) screens[view.userId] else screens.values.lastOrNull()
        view.local -> local
        !view.userId.isNullOrBlank() -> users[view.userId]
        else -> remote
    }
    fun register(view: CallVideoView) {
        views.add(view)
        view.bind(trackFor(view))
    }
    fun unregister(view: CallVideoView) {
        views.remove(view)
        view.bind(null)
    }
}

class CallVideoView(context: Context) : SurfaceViewRenderer(context) {
    var local = false
        set(value) {
            field = value
            setMirror(value)
            if (!isAttachedToWindow) setZOrderMediaOverlay(onTop)
            if (isAttachedToWindow) CallVideoTracks.register(this)
        }
    /**
     * Draw above other video (small tiles over a big video). Default: the self-view is on top.
     * Android fixes this when the surface is created, so set it before the view is shown.
     */
    var overlay: Boolean? = null
        set(value) {
            field = value
            if (!isAttachedToWindow) setZOrderMediaOverlay(onTop)
        }
    private val onTop get() = overlay ?: local
    /** Group video: show this person's camera instead of the newest remote one. */
    var userId: String? = null
        set(value) {
            field = value
            if (isAttachedToWindow) CallVideoTracks.register(this)
        }
    /** Show a shared screen (this userId's, or the newest one) instead of a camera. */
    var screen = false
        set(value) {
            field = value
            if (isAttachedToWindow) CallVideoTracks.register(this)
        }
    private var track: VideoTrack? = null
    private var ready = false
    fun bind(next: VideoTrack?) {
        if (track === next) return
        // The track may already be disposed (the other person stopped sharing and the consumer was
        // closed first): removeSink would throw on the main thread and crash the app (= call ends).
        track?.let { old -> runCatching { old.removeSink(this) } }
        track = next
        if (next != null && runCatching { next.addSink(this) }.isFailure) track = null
        if (next == null && ready) clearImage()
    }
    override fun onAttachedToWindow() {
        setZOrderMediaOverlay(onTop) // must happen before the surface is created
        super.onAttachedToWindow()
        WebRtcPeerFactory.warmUp(context)
        init(WebRtcPeerFactory.egl().eglBaseContext, null)
        setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        ready = true
        setMirror(local)
        CallVideoTracks.register(this)
    }
    override fun onDetachedFromWindow() {
        CallVideoTracks.unregister(this)
        release()
        ready = false
        super.onDetachedFromWindow()
    }
}
