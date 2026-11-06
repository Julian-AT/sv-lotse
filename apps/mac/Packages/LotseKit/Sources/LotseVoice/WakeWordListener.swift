import AVFoundation
import Foundation
import os
@preconcurrency import Speech

/// Listens on-device for „Meine SV“. Audio never leaves the Mac and nothing is kept: each recognition
/// task only feeds the phrase matcher, and is torn down on detection, pause or rotation.
@MainActor
public final class WakeWordListener {
    public var onDetected: (() -> Void)?
    public var onStateChanged: ((WakeWordState) -> Void)?
    public private(set) var gate: WakeWordGate
    private var recognition: WakeWordRecognition?
    private var pending: Task<Void, Never>?
    private var rotation: Task<Void, Never>?
    private var generation = 0
    private var failures = 0
    private var startedAt = ContinuousClock.now
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "wake-word")
    /// Apple stops buffer recognition after about a minute, so tasks rotate earlier.
    /// en-US is the last resort: macOS often ships its on-device model before the German one is downloaded.
    static let rotationInterval: Duration = .seconds(50)
    static let resumeDelay: Duration = .milliseconds(600)
    static let localeIdentifiers = ["de-AT", "de-DE", "en-US"]

    public init(enabled: Bool) { gate = WakeWordGate(enabled: enabled) }

    public var state: WakeWordState { gate.state }

    public var enabled: Bool {
        get { gate.enabled }
        set {
            gate.enabled = newValue
            reconcile()
        }
    }

    public func set(_ reason: WakeWordPauseReason, paused: Bool) {
        let before = gate
        gate.set(reason, paused: paused)
        if before != gate { reconcile() }
    }

    public func stop() {
        gate.enabled = false
        reconcile()
    }

    private func reconcile() {
        if gate.shouldListen {
            if recognition == nil && pending == nil { schedule(after: Self.resumeDelay) }
        } else {
            halt()
        }
        onStateChanged?(gate.state)
    }

    private func schedule(after delay: Duration) {
        halt()
        generation += 1
        let generation = generation
        pending = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: delay) } catch { return }
            guard let self, self.generation == generation else { return }
            guard await authorized(), self.generation == generation, gate.shouldListen else {
                if self.generation == generation { pending = nil }
                return
            }
            pending = nil
            begin(generation)
        }
    }

    private func authorized() async -> Bool {
        var speech = SFSpeechRecognizer.authorizationStatus()
        if speech == .notDetermined { speech = await SystemCallbacks.speechAuthorization() }
        var microphone = AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined {
            microphone = await AVCaptureDevice.requestAccess(for: .audio)
        }
        guard speech == .authorized, microphone else {
            log.info("wake word listener waiting for microphone and speech recognition permission")
            return false
        }
        return true
    }

    private func begin(_ generation: Int) {
        startedAt = .now
        do {
            recognition = try WakeWordRecognition(localeIdentifiers: Self.localeIdentifiers) { [weak self] event in
                self?.handle(event, generation: generation)
            }
            log.info("wake word listener started (\(self.recognition?.localeIdentifier ?? "-", privacy: .public))")
            rotation = Task { @MainActor [weak self] in
                do { try await Task.sleep(for: Self.rotationInterval) } catch { return }
                guard let self, self.generation == generation, gate.shouldListen else { return }
                failures = 0
                schedule(after: .zero)
            }
        } catch {
            log.error("wake word listener could not start: \(String(describing: error), privacy: .public)")
            retry()
        }
    }

    private func handle(_ event: SpeechRecognitionEvent, generation: Int) {
        guard generation == self.generation, recognition != nil else { return }
        if let text = event.text, WakeWordMatcher.matches(text) {
            log.info("wake word detected")
            failures = 0
            gate.set(.capture, paused: true)
            halt()
            onStateChanged?(gate.state)
            onDetected?()
            return
        }
        if event.failed || event.final { retry() }
    }

    private func retry() {
        // Short-lived failures back off (0.5 s … 30 s); a task that ran a while restarts at once.
        failures = ContinuousClock.now - startedAt > .seconds(10) ? 0 : failures + 1
        let delay = failures == 0 ? Duration.milliseconds(300) : .milliseconds(min(30_000, 250 << min(failures, 7)))
        guard gate.shouldListen else { return halt() }
        schedule(after: delay)
    }

    private func halt() {
        generation += 1
        pending?.cancel()
        pending = nil
        rotation?.cancel()
        rotation = nil
        recognition?.cancel()
        recognition = nil
    }
}

/// One on-device recognition task over the default microphone.
@MainActor
final class WakeWordRecognition {
    let localeIdentifier: String
    private let engine = AVAudioEngine()
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?

    init(localeIdentifiers: [String], onRecognition: @escaping SpeechRecognitionHandler) throws {
        let candidates = localeIdentifiers.compactMap { SFSpeechRecognizer(locale: Locale(identifier: $0)) }
        guard let recognizer = candidates.first(where: { $0.isAvailable && $0.supportsOnDeviceRecognition })
        else { throw TranscriptionError.unavailable }
        localeIdentifier = recognizer.locale.identifier
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .search
        request.contextualStrings = ["Meine SV", "SV"]
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw TranscriptionError.invalidAudioFormat }
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: SystemCallbacks.appendingTap(to: request))
        task = recognizer.recognitionTask(with: request, resultHandler: SystemCallbacks.recognitionHandler(onRecognition))
        engine.prepare()
        do { try engine.start() } catch {
            cancel()
            throw error
        }
    }

    func cancel() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request.endAudio()
        task?.cancel()
        task = nil
    }
}
