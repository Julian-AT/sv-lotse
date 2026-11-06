import Foundation
import LotseProtocol

@MainActor
public final class SpeechPlaybackController {
    public var onControl: ((SpeechControl) -> Void)?
    public var onSentenceStart: ((SpeechSegment) -> Void)?
    /// True while queued speech is playing; the wake-word listener pauses meanwhile.
    public var onActivityChanged: ((Bool) -> Void)?
    public private(set) var isActive = false {
        didSet { if oldValue != isActive { onActivityChanged?(isActive) } }
    }
    public var speed: Double = 1 {
        didSet { speed = speed.isFinite ? min(VoiceConfiguration.maximumSpeed, max(VoiceConfiguration.minimumSpeed, speed)) : 1 }
    }
    private let primary: ElevenLabsSpeechOutput
    private let fallback = AppleSpeechOutput()
    private var queue: [SpeechSegment] = []
    private var task: Task<Void, Never>?
    private var current: SpeechSegment?
    private var turnID: String?
    private var seen: Set<Int> = []
    private var stoppedTurns: Set<String> = []
    private var generation = UUID()
    /// Answers are spoken only for turns asked by voice (⌥⌘, „Meine SV“, the chat's mic button).
    public private(set) var gate = VoiceTurnSpeechGate()

    public init(loadToken: @escaping VoiceTokenLoader) { primary = ElevenLabsSpeechOutput(loadToken: loadToken) }

    /// A spoken question was sent: its answer may speak, and the TTS socket opens while the brain thinks.
    public func allowSpeechForVoiceTurn(language: String? = nil) {
        gate.voiceQuestionSent()
        if let language { primary.prewarm(language: language) }
    }

    public func silenceUntilNextVoiceQuestion() {
        gate.closed()
        primary.discardWarm()
    }

    public func enqueue(_ segment: SpeechSegment) {
        guard gate.isOpen else { return }
        guard stoppedTurns.contains(segment.turnID) == false, segment.text.isEmpty == false else { return }
        if turnID != segment.turnID {
            stop(notify: false)
            turnID = segment.turnID
            seen.removeAll()
        }
        guard seen.insert(segment.index).inserted else { return }
        queue.append(segment)
        if task == nil { drain() }
    }

    public func handle(_ control: SpeechControl) {
        guard control.stop else { return }
        // The workspace stops speech when the user types or presses stop: stay silent until the next voice question.
        silenceUntilNextVoiceQuestion()
        stop(notify: false)
        onControl?(.init(segmentIndex: control.segmentIndex, state: .idle, stop: false))
    }

    public func stop(notify: Bool = true) {
        let index = current?.index ?? 0
        if let turnID { stoppedTurns.insert(turnID) }
        generation = UUID()
        task?.cancel()
        task = nil
        queue.removeAll()
        current = nil
        primary.stop()
        fallback.stop()
        isActive = false
        if notify { onControl?(.init(segmentIndex: index, state: .idle, stop: true)) }
    }

    private func drain() {
        let generation = generation
        isActive = true
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            while queue.isEmpty == false, Task.isCancelled == false, self.generation == generation {
                let segment = queue.removeFirst()
                current = segment
                let onStart: () -> Void = { [weak self] in
                    guard let self, self.generation == generation else { return }
                    onSentenceStart?(segment)
                    onControl?(.init(segmentIndex: segment.index, state: .speaking, stop: false))
                }
                do {
                    try await primary.speak(segment, speed: speed, onStart: onStart)
                    VoiceProviderStatus.shared.usingElevenLabs()
                } catch {
                    guard Task.isCancelled == false, self.generation == generation else { return }
                    let started = primary.didStart
                    primary.stop()
                    if started == false { await speakWithFreshConnection(segment, onStart: onStart) }
                }
                guard self.generation == generation, Task.isCancelled == false else { return }
                onControl?(.init(segmentIndex: segment.index, state: .idle, stop: false))
                current = nil
            }
            if self.generation == generation {
                task = nil
                isActive = false
            }
        }
    }

    private func speakWithFreshConnection(_ segment: SpeechSegment, onStart: @escaping () -> Void) async {
        do {
            try await primary.speak(segment, speed: speed, onStart: onStart)
            VoiceProviderStatus.shared.usingElevenLabs()
        } catch {
            guard Task.isCancelled == false else { return }
            let started = primary.didStart
            primary.stop()
            guard started == false else { return }
            VoiceProviderStatus.shared.fellBack(error)
            await fallback.speak(segment, speed: speed, onStart: onStart)
        }
    }
}

/// Typed turns stay silent. Opens when a spoken question is sent, closes when the workspace stops
/// (a typed message, the stop button, a new page).
public struct VoiceTurnSpeechGate: Sendable, Equatable {
    public private(set) var isOpen = false
    public init() {}
    public mutating func voiceQuestionSent() { isOpen = true }
    public mutating func closed() { isOpen = false }
}
