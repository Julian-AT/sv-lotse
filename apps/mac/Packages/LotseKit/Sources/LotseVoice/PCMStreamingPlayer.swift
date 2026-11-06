import AVFoundation
import Foundation

@MainActor
final class PCMStreamingPlayer {
    var onStart: (() -> Void)?
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let pitch = AVAudioUnitTimePitch()
    private var pending = 0
    private var started = false
    private var final = false
    private var completion: CheckedContinuation<Void, Never>?

    init(speed: Double) throws {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: VoiceConfiguration.sampleRate, channels: 1)
        else { throw VoiceServiceError.invalidAudio }
        engine.attach(player)
        engine.attach(pitch)
        pitch.rate = Float(speed)
        engine.connect(player, to: pitch, format: format)
        engine.connect(pitch, to: engine.mainMixerNode, format: format)
        try engine.start()
    }

    func append(_ data: Data) throws {
        guard data.isEmpty == false else { return }
        let samples = data.count / MemoryLayout<Int16>.size
        guard data.count.isMultiple(of: MemoryLayout<Int16>.size), samples > 0,
            let format = AVAudioFormat(standardFormatWithSampleRate: VoiceConfiguration.sampleRate, channels: 1),
            let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples)),
            let output = buffer.floatChannelData?.pointee else { throw VoiceServiceError.invalidAudio }
        buffer.frameLength = AVAudioFrameCount(samples)
        data.withUnsafeBytes { bytes in
            for index in 0..<samples {
                let value = bytes.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)
                output[index] = Float(Int16(littleEndian: value)) / Float(Int16.max)
            }
        }
        pending += 1
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in self?.playedBuffer() }
        }
        if started == false {
            started = true
            onStart?()
            player.play()
        }
    }

    func finish() async {
        final = true
        if pending == 0 { return }
        await withCheckedContinuation { completion = $0 }
    }

    func stop() {
        player.stop()
        engine.stop()
        pending = 0
        completion?.resume()
        completion = nil
    }

    private func playedBuffer() {
        pending = max(0, pending - 1)
        if final, pending == 0 { completion?.resume(); completion = nil }
    }
}
