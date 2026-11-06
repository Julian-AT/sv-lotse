import AVFoundation
import Foundation
import Testing

@testable import LotseVoice

/// Feeds a file through the same resampler the microphone tap uses, paced like a live microphone.
@MainActor
final class FileAudioSource: ScribeAudioSource {
    let chunks: AsyncStream<Data>
    private let continuation: AsyncStream<Data>.Continuation
    private var feeder: Task<Void, Never>?
    private(set) var stopped = false
    /// Set when the last chunk of the file was yielded (the "speaker" stopped talking).
    var onDrained: (() -> Void)?

    init(buffers: [AVAudioPCMBuffer], pace: Duration) throws {
        (chunks, continuation) = AsyncStream.makeStream()
        guard let format = buffers.first?.format else { throw TranscriptionError.invalidAudioFormat }
        let resampler = try PCMResampler(from: format)
        let continuation = continuation
        feeder = Task { @MainActor [weak self] in
            for buffer in buffers {
                if let data = resampler.convert(buffer), data.isEmpty == false { continuation.yield(data) }
                try? await Task.sleep(for: pace)
                if self?.stopped == true { return }
            }
            self?.onDrained?()
        }
    }

    func stop() {
        stopped = true
        continuation.finish()
    }

    /// Microphone-like buffers: 48 kHz mono float, 2048 frames each, with leading and trailing silence.
    static func microphoneBuffers(of url: URL, frames: AVAudioFrameCount = 2048) throws -> [AVAudioPCMBuffer] {
        let file = try AVAudioFile(forReading: url)
        guard let target = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1),
              let converter = AVAudioConverter(from: file.processingFormat, to: target),
              let source = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))
        else { throw TranscriptionError.invalidAudioFormat }
        try file.read(into: source)
        let capacity = AVAudioFrameCount(Double(source.frameLength) * 48000 / file.processingFormat.sampleRate) + 4096
        guard let whole = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { throw TranscriptionError.invalidAudioFormat }
        var fed = false
        var error: NSError?
        converter.convert(to: whole, error: &error) { _, status in
            if fed { status.pointee = .endOfStream; return nil }
            fed = true
            status.pointee = .haveData
            return source
        }
        if let error { throw error }
        let silence = [Float](repeating: 0, count: 14400)
        let samples = silence + Array(UnsafeBufferPointer(start: whole.floatChannelData?[0], count: Int(whole.frameLength))) + silence
        return stride(from: 0, to: samples.count, by: Int(frames)).compactMap { start in
            let slice = samples[start..<min(start + Int(frames), samples.count)]
            guard let buffer = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: frames) else { return nil }
            buffer.frameLength = AVAudioFrameCount(slice.count)
            for (offset, sample) in slice.enumerated() { buffer.floatChannelData?[0][offset] = sample }
            return buffer
        }
    }
}

func sineBuffers(count: Int, frames: AVAudioFrameCount = 2048) -> [AVAudioPCMBuffer] {
    guard let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1) else { return [] }
    var phase = 0.0
    return (0..<count).compactMap { _ in
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        for index in 0..<Int(frames) {
            buffer.floatChannelData?[0][index] = Float(sin(phase) * 0.5)
            phase += 2 * .pi * 440 / 48000
        }
        return buffer
    }
}

@Test("Scribe capture resamples the microphone with one converter and keeps every sample")
func resamplerKeepsContinuousAudio() throws {
    let buffers = sineBuffers(count: 50)
    let resampler = try PCMResampler(from: buffers[0].format)
    let continuous = buffers.compactMap { resampler.convert($0) }.reduce(0) { $0 + $1.count / 2 }
    // 50 × 2048 frames at 48 kHz are 51 200 frames at 24 kHz; the converter may hold back a few for its filter.
    #expect(abs(continuous - 51200) < 64)
    // The previous per-buffer converter lost its filter priming at every edge.
    let perBuffer = try buffers.compactMap { try PCMResampler(from: $0.format).convert($0) }.reduce(0) { $0 + $1.count / 2 }
    #expect(perBuffer < continuous)
}

@Test("Scribe keeps the question when the key is released while the socket is still connecting")
@MainActor
func releaseDuringHandshakeKeepsAudio() async throws {
    let source = try FileAudioSource(buffers: sineBuffers(count: 3), pace: .zero)
    let gate = AsyncStream<Void>.makeStream()
    let provider = ScribeRealtimeTranscriptionProvider(
        loadToken: { _, _ in
            for await _ in gate.stream { break }
            throw VoiceServiceError.unavailable
        },
        language: { "de" }, makeInput: { source }, requestAccess: { true }
    )
    var held = true
    let start = Task { @MainActor in try await provider.start(whileHeld: { held }) }
    try await Task.sleep(for: .milliseconds(20))
    held = false
    provider.finish()
    #expect(source.stopped)
    gate.continuation.yield()
    await #expect(throws: VoiceServiceError.self) { try await start.value }
}

@Test("Scribe cancel during the handshake stops the microphone and aborts")
@MainActor
func cancelDuringHandshake() async throws {
    let source = try FileAudioSource(buffers: sineBuffers(count: 3), pace: .zero)
    let gate = AsyncStream<Void>.makeStream()
    let provider = ScribeRealtimeTranscriptionProvider(
        loadToken: { _, _ in
            for await _ in gate.stream { break }
            return VoiceToken(token: "t", voiceId: nil, modelId: nil, vocabulary: nil)
        },
        language: { "de" }, makeInput: { source }, requestAccess: { true }
    )
    let start = Task { @MainActor in try await provider.start(whileHeld: { true }) }
    try await Task.sleep(for: .milliseconds(20))
    provider.cancel()
    #expect(source.stopped)
    gate.continuation.yield()
    await #expect(throws: CancellationError.self) { try await start.value }
}
