# Push notifications & background incoming calls

RTCExpress delivers **in-app** call invites over WebSocket. When your app is backgrounded or killed, you need **FCM (Android)** or **APNs + PushKit (iOS)** to wake the app and show a ring UI.

## Required: each customer app needs its own Firebase project

FCM device tokens belong to the Firebase project the app is built with (`google-services.json`). RTCExpress can only send to them with **that same project's** service-account key. So every customer creates their own Firebase project. RTCExpress's own Firebase project is only for our demo/test apps. End users never set up Firebase.

## Option A (recommended): RTCExpress sends the push (managed push)

```
Caller taps "Call"
    → RTCExpress signaling looks up callee's registered devices
    → Sends FCM (Android) / APNs VoIP (iOS) using the customer's uploaded key
    → Callee app wakes → shows incoming call UI → reconnects → acceptCall()
```

Customer setup, once per app:

1. Create a Firebase project and add the Android app with its exact package name.
2. Put `google-services.json` in the app and add `firebase-messaging`.
3. Firebase console → Project settings → Service accounts → **Generate new private key**.
4. Upload that JSON in the customer portal: **Service management → In-app chat → Android offline push**. Do not upload `google-services.json`. For iOS, upload an APNs `.p8` key with the Bundle ID.
5. After login and on every token refresh, register the device: `POST /v1/push/devices` (see [OFFLINE-NOTIFICATIONS.md](OFFLINE-NOTIFICATIONS.md)). Unregister on logout.
6. Handle the `rtc_call_invite` data message (below). Ignore it if `expiresAt` has passed.

Call invites use a TTL equal to the remaining ring time (60 seconds max). A phone that is off longer than that never rings for an old call.

## Option B: your backend sends the push (webhook)

If the customer prefers to send pushes from their own server:

1. Listen for `call.ringing` webhook from RTC signaling
2. Look up the callee's device push token (stored in your DB)
3. Send FCM/APNs data message with call metadata

Do not enable both options for the same device unless the client deduplicates by `callId`.

## Webhook payload (`call.ringing`)

```json
{
  "type": "call.ringing",
  "appId": "demo-app",
  "data": {
    "callId": "uuid",
    "roomId": "ride-123",
    "fromUserId": "customer-1",
    "toUserId": "driver-9",
    "callType": "voice"
  }
}
```

Register webhooks in the dashboard **Webhooks** tab or via admin API.

## Android — FCM data message

Example payload your server sends via Firebase:

```json
{
  "to": "<driver-fcm-token>",
  "data": {
    "type": "rtc_call_invite",
    "callId": "uuid",
    "roomId": "ride-123",
    "fromUserId": "customer-1",
    "callType": "voice"
  },
  "priority": "high"
}
```

In your `FirebaseMessagingService`:

```kotlin
override fun onMessageReceived(message: RemoteMessage) {
    if (message.data["type"] != "rtc_call_invite") return
    val invite = CallInvite(
        callId = message.data["callId"]!!,
        roomId = message.data["roomId"]!!,
        fromUserId = message.data["fromUserId"]!!,
        toUserId = currentUserId,
        callType = message.data["callType"] ?: "voice"
    )
    // Show full-screen incoming call UI (ConnectionService recommended)
    incomingCallService.show(invite)
}
```

### SDK hook — `IncomingCallNotifier`

```kotlin
rtc.setIncomingCallNotifier { invite, display ->
    // Called when WebSocket delivers call_invite while app is foreground
    showInAppRingingUI(display.title, display.body)
}
```

For background rings, use **ConnectionService** + FCM as above.

## iOS — PushKit + CallKit

1. Enable **Push Notifications** + **Background Modes → Voice over IP**
2. Register for PushKit VoIP pushes
3. On push, report incoming call to **CallKit** (`CXProvider.reportNewIncomingCall`)
4. On user answer → connect RTCExpress, `joinRoom`, `acceptCall()`

Example push payload (sent by your server via APNs):

```json
{
  "aps": { "content-available": 1 },
  "rtc": {
    "type": "call_invite",
    "callId": "uuid",
    "roomId": "ride-123",
    "fromUserId": "customer-1",
    "callType": "voice"
  }
}
```

### SDK hook — `IncomingCallNotifier`

```swift
rtc.incomingCallNotifier = self

func onIncomingCall(_ invite: CallInvite, display: IncomingCallDisplay) {
    // Foreground: show in-app ring UI
}
```

## Uber / ride-app flow

| Step | Who |
|------|-----|
| Create room `ride-{id}` when ride accepted | Your backend |
| Issue tokens for customer + driver | Your backend `POST /v1/token` |
| Both `joinRoom("ride-{id}")` | Mobile apps |
| Customer taps Call | `rtc.callUser("driver-id")` |
| Driver offline | Your backend sends FCM/APNs from `call.ringing` webhook |
| Driver answers | `acceptCall()` |

## Token refresh

Push only wakes the app — you still need a **fresh JWT** before connecting:

```kotlin
val token = RTCExpress.fetchToken(serverUrl, TokenRequest(appId, appSecret, userId))
rtc.init(RTCInitOptions(serverUrl, appId, userId, token.token))
rtc.joinRoom(roomId)
rtc.acceptCall()
```

Store `callId`, `roomId`, `fromUserId` from the push payload until the user answers.
