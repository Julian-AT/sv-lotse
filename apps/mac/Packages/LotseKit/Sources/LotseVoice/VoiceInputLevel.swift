import AVFoundation
import Foundation

/// The live microphone level of the current capture, 0...1, for the listening indicator's meter.
@MainActor
public final class VoiceInputLevel {
    public static let shared = VoiceInputLevel()
    public var onLevel: ((Double) -> Void)?

    public init() {}

    public func report(_ level: Double) { onLevel?(min(max(level, 0), 1)) }

    /// Runs on the realtime audio thread: computes the level and hops to the main actor.
    nonisolated static func measure(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        let count = Int(buffer.frameLength)
        var sum: Float = 0
        for index in 0..<count { sum += channel[index] * channel[index] }
        let level = Self.normalized(rms: Double((sum / Float(count)).squareRoot()))
        Task { @MainActor in VoiceInputLevel.shared.report(level) }
    }

    /// Maps RMS to a perceptual 0...1 scale: -50 dBFS is silent, -10 dBFS is full.
    nonisolated static func normalized(rms: Double) -> Double {
        guard rms > 0 else { return 0 }
        let decibels = 20 * log10(rms)
        return min(max((decibels + 50) / 40, 0), 1)
    }
}
