// Adapted from Clicky's Apple Speech provider. See THIRD_PARTY_NOTICES.md.
import AVFoundation
import Foundation
@preconcurrency import Speech

struct SpeechRecognitionEvent: Sendable {
    let text: String?
    let final: Bool
    let failed: Bool
}

typealias SpeechRecognitionHandler = @MainActor (SpeechRecognitionEvent) -> Void

@MainActor
protocol SpeechRecognitionInput {
    func finish()
    func cancel()
}

/// One audio engine and recognition request, retained until its utterance has finalized.
@MainActor
final class AppleSpeechRecognitionInput: SpeechRecognitionInput {
    private var engine: AVAudioEngine?
    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?

    init(onRecognition: @escaping SpeechRecognitionHandler) throws {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "de-AT")),
            recognizer.isAvailable, recognizer.supportsOnDeviceRecognition
        else { throw TranscriptionError.unavailable }
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.addsPunctuation = true
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw TranscriptionError.invalidAudioFormat }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [request] buffer, _ in request.append(buffer) }
        self.engine = engine
        task = recognizer.recognitionTask(with: request) { result, error in
            let event = SpeechRecognitionEvent(
                text: result?.bestTranscription.formattedString, final: result?.isFinal ?? false, failed: error != nil
            )
            Task { @MainActor in onRecognition(event) }
        }
        engine.prepare()
        do { try engine.start() } catch {
            cancel()
            throw error
        }
    }

    func finish() {
        stopMicrophone()
        request.endAudio()
    }

    func cancel() {
        stopMicrophone()
        task?.cancel()
        task = nil
    }

    private func stopMicrophone() {
        engine?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        engine = nil
    }
}
