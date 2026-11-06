import AVFoundation
import Foundation
import LotseProtocol

@MainActor
final class AppleSpeechOutput: NSObject, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var completion: CheckedContinuation<Void, Never>?
    private var utteranceID: ObjectIdentifier?
    private var onStart: (() -> Void)?

    override init() { super.init(); synthesizer.delegate = self }

    func speak(_ segment: SpeechSegment, speed: Double, onStart: @escaping () -> Void) async {
        let utterance = AVSpeechUtterance(string: segment.text)
        utterance.voice = AVSpeechSynthesisVoice(language: segment.language)
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * Float(speed)
        utteranceID = ObjectIdentifier(utterance)
        self.onStart = onStart
        await withCheckedContinuation { continuation in
            completion = continuation
            synthesizer.speak(utterance)
        }
    }

    func stop() {
        onStart = nil
        utteranceID = nil
        synthesizer.stopSpeaking(at: .immediate)
        complete()
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, utteranceID == id else { return }
            onStart?()
            onStart = nil
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, utteranceID == id else { return }
            complete()
        }
    }
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, utteranceID == id else { return }
            complete()
        }
    }
    private func complete() { completion?.resume(); completion = nil }
}
