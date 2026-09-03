// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "RTCExpress",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "RTCExpress", targets: ["RTCExpress"])
    ],
    dependencies: [
        .package(url: "https://github.com/stasel/WebRTC.git", .upToNextMajor(from: "124.0.0"))
    ],
    targets: [
        .target(
            name: "RTCExpress",
            dependencies: [.product(name: "WebRTC", package: "WebRTC")]
        )
    ]
)
