import AVFoundation
import Foundation
import os

/// 16-bit mono PCM at `VoiceConfiguration.sampleRate`, as Scribe expects it.
@MainActor
protocol ScribeAudioSource: AnyObject {
    var chunks: AsyncStream<Data> { get }
    func stop()
}

@MainActor
final class ScribeAudioInput: ScribeAudioSource {
    private let engine = AVAudioEngine()
    private var running = false
    let chunks: AsyncStream<Data>
    private let continuation: AsyncStream<Data>.Continuation

    init() throws {
        (chunks, continuation) = AsyncStream.makeStream()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw TranscriptionError.invalidAudioFormat }
        let resampler = try PCMResampler(from: format)
        let continuation = continuation
        input.installTap(onBus: 0, bufferSize: VoiceConfiguration.inputBufferSize, format: format,
                         block: Self.tap(continuation, resampler: resampler))
        running = true
        engine.prepare()
        do { try engine.start() } catch { stop(); throw error }
    }

    func stop() {
        guard running else { return }
        running = false
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        continuation.finish()
    }

    /// Built outside the main actor: the tap runs on the realtime audio thread.
    nonisolated private static func tap(
        _ continuation: AsyncStream<Data>.Continuation, resampler: PCMResampler
    ) -> AVAudioNodeTapBlock {
        { buffer, _ in
            VoiceInputLevel.measure(buffer)
            if let data = resampler.convert(buffer), data.isEmpty == false { continuation.yield(data) }
        }
    }
}

/// One converter for the whole capture. A converter per buffer drops its filter state and priming
/// samples at every buffer edge, which chops the audio Scribe hears into clicks and gaps.
final class PCMResampler: @unchecked Sendable {
    private let converter: AVAudioConverter
    private let output: AVAudioFormat
    private let ratio: Double
    private let lock = OSAllocatedUnfairLock()

    init(from input: AVAudioFormat) throws {
        guard let output = AVAudioFormat(
            commonFormat: .pcmFormatInt16, sampleRate: VoiceConfiguration.sampleRate, channels: 1, interleaved: true
        ), let converter = AVAudioConverter(from: input, to: output) else { throw TranscriptionError.invalidAudioFormat }
        self.output = output
        self.converter = converter
        ratio = output.sampleRate / input.sampleRate
    }

    /// Called serially from the audio thread (or a test); returns little-endian Int16 bytes.
    func convert(_ input: AVAudioPCMBuffer) -> Data? {
        lock.withLockUnchecked {
            let capacity = AVAudioFrameCount((Double(input.frameLength) * ratio).rounded(.up)) + 64
            guard let buffer = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: capacity) else { return nil }
            let feed = PCMFeed(input)
            var error: NSError?
            let status = converter.convert(to: buffer, error: &error) { _, outStatus in
                guard let next = feed.take() else { outStatus.pointee = .noDataNow; return nil }
                outStatus.pointee = .haveData
                return next
            }
            guard status != .error, error == nil, let bytes = buffer.int16ChannelData?.pointee else { return nil }
            return Data(bytes: bytes, count: Int(buffer.frameLength) * MemoryLayout<Int16>.size)
        }
    }
}

/// Hands the tap's buffer to the converter exactly once. The converter calls back synchronously
/// inside `convert`, on the same thread, while the tap's buffer is still valid.
private final class PCMFeed: @unchecked Sendable {
    private var buffer: AVAudioPCMBuffer?
    init(_ buffer: AVAudioPCMBuffer) { self.buffer = buffer }
    func take() -> AVAudioPCMBuffer? {
        defer { buffer = nil }
        return buffer
    }
}
