require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "RTCExpress"
  s.version      = package["version"]
  s.summary      = "RTCExpress voice, video and chat SDK for React Native"
  s.homepage     = "https://rtc.devsquarelabs.com"
  s.license      = "MIT"
  s.authors      = { "Devsquare Labs" => "support@devsquarelabs.com" }
  s.platforms    = { :ios => "15.0" }
  s.source       = { :path => "." }

  # ios/RTCExpress is synced from packages/mobile-ios by scripts/sync-native-sdks.mjs
  s.source_files = "ios/**/*.{h,m,mm,swift}"

  s.dependency "React-Core"
  s.dependency "Mediasoup-Client-Swift", "0.13.2"
end
