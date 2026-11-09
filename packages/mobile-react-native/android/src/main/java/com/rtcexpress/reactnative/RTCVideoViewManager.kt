package com.rtcexpress.reactnative

import android.content.Context
import android.graphics.Color
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.rtcexpress.sdk.CallVideoView

/**
 * Holds the video. Cameras fill the box (edges cropped, like most call apps); a shared screen is
 * shown whole (aspect fit, black bars), so nothing on the presenter's screen is cut off.
 */
class RTCVideoContainer(context: Context) : FrameLayout(context) {
    val video = CallVideoView(context)
    private val relayout = Runnable {
        measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY), MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
        layout(left, top, right, bottom)
    }

    init {
        setBackgroundColor(Color.BLACK)
        addView(video, LayoutParams(MATCH_PARENT, MATCH_PARENT, Gravity.CENTER))
    }

    fun setScreen(screen: Boolean) {
        video.screen = screen
        val size = if (screen) WRAP_CONTENT else MATCH_PARENT
        video.layoutParams = LayoutParams(size, size, Gravity.CENTER)
    }

    // React Native does not lay out native children again when the video size changes,
    // so do it ourselves (the renderer asks for a new layout when the frame size changes).
    override fun requestLayout() {
        super.requestLayout()
        @Suppress("SENSELESS_COMPARISON")
        if (relayout != null) post(relayout)
    }
}

class RTCVideoViewManager : SimpleViewManager<RTCVideoContainer>() {
    override fun getName() = "RTCVideoView"
    override fun createViewInstance(context: ThemedReactContext) = RTCVideoContainer(context)
    @ReactProp(name = "local", defaultBoolean = false)
    fun setLocal(view: RTCVideoContainer, local: Boolean) { view.video.local = local }
    /** Group video: show this person's camera. */
    @ReactProp(name = "userId")
    fun setUserId(view: RTCVideoContainer, userId: String?) { view.video.userId = userId }
    /** Show a shared screen (of userId, or the newest one) instead of a camera. */
    /** Draw above other video (small tiles over a big video). Default: true for the self-view. */
    @ReactProp(name = "overlay")
    fun setOverlay(view: RTCVideoContainer, overlay: Boolean?) { view.video.overlay = overlay }
    @ReactProp(name = "screen", defaultBoolean = false)
    fun setScreen(view: RTCVideoContainer, screen: Boolean) { view.setScreen(screen) }
}
