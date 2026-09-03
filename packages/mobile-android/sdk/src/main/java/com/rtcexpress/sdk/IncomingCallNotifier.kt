package com.rtcexpress.sdk

/**
 * Hook for your app to show incoming-call UI and trigger push/VoIP when the app is backgrounded.
 * See docs/PUSH.md for FCM + ConnectionService integration.
 */
fun interface IncomingCallNotifier {
  fun onIncomingCall(invite: CallInvite, display: IncomingCallDisplay)
}

data class IncomingCallDisplay(
    val title: String,
    val body: String,
    val callId: String,
    val roomId: String,
    val fromUserId: String,
    val callType: String
) {
    companion object {
        fun from(invite: CallInvite): IncomingCallDisplay {
            val label = if (invite.callType == "video") "Video call" else "Voice call"
            return IncomingCallDisplay(
                title = label,
                body = "Incoming call from ${invite.fromUserId}",
                callId = invite.callId,
                roomId = invite.roomId,
                fromUserId = invite.fromUserId,
                callType = invite.callType
            )
        }
    }
}
