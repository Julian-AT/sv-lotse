import AppKit
import LotseVoice

/// „Meine SV“: hands-free start of the same capture flow as push-to-talk.
extension MacShellController {
    func configureWakeWord() {
        speech.onActivityChanged = { [weak self] active in self?.wakeWord.set(.speechOutput, paused: active) }
        wakeWord.onStateChanged = { [weak self] state in self?.menu.updateWakeWord(state) }
        wakeWord.onDetected = { [weak self] in self?.beginWakeCapture() }
        wakeCapture.onEnded = { [weak self] outcome in
            guard let self else { return }
            if outcome == .cancelled { hideListening(after: .zero) }
            recording = false
            refreshMenuStatus()
            wakeWord.set(.capture, paused: false)
        }
        menu.wakeWordChanged = { [weak self] enabled in
            guard let self else { return }
            if enabled == false { wakeCapture.cancel() }
            wakeWord.enabled = enabled
        }
    }

    func startWakeWord() {
        wakeWord.set(.companionPaused, paused: voiceEnabled == false)
        wakeWord.enabled = WakeWordPreferences.enabled()
    }

    func stopWakeWord() {
        wakeCapture.cancel()
        wakeWord.stop()
    }

    /// Push-to-talk and dictation own the microphone while held; a running wake capture yields to them.
    func pauseWakeWord(for transition: ShortcutTransition) {
        switch transition {
        case .pressed:
            wakeWord.set(.pushToTalk, paused: true)
            wakeCapture.cancel()
        case .released, .cancelled: wakeWord.set(.pushToTalk, paused: false)
        case .none: break
        }
    }

    func receiveTranscript(_ text: String, final: Bool) {
        guard wakeCapture.isActive else { return sendTranscript(text, final: final) }
        let question = wakeCapture.received(text, final: final)
        if question.isEmpty == false { sendTranscript(question, final: final) }
    }

    private func beginWakeCapture() {
        guard recording == false else {
            wakeWord.set(.capture, paused: false)
            return
        }
        let sound = NSSound(named: NSSound.Name("Tink"))
        sound?.volume = 0.25
        sound?.play()
        speech.stop(notify: false)
        recording = true
        showListening()
        refreshMenuStatus()
        wakeCapture.begin()
    }
}
