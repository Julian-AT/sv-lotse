import AVFoundation
import Foundation
@preconcurrency import Speech

/// Bridges system completion handlers that arrive on arbitrary queues (TCC, Speech, audio taps).
///
/// A closure literal written inside a `@MainActor` type inherits main-actor isolation, and Swift 6 traps
/// at runtime when a framework then calls it on a background queue. Every closure built here is
/// nonisolated, so it only resumes a continuation or forwards a value and never touches actor state.
public enum SystemCallbacks {
    /// Awaits a callback API without inheriting the caller's actor isolation.
    public nonisolated static func value<T: Sendable>(
        _ register: @Sendable (@escaping @Sendable (T) -> Void) -> Void
    ) async -> T {
        await withCheckedContinuation { continuation in register { continuation.resume(returning: $0) } }
    }

    public nonisolated static func speechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await value { SFSpeechRecognizer.requestAuthorization($0) }
    }

    nonisolated static func appendingTap(to request: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in
            VoiceInputLevel.measure(buffer)
            request.append(buffer)
        }
    }

    nonisolated static func recognitionHandler(
        _ onRecognition: @escaping SpeechRecognitionHandler
    ) -> @Sendable (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, error in
            let event = SpeechRecognitionEvent(
                text: result?.bestTranscription.formattedString, final: result?.isFinal ?? false, failed: error != nil
            )
            Task { @MainActor in onRecognition(event) }
        }
    }
}
