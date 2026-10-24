import 'package:flutter/material.dart';
import 'package:rtcexpress/rtcexpress.dart';

// Create a short-lived user token in the RTCExpress console (Token tools), then:
//   flutter run --dart-define=RTC_APP_ID=... --dart-define=RTC_USER_ID=alice \
//     --dart-define=RTC_ROOM_ID=demo-room --dart-define=RTC_TOKEN=...
// In a real app, fetch the token from your own backend. Never ship an App Secret.
const serverUrl = 'https://api.devsquarelabs.com';
const appId = String.fromEnvironment('RTC_APP_ID');
const userId = String.fromEnvironment('RTC_USER_ID', defaultValue: 'alice');
const roomId = String.fromEnvironment('RTC_ROOM_ID', defaultValue: 'demo-room');
const token = String.fromEnvironment('RTC_TOKEN');

void main() => runApp(const MyApp());

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  final rtc = RTCExpress();
  String status = appId.isEmpty || token.isEmpty ? 'Pass RTC_APP_ID and RTC_TOKEN with --dart-define' : 'idle';

  @override
  void initState() {
    super.initState();
    rtc.on('connected', (p) => setState(() => status = 'connected ${p['userId']}'));
    rtc.on('roomJoined', (p) => setState(() => status = 'room ${p['roomId']}'));
    rtc.on('callInvite', (p) => setState(() => status = 'call from ${p['fromUserId']}'));
    rtc.on('error', (p) => setState(() => status = 'error: ${p['message']}'));
  }

  Future<void> connect() async {
    await rtc.init(const RTCInitOptions(
      serverUrl: serverUrl,
      appId: appId,
      userId: userId,
      token: token,
    ));
    await rtc.joinRoom(roomId);
  }

  @override
  void dispose() {
    rtc.destroy();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('RTCExpress Flutter')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(status),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: appId.isEmpty || token.isEmpty ? null : connect,
                child: const Text('Connect'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
