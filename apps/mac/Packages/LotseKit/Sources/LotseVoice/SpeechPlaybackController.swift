import Foundation
import LotseProtocol
import os

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
    private(set) var current: SpeechSegment?
    private var turnID: String?
    private var seen: Set<Int> = []
    private var stoppedTurns: Set<String> = []
    private var generation = UUID()
    /// Answers are spoken only for turns asked by voice (⌥⌘, „Meine SV“, the chat's mic button).
    public private(set) var gate = VoiceTurnSpeechGate()
    var acknowledgements = AcknowledgementClips()
    private(set) var acknowledging = false
    private let playClip: AcknowledgementPlayer
    private let acknowledgementGrace: Duration
    private var acknowledgement: Task<Void, Never>?
    private var acknowledgementID = UUID()
    private var acknowledgedTurn = AcknowledgedTurn.none
    private var preparing: Set<String> = []
    /// Tour narration lines waiting to finish, by turn and index.
    private var narrationWaiters: [String: CheckedContinuation<Void, Never>] = [:]
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")

    public convenience init(loadToken: @escaping VoiceTokenLoader) {
        self.init(loadToken: loadToken, playClip: playAcknowledgement, acknowledgementGrace: VoiceConfiguration.acknowledgementGrace)
    }

    init(loadToken: @escaping VoiceTokenLoader, playClip: @escaping AcknowledgementPlayer, acknowledgementGrace: Duration) {
        primary = ElevenLabsSpeechOutput(loadToken: loadToken)
        self.playClip = playClip
        self.acknowledgementGrace = acknowledgementGrace
    }

    /// A spoken question was sent: its answer may speak, the TTS socket opens while the brain thinks, and a
    /// cached acknowledgement plays unless the answer starts within the grace period.
    public func allowSpeechForVoiceTurn(language: String? = nil) {
        gate.voiceQuestionSent()
        guard let language else { return }
        primary.prewarm(language: language)
        acknowledge(language: ElevenLabsSpeechOutput.ttsLanguage(language))
    }

    public func silenceUntilNextVoiceQuestion() {
        gate.closed()
        cancelAcknowledgement()
    }

    /// Renders the acknowledgement clips in the configured voice once per language.
    public func prepareAcknowledgements(language: String) {
        let language = ElevenLabsSpeechOutput.ttsLanguage(language)
        guard acknowledgements.has(language) == false, preparing.insert(language).inserted else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { preparing.remove(language) }
            do {
                let rendered = try await primary.render(AcknowledgementCopy.lines(language), language: language)
                acknowledgements.store(rendered.clips, voice: rendered.voice, language: language)
                log.info("Acknowledgement clips ready for \(language, privacy: .public)")
            } catch {
                log.error("Acknowledgement clips failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    public func enqueue(_ segment: SpeechSegment) {
        guard gate.isOpen else { return }
        guard stoppedTurns.contains(segment.turnID) == false, segment.text.isEmpty == false else { return }
        if turnID != segment.turnID {
            stopTurn(notify: false)
            turnID = segment.turnID
            seen.removeAll()
            if acknowledgedTurn == .next { acknowledgedTurn = .turn(segment.turnID) }
        }
        guard seen.insert(segment.index).inserted else { return }
        if acknowledgedTurn == .turn(segment.turnID), AcknowledgementCopy.isStatusLine(segment.text) { return }
        if acknowledging == false { cancelAcknowledgement() }
        queue.append(segment)
        prefetchQueued()
        if task == nil { drain() }
    }

    /// Speaks one line of a guided page tour, also after a typed message (the person asked to be
    /// shown the page), and returns when the line finished, was stopped or was replaced by a new
    /// answer. Lines of one tour share a turn id and play in order after anything already playing.
    public func narrate(_ segment: SpeechSegment) async {
        guard segment.text.isEmpty == false, stoppedTurns.contains(segment.turnID) == false else { return }
        let key = Self.narrationKey(segment)
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            narrationWaiters[key]?.resume()
            narrationWaiters[key] = continuation
            if acknowledging == false { cancelAcknowledgement() }
            queue.append(segment)
            prefetchQueued()
            if task == nil { drain() }
        }
    }

    private static func narrationKey(_ segment: SpeechSegment) -> String { "\(segment.turnID)#\(segment.index)" }

    private func finishNarration(_ segment: SpeechSegment) {
        narrationWaiters.removeValue(forKey: Self.narrationKey(segment))?.resume()
    }

    private func finishAllNarration() {
        let waiters = narrationWaiters.values
        narrationWaiters.removeAll()
        for waiter in waiters { waiter.resume() }
    }

    public func handle(_ control: SpeechControl) {
        guard control.stop else { return }
        // The workspace stops speech when the user types or presses stop: stay silent until the next voice question.
        silenceUntilNextVoiceQuestion()
        stop(notify: false)
        onControl?(.init(segmentIndex: control.segmentIndex, state: .idle, stop: false))
    }

    public func stop(notify: Bool = true) {
        cancelAcknowledgement()
        stopTurn(notify: notify)
    }

    private func stopTurn(notify: Bool) {
        let index = current?.index ?? 0
        if let turnID { stoppedTurns.insert(turnID) }
        generation = UUID()
        task?.cancel()
        task = nil
        queue.removeAll()
        current = nil
        primary.stop()
        fallback.stop()
        finishAllNarration()
        isActive = acknowledging
        if notify { onControl?(.init(segmentIndex: index, state: .idle, stop: true)) }
    }

    private func drain() {
        let generation = generation
        isActive = true
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            while queue.isEmpty == false, Task.isCancelled == false, self.generation == generation {
                if let acknowledgement { await acknowledgement.value }
                guard self.generation == generation, Task.isCancelled == false else { return }
                let segment = queue.removeFirst()
                prefetchQueued()
                current = segment
                let onStart: () -> Void = { [weak self] in
                    guard let self, self.generation == generation else { return }
                    onSentenceStart?(segment)
                    onControl?(.init(segmentIndex: segment.index, state: .speaking, stop: false))
                }
                do {
                    try await primary.speak(segment, speed: speed, onStart: onStart)
                    VoiceProviderStatus.shared.usingElevenLabs()
                    renderAcknowledgementsIfVoiceChanged(segment.language)
                } catch {
                    guard Task.isCancelled == false, self.generation == generation else { return }
                    let started = primary.didStart
                    primary.stop()
                    if started == false { await speakWithFreshConnection(segment, onStart: onStart) }
                }
                guard self.generation == generation, Task.isCancelled == false else { return }
                onControl?(.init(segmentIndex: segment.index, state: .idle, stop: false))
                current = nil
                finishNarration(segment)
            }
            if self.generation == generation {
                task = nil
                isActive = acknowledging
            }
        }
    }

    /// ElevenLabs allows five contexts per socket: the keepalive, the playing sentence and the next two.
    private func prefetchQueued() {
        for segment in queue.prefix(2) { primary.prefetch(segment) }
    }

    private func acknowledge(language: String) {
        cancelAcknowledgement()
        acknowledgedTurn = .none
        guard let clip = acknowledgements.next(language) else { return prepareAcknowledgements(language: language) }
        let id = UUID()
        let grace = acknowledgementGrace
        acknowledgementID = id
        acknowledgement = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: grace) } catch { return }
            guard let self, acknowledgementID == id else { return }
            acknowledging = true
            acknowledgedTurn = .next
            isActive = true
            await playClip(clip, speed)
            guard acknowledgementID == id else { return }
            acknowledging = false
            acknowledgement = nil
            if task == nil { isActive = false }
        }
    }

    private func cancelAcknowledgement() {
        acknowledgementID = UUID()
        acknowledgement?.cancel()
        acknowledgement = nil
        acknowledging = false
        if task == nil { isActive = false }
    }

    private func renderAcknowledgementsIfVoiceChanged(_ language: String) {
        let language = ElevenLabsSpeechOutput.ttsLanguage(language)
        guard let voice = primary.voiceID, let cached = acknowledgements.voice(language), cached != voice else { return }
        acknowledgements.remove(language)
        prepareAcknowledgements(language: language)
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

/// The turn whose status line the acknowledgement already covered.
private enum AcknowledgedTurn: Equatable {
    case none, next
    case turn(String)
}

/// Typed turns stay silent. Opens when a spoken question is sent, closes when the workspace stops
/// (a typed message, the stop button, a new page).
public struct VoiceTurnSpeechGate: Sendable, Equatable {
    public private(set) var isOpen = false
    public init() {}
    public mutating func voiceQuestionSent() { isOpen = true }
    public mutating func closed() { isOpen = false }
}
