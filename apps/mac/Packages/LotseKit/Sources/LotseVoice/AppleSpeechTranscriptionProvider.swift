// Adapted from Clicky's Apple Speech provider. See THIRD_PARTY_NOTICES.md.
import AVFoundation
import Foundation
@preconcurrency import Speech

public enum TranscriptionError: Error { case permissionRequired, unavailable, invalidAudioFormat }

/// Keeps Clicky's Apple Speech fallback on device; voice transport is added in WP-109.
@MainActor
public final class AppleSpeechTranscriptionProvider {
    public var onTranscript: ((String, Bool) -> Void)?
    public var onError: ((Error) -> Void)?
    private let requestMicrophoneAccess: @MainActor () async -> Bool
    private let requestSpeechAuthorization: @MainActor () async -> Bool
    private let makeInput: @MainActor (@escaping SpeechRecognitionHandler) throws -> SpeechRecognitionInput
    private let waitForFinal: @MainActor () async throws -> Void
    private var pendingStartID: UUID?
    private var activeSessionID: UUID?
    private var sessions: [UUID: RecognitionSession] = [:]

    public convenience init() {
        self.init(
            requestMicrophoneAccess: { await AVCaptureDevice.requestAccess(for: .audio) },
            requestSpeechAuthorization: {
                let authorization = await withCheckedContinuation { continuation in
                    SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
                }
                return authorization == .authorized
            },
            makeInput: { try AppleSpeechRecognitionInput(onRecognition: $0) }
        )
    }

    init(
        requestMicrophoneAccess: @escaping @MainActor () async -> Bool,
        requestSpeechAuthorization: @escaping @MainActor () async -> Bool,
        makeInput: @escaping @MainActor (@escaping SpeechRecognitionHandler) throws -> SpeechRecognitionInput,
        waitForFinal: @escaping @MainActor () async throws -> Void = { try await Task.sleep(for: .milliseconds(1800)) }
    ) {
        self.requestMicrophoneAccess = requestMicrophoneAccess
        self.requestSpeechAuthorization = requestSpeechAuthorization
        self.makeInput = makeInput
        self.waitForFinal = waitForFinal
    }

    public func start(whileHeld isHeld: @escaping @MainActor () -> Bool = { true }) async throws {
        try Task.checkCancellation()
        guard isHeld() else { throw CancellationError() }
        // Only release may send. A replacement start discards an unreleased recording.
        if let activeSessionID { removeSession(activeSessionID) }
        let sessionID = UUID()
        pendingStartID = sessionID
        defer { if pendingStartID == sessionID { pendingStartID = nil } }
        let microphoneGranted = await requestMicrophoneAccess()
        try checkStart(sessionID, isHeld: isHeld)
        guard microphoneGranted else { throw TranscriptionError.permissionRequired }
        let speechGranted = await requestSpeechAuthorization()
        try checkStart(sessionID, isHeld: isHeld)
        guard speechGranted else { throw TranscriptionError.permissionRequired }
        let session = RecognitionSession()
        sessions[sessionID] = session
        do {
            // There is no suspension between the last hold check and starting the audio engine.
            session.input = try makeInput { [weak self] event in
                self?.handleRecognition(event, sessionID: sessionID)
            }
            activeSessionID = sessionID
        } catch {
            removeSession(sessionID)
            throw error
        }
    }

    public func finish() {
        pendingStartID = nil
        guard let sessionID = activeSessionID, let session = sessions[sessionID] else { return }
        activeSessionID = nil
        session.finalRequested = true
        if session.recognitionEnded {
            let update = session.accumulator.finish()
            removeSession(sessionID)
            if let update { onTranscript?(update.text, update.final) }
            return
        }
        session.input?.finish()
        let waitForFinal = waitForFinal
        session.fallbackTask = Task { @MainActor [weak self] in
            do {
                try await waitForFinal()
                try Task.checkCancellation()
            } catch { return }
            guard let self, let session = sessions[sessionID] else { return }
            let update = session.accumulator.finish()
            removeSession(sessionID)
            if let update { onTranscript?(update.text, update.final) }
        }
    }

    public func cancel() {
        pendingStartID = nil
        for sessionID in Array(sessions.keys) { removeSession(sessionID) }
    }

    private func checkStart(_ sessionID: UUID, isHeld: @MainActor () -> Bool) throws {
        try Task.checkCancellation()
        guard pendingStartID == sessionID, isHeld() else { throw CancellationError() }
    }

    private func handleRecognition(_ event: SpeechRecognitionEvent, sessionID: UUID) {
        guard let session = sessions[sessionID], session.recognitionEnded == false else { return }
        // A recognizer final ends input, but the user's release is the only send boundary.
        let update = session.accumulator.receive(event.text ?? "", final: event.final && session.finalRequested)
        if event.final && session.finalRequested == false {
            session.recognitionEnded = true
            session.input?.finish()
            if let update { onTranscript?(update.text, update.final) }
            return
        }
        if event.final {
            removeSession(sessionID)
            if let update { onTranscript?(update.text, update.final) }
            return
        }
        if let update { onTranscript?(update.text, update.final) }
        if event.failed {
            let finalUpdate = session.finalRequested ? session.accumulator.finish() : nil
            removeSession(sessionID)
            if let finalUpdate {
                onTranscript?(finalUpdate.text, finalUpdate.final)
            } else {
                onError?(TranscriptionError.unavailable)
            }
        }
    }

    private func removeSession(_ sessionID: UUID) {
        guard let session = sessions.removeValue(forKey: sessionID) else { return }
        if activeSessionID == sessionID { activeSessionID = nil }
        session.fallbackTask?.cancel()
        session.input?.cancel()
    }

    private final class RecognitionSession {
        var input: SpeechRecognitionInput?
        var accumulator = TranscriptAccumulator()
        var fallbackTask: Task<Void, Never>?
        var finalRequested = false
        var recognitionEnded = false
    }
}

struct TranscriptUpdate: Equatable {
    let text: String
    let final: Bool
}

struct TranscriptAccumulator {
    private var text = ""
    private var deliveredFinal = false

    mutating func receive(_ text: String, final: Bool) -> TranscriptUpdate? {
        guard deliveredFinal == false else { return nil }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return final ? finish() : nil
        }
        self.text = text
        deliveredFinal = final
        return TranscriptUpdate(text: text, final: final)
    }

    mutating func finish() -> TranscriptUpdate? {
        guard text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else { return nil }
        return receive(text, final: true)
    }
}
