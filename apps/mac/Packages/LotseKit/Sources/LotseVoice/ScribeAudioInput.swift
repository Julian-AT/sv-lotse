import AVFoundation
import Foundation
import os

@MainActor
final class ScribeAudioInput {
    private let engine = AVAudioEngine()
    private var running = false
    let chunks: AsyncStream<Data>
    private let continuation: AsyncStream<Data>.Continuation

    init() throws {
        (chunks, continuation) = AsyncStream.makeStream()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw TranscriptionError.invalidAudioFormat }
        let continuation = continuation
        input.installTap(onBus: 0, bufferSize: VoiceConfiguration.inputBufferSize, format: format, block: Self.tap(continuation))
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
    nonisolated private static func tap(_ continuation: AsyncStream<Data>.Continuation) -> AVAudioNodeTapBlock {
        { buffer, _ in
            VoiceInputLevel.measure(buffer)
            if let data = pcm(buffer) { continuation.yield(data) }
        }
    }

    nonisolated private static func pcm(_ input: AVAudioPCMBuffer) -> Data? {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatInt16, sampleRate: VoiceConfiguration.sampleRate, channels: 1, interleaved: true
        ), let converter = AVAudioConverter(from: input.format, to: format),
            let output = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(Double(input.frameLength) * format.sampleRate / input.format.sampleRate) + 1
            ) else { return nil }
        // The converter's Sendable callback receives owned bytes, never the tap's borrowed buffer.
        let feed = OSAllocatedUnfairLock(initialState: Optional(AudioPCMChunk(input)))
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            let chunk = feed.withLock { chunk in
                let current = chunk
                chunk = nil
                return current
            }
            guard let buffer = chunk?.makeBuffer() else { status.pointee = .noDataNow; return nil }
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, let bytes = output.int16ChannelData?.pointee else { return nil }
        return Data(bytes: bytes, count: Int(output.frameLength) * MemoryLayout<Int16>.size)
    }
}

private struct AudioPCMChunk: Sendable {
    let commonFormat: UInt
    let sampleRate: Double
    let channels: UInt32
    let interleaved: Bool
    let frames: UInt32
    let buffers: [Data]

    init(_ input: AVAudioPCMBuffer) {
        commonFormat = input.format.commonFormat.rawValue
        sampleRate = input.format.sampleRate
        channels = input.format.channelCount
        interleaved = input.format.isInterleaved
        frames = input.frameLength
        buffers = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList).map { buffer in
            guard let bytes = buffer.mData else { return Data() }
            return Data(bytes: bytes, count: Int(buffer.mDataByteSize))
        }
    }

    func makeBuffer() -> AVAudioPCMBuffer? {
        guard let common = AVAudioCommonFormat(rawValue: commonFormat),
            let format = AVAudioFormat(commonFormat: common, sampleRate: sampleRate, channels: channels, interleaved: interleaved),
            let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        output.frameLength = frames
        for (index, buffer) in UnsafeMutableAudioBufferListPointer(output.mutableAudioBufferList).enumerated() {
            guard let destination = buffer.mData, index < buffers.count else { return nil }
            buffers[index].copyBytes(to: destination.assumingMemoryBound(to: UInt8.self), count: Int(buffer.mDataByteSize))
        }
        return output
    }
}
