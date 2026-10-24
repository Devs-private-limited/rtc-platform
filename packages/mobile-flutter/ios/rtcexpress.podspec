Pod::Spec.new do |s|
  s.name             = 'rtcexpress'
  s.version          = '0.1.0'
  s.summary          = 'RTCExpress voice, video and chat SDK for Flutter'
  s.homepage         = 'https://rtc.devsquarelabs.com'
  s.license          = { :type => 'MIT' }
  s.author           = { 'Devsquare Labs' => 'support@devsquarelabs.com' }
  s.source           = { :path => '.' }
  # Classes/RTCExpress is synced from packages/mobile-ios by scripts/sync-native-sdks.mjs
  s.source_files     = 'Classes/**/*'
  s.dependency 'Flutter'
  s.dependency 'Mediasoup-Client-Swift', '0.13.2'
  s.platform = :ios, '15.0'
  s.swift_version = '5.9'
end
