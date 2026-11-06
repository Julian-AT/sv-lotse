import Foundation
import Testing

@testable import LotseVoice

/// TCC and Speech call completion handlers on libdispatch worker threads. These must not trap on
/// Swift 6 main-actor isolation checks when the request starts on the main actor.
@Suite @MainActor
struct SystemCallbackTests {
    @Test("A completion delivered on a background queue resumes a main-actor caller")
    func backgroundCompletion() async {
        let value = await SystemCallbacks.value { done in
            DispatchQueue.global(qos: .userInitiated).async { done(true) }
        }
        #expect(value)
    }

    @Test("Speech recognition results delivered off the main thread reach the main actor")
    func backgroundRecognition() async {
        let received = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let handler = SystemCallbacks.recognitionHandler { event in continuation.resume(returning: event.failed) }
            DispatchQueue.global(qos: .userInitiated).async { handler(nil, CancellationError()) }
        }
        #expect(received)
    }

    @Test("Fallback reasons name the token route status without leaking token data")
    func fallbackReason() {
        let status = VoiceProviderStatus()
        status.fellBack(VoiceProviderError(message: "quota_exceeded"))
        #expect(status.provider == .apple)
        #expect(status.reason?.contains("quota_exceeded") == true)
        status.usingElevenLabs()
        #expect(status.provider == .elevenLabs)
        #expect(status.reason == nil)
    }
}
