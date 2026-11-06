import LotseBridge
import LotseVoice

/// Clicky's cursor states (waveform while speaking, spinner until the answer speaks), the live level and
/// the push-to-talk monitor status.
extension MacShellController {
    func makeShortcutSupervisor() -> PushToTalkMonitorSupervisor {
        PushToTalkMonitorSupervisor(hooks: .init(
            accessGranted: { GlobalPushToTalkShortcutMonitor.inputMonitoringGranted },
            isRunning: { [weak self] in self?.shortcut.isRunning ?? false },
            start: { [weak self] in
                guard let self else { return }
                try shortcut.start()
                try? dictationShortcut.start()
            },
            stop: { [weak self] in
                guard let self else { return }
                // Cancel before stopping the monitor: a synthesized release must never send audio.
                pushToTalk.cancel()
                dictation.cancel()
                shortcut.stop()
                dictationShortcut.stop()
                recording = false
            },
            ensureEnabled: { [weak self] in
                self?.shortcut.ensureEnabled()
                self?.dictationShortcut.ensureEnabled()
            }
        ))
    }

    func configureListening() {
        transcription.onTranscript = { [weak self] text, final in
            guard let self else { return }
            overlay.state.listening.update(partial: text)
            if final {
                // The cursor spins until the first spoken sentence arrives (its caption ends the spinner).
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    hideListening(after: .zero)
                } else {
                    overlay.state.listening.release()
                    hideListening(after: .seconds(8))
                }
            }
            receiveTranscript(text, final: final)
        }
        VoiceInputLevel.shared.onLevel = { [weak self] level in self?.overlay.state.listening.update(level: level) }
        shortcutSupervisor.onStatusChanged = { [weak self] status in
            guard let self else { return }
            settings.shortcutStatus = status
            shortcutRunning = status == .running
            refreshMenuStatus()
        }
    }

    func showListening() {
        listeningHide?.cancel()
        overlay.state.listeningEnglish = settings.language == .english
        overlay.state.listening.begin()
    }

    func hideListening(after delay: Duration) {
        listeningHide?.cancel()
        listeningHide = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard Task.isCancelled == false else { return }
            self?.overlay.state.listening.hide()
        }
    }

    /// The chat's mic button: the same capture as holding ⌥⌘, started and sent by two clicks.
    func handleVoiceCommand(_ command: WorkspaceVoiceCommand) -> Bool {
        switch command {
        case .state: break
        case .toggle:
            if voiceToggle != nil {
                endVoiceToggle()
                handleShortcut(.released, toggled: true)
            } else if recording == false {
                wakeCapture.abandon()
                handleShortcut(.pressed, toggled: true)
                voiceToggle = Task { @MainActor [weak self] in
                    do { try await Task.sleep(for: VoiceConfiguration.toggleCaptureLimit) } catch { return }
                    guard let self, voiceToggle != nil else { return }
                    endVoiceToggle()
                    handleShortcut(.released, toggled: true)
                }
            }
        case .stop:
            guard voiceToggle != nil else { break }
            endVoiceToggle()
            handleShortcut(.cancelled, toggled: true)
        }
        return recording
    }

    func endVoiceToggle() {
        voiceToggle?.cancel()
        voiceToggle = nil
    }
}
