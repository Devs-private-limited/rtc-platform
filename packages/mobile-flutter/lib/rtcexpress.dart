/// RTCExpress for Flutter: 1:1 and group voice calls, video calls, screen sharing
/// and in-app chat, with hosted signaling, TURN and media servers.
///
/// Docs: https://rtc.devsquarelabs.com/sdk/flutter
library;

import 'dart:async';
export 'video_view.dart';

import 'package:flutter/services.dart';

/// Called with the event's data map.
typedef RTCEventHandler = void Function(Map<String, dynamic> payload);

/// Settings passed to [RTCExpress.init].
class RTCInitOptions {
  /// RTCExpress server URL, for example `https://rtc.devsquarelabs.com`.
  final String serverUrl;

  /// Your project's App ID from the RTCExpress console.
  final String appId;

  /// The signed-in user's ID in your app.
  final String userId;

  /// A short-lived token created by your backend (never ship the App Secret in the app).
  final String token;

  /// `auto` (default), `p2p` or `sfu`.
  final String mediaMode;

  /// Android: show an "Ongoing call" notification (tap = back to the app, Hang up button)
  /// so calls keep working while the user is in another app or the screen is off.
  final bool ongoingCallNotification;

  /// Creates init options; [mediaMode] defaults to `auto`.
  const RTCInitOptions({
    required this.serverUrl,
    required this.appId,
    required this.userId,
    required this.token,
    this.mediaMode = 'auto',
    this.ongoingCallNotification = true,
  });

  /// Converts the options to the map sent to the native SDK.
  Map<String, dynamic> toMap() => {
        'serverUrl': serverUrl,
        'appId': appId,
        'userId': userId,
        'token': token,
        'mediaMode': mediaMode,
        'ongoingCallNotification': ongoingCallNotification,
      };
}

/// Token request for testing only. In production, create tokens on your server
/// with `rtcexpress-server` (Node.js or Python) so the App Secret stays private.
class TokenRequest {
  /// Your project's App ID.
  final String appId;

  /// Your project's App Secret (keep it on your server).
  final String appSecret;

  /// The user the token is for.
  final String userId;

  /// Optional room to limit the token to.
  final String? roomId;

  /// Creates a token request.
  const TokenRequest({
    required this.appId,
    required this.appSecret,
    required this.userId,
    this.roomId,
  });

  /// Converts the request to a map.
  Map<String, dynamic> toMap() => {
        'appId': appId,
        'appSecret': appSecret,
        'userId': userId,
        if (roomId != null) 'roomId': roomId,
      };
}

/// The RTCExpress client: connect, join a room, chat and make calls.
///
/// ```dart
/// final rtc = RTCExpress();
/// await rtc.init(RTCInitOptions(serverUrl: url, appId: appId, userId: 'alice', token: token));
/// await rtc.joinRoom('dm_alice__bob');
/// await rtc.callUser('bob');
/// ```
class RTCExpress {
  static const _channel = MethodChannel('rtcexpress');
  static const _events = EventChannel('rtcexpress/events');

  static Stream<Map<String, dynamic>>? _eventStream;

  /// Fetches a token directly from the server (testing only; see [TokenRequest]).
  static Future<Map<String, dynamic>> fetchToken(
    String serverUrl,
    TokenRequest request,
  ) async {
    final result = await _channel.invokeMapMethod<String, dynamic>(
      'fetchToken',
      {'serverUrl': serverUrl, 'request': request.toMap()},
    );
    return Map<String, dynamic>.from(result ?? {});
  }

  /// All SDK events as `{event, data}` maps.
  Stream<Map<String, dynamic>> get events {
    _eventStream ??= _events
        .receiveBroadcastStream()
        .map((e) => Map<String, dynamic>.from(e as Map));
    return _eventStream!;
  }

  /// Listens for one event, for example `connected`, `roomJoined`, `message`,
  /// `callInvite`, `callState`, `remoteMediaState`, `peerReconnecting` or `error`.
  void on(String eventName, RTCEventHandler handler) {
    events.listen((payload) {
      if (payload['event'] == eventName) {
        final data = payload['data'];
        handler(Map<String, dynamic>.from(data as Map? ?? {}));
      }
    });
  }

  /// Connects to RTCExpress with [options]. Call this first.
  Future<void> init(RTCInitOptions options) async {
    await _channel.invokeMethod('init', options.toMap());
  }

  /// Joins a chat/call room, for example `dm_<userA>__<userB>` for two people.
  Future<void> joinRoom(String roomId) async {
    await _channel.invokeMethod('joinRoom', {'roomId': roomId});
  }

  /// Sends a chat message to the current room.
  Future<void> sendMessage(String text, {String? clientMsgId}) async {
    await _channel.invokeMethod('sendMessage',
        {'text': text, if (clientMsgId != null) 'clientMsgId': clientMsgId});
  }

  /// Android history bridge; call after the roomJoined event.
  Future<Map<String, dynamic>> getHistory(String roomId,
      {String? before}) async {
    final result = await _channel.invokeMapMethod<String, dynamic>(
        'getHistory', {'roomId': roomId, if (before != null) 'before': before});
    return result ?? <String, dynamic>{};
  }

  /// Calls [peerUserId] in the current room; set [video] for a video call.
  Future<void> callUser(String peerUserId, {bool video = false}) async {
    await _channel.invokeMethod('callUser', {
      'peerUserId': peerUserId,
      'video': video,
    });
  }

  /// Accepts the incoming call.
  Future<void> acceptCall() async => _channel.invokeMethod('acceptCall');

  /// Rejects the incoming call.
  Future<void> rejectCall() async => _channel.invokeMethod('rejectCall');

  /// Ends the current call.
  Future<void> endCall() async => _channel.invokeMethod('endCall');

  /// Mutes or unmutes your microphone; others get a `remoteMediaState` event.
  Future<void> muteMicrophone(bool muted) async {
    await _channel.invokeMethod('muteMicrophone', {'muted': muted});
  }

  /// Turns your camera off or on; others get a `remoteMediaState` event.
  Future<void> muteCamera(bool muted) async {
    await _channel.invokeMethod('muteCamera', {'muted': muted});
  }

  /// Switches between the front and back camera.
  Future<void> switchCamera() async => _channel.invokeMethod('switchCamera');

  /// Android: share this phone's screen in the current call (plan must include screen sharing).
  /// Android first shows its own "Start recording or casting?" dialog. Listen to the
  /// 'screenShare' event ({userId, active, local, cancelled?}) and show others' screens with
  /// `RTCVideoView(screen: true)`.
  Future<void> startScreenShare() async =>
      _channel.invokeMethod('startScreenShare');

  /// Stops sharing your screen.
  Future<void> stopScreenShare() async =>
      _channel.invokeMethod('stopScreenShare');

  /// Disconnects and releases all resources.
  Future<void> destroy() async => _channel.invokeMethod('destroy');
}
