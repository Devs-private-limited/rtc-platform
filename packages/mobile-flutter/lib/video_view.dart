import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Android renderer for the active call. Place it inside bounded dimensions.
/// `local`: your own camera. `userId`: this person's camera (group video).
/// `screen`: a shared screen (this userId's, or the newest one).
class RTCVideoView extends StatelessWidget {
  final bool local;
  final String? userId;
  final bool screen;
  const RTCVideoView({super.key, this.local = false, this.userId, this.screen = false});

  @override
  Widget build(BuildContext context) {
    if (kIsWeb || defaultTargetPlatform != TargetPlatform.android) {
      throw UnsupportedError('RTCVideoView currently supports Android only');
    }
    return AndroidView(
      viewType: 'rtcexpress/video',
      creationParams: <String, dynamic>{'local': local, 'userId': userId ?? '', 'screen': screen},
      creationParamsCodec: const StandardMessageCodec(),
    );
  }
}
