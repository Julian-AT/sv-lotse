import SwiftUI

/// The capture state behind the cursor: Clicky's waveform while speech is captured, its spinner
/// while the transcript and answer are on their way, and a small bubble for the live transcript or an error.
public struct ListeningIndicator: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case hidden, listening, sending
        case error(String)
    }

    public private(set) var phase: Phase = .hidden
    public private(set) var level = 0.0
    public private(set) var partial = ""

    public init() {}

    public var isVisible: Bool { phase != .hidden }

    public mutating func begin() {
        phase = .listening
        level = 0
        partial = ""
    }

    public mutating func update(level: Double) {
        guard phase == .listening else { return }
        // Fast attack, slower release keeps the meter readable.
        let clamped = min(max(level, 0), 1)
        self.level = clamped > self.level ? clamped : self.level * 0.6 + clamped * 0.4
    }

    public mutating func update(partial text: String) {
        guard phase == .listening || phase == .sending else { return }
        partial = text
    }

    /// The key or button was released, or the final transcript arrived: the answer is on its way.
    public mutating func release() {
        guard phase == .listening else { return }
        phase = .sending
        level = 0
    }

    public mutating func fail(_ message: String) {
        phase = .error(message)
        level = 0
    }

    public mutating func hide() {
        phase = .hidden
        level = 0
        partial = ""
    }
}
