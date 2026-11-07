package com.rtcexpress.reactnative

import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.rtcexpress.sdk.CallVideoView

class RTCVideoViewManager : SimpleViewManager<CallVideoView>() {
    override fun getName() = "RTCVideoView"
    override fun createViewInstance(context: ThemedReactContext) = CallVideoView(context)
    @ReactProp(name = "local", defaultBoolean = false)
    fun setLocal(view: CallVideoView, local: Boolean) { view.local = local }
    /** Group video: show this person's camera. */
    @ReactProp(name = "userId")
    fun setUserId(view: CallVideoView, userId: String?) { view.userId = userId }
}
