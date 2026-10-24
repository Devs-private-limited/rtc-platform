import Foundation
import AVFoundation

public final class CallRecorder {
    private var recorder: AVAudioRecorder?
    private var outputURL: URL?
    private var startedAt: Date?

    public var isRecording: Bool { recorder != nil }

    public init() {}

    public func startRecording() throws -> URL {
        if recorder != nil { throw NSError(domain: "RTCExpress", code: 20, userInfo: [NSLocalizedDescriptionKey: "Already recording"]) }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

        let url = FileManager.default.temporaryDirectory.appendingPathComponent("rtc-call-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44_100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]
        let audioRecorder = try AVAudioRecorder(url: url, settings: settings)
        audioRecorder.record()
        recorder = audioRecorder
        outputURL = url
        startedAt = Date()
        return url
    }

    public func stopRecording() throws -> RecordingResult {
        guard let audioRecorder = recorder, let url = outputURL, let startedAt else {
            throw NSError(domain: "RTCExpress", code: 21, userInfo: [NSLocalizedDescriptionKey: "Not recording"])
        }
        audioRecorder.stop()
        recorder = nil
        let attrs = try FileManager.default.attributesOfItem(atPath: url.path)
        let size = attrs[.size] as? Int64 ?? 0
        let durationMs = Int64(Date().timeIntervalSince(startedAt) * 1000)
        self.outputURL = nil
        self.startedAt = nil
        return RecordingResult(fileURL: url, durationMs: durationMs, mimeType: "audio/mp4", sizeBytes: size)
    }
}
