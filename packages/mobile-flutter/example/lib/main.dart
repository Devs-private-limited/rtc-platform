import 'package:flutter/material.dart';
import 'package:rtcexpress/rtcexpress.dart';

void main() => runApp(const MyApp());

class MyApp extends StatefulWidget {
  const MyApp({super.key});

  @override
  State<MyApp> createState() => _MyAppState();
}

class _MyAppState extends State<MyApp> {
  final rtc = RTCExpress();
  String status = 'idle';

  @override
  void initState() {
    super.initState();
    rtc.on('connected', (p) => setState(() => status = 'connected ${p['userId']}'));
    rtc.on('roomJoined', (p) => setState(() => status = 'room ${p['roomId']}'));
    rtc.on('callInvite', (p) => setState(() => status = 'call from ${p['fromUserId']}'));
  }

  Future<void> connect() async {
    const serverUrl = 'https://rtcplatform.duckdns.org';
    final tokenRes = await RTCExpress.fetchToken(
      serverUrl,
      const TokenRequest(appId: 'demo', appSecret: 'demo-secret', userId: 'flutter-user'),
    );
    await rtc.init(RTCInitOptions(
      serverUrl: serverUrl,
      appId: 'demo',
      userId: 'flutter-user',
      token: tokenRes['token'] as String,
    ));
    await rtc.joinRoom('flutter-demo');
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
              ElevatedButton(onPressed: connect, child: const Text('Connect')),
            ],
          ),
        ),
      ),
    );
  }
}
