import AVFoundation
import LotseProtocol

/// didStart, rather than enqueue time, is the action clock.
@MainActor
public final class SegmentSpeechPlayer: NSObject, AVSpeechSynthesizerDelegate {
    public var onStart: ((SpeechSegment) -> Void)?
    public var onIdle: ((SpeechSegment) -> Void)?
    private let synthesizer = AVSpeechSynthesizer()
    private var segments: [ObjectIdentifier: SpeechSegment] = [:]

    public override init() {
        super.init()
        synthesizer.delegate = self
    }

    public func enqueue(_ segment: SpeechSegment) {
        let utterance = AVSpeechUtterance(string: segment.text)
        utterance.voice = AVSpeechSynthesisVoice(language: segment.language)
        segments[ObjectIdentifier(utterance)] = segment
        synthesizer.speak(utterance)
    }

    public func stop() {
        segments.removeAll()
        synthesizer.stopSpeaking(at: .immediate)
    }

    nonisolated public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, let segment = segments[id] else { return }
            onStart?(segment)
        }
    }

    nonisolated public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor [weak self] in
            guard let self, let segment = segments.removeValue(forKey: id) else { return }
            onIdle?(segment)
        }
    }
}
