import AppKit
import LotseBridge
import LotseOverlay
import LotseProtocol
import LotseVoice

/// Composes native capabilities. All conversation state and requests belong to the workspace.
@MainActor
public final class MacShellController {
    public let workspace: WorkspaceWindowController
    public let menu = MenuBarController()
    private let overlay = OverlayWindowManager()
    private let shortcut = GlobalPushToTalkShortcutMonitor()
    private let transcription = AppleSpeechTranscriptionProvider()
    private lazy var pushToTalk = PushToTalkController(transcription: transcription)
    private let analytics = ClickyAnalytics()
    private var overlayVisible = true
    private var displayObserver: NSObjectProtocol?

    public init(bundle: Bundle = .main) throws {
        let info = bundle.object(forInfoDictionaryKey: "LOTSE_WORKSPACE_URL") as? String
        let configuration = try WorkspaceConfiguration(info: info.map { ["LOTSE_WORKSPACE_URL": $0] } ?? [:])
        let hello = BridgeHello(
            appVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0",
            capabilities: .init(accessibility: false, ocr: false, onDeviceContextSize: 0, onDeviceModel: false, overlay: true),
            protocolVersion: .the100
        )
        workspace = WorkspaceWindowController(configuration: configuration, hello: hello)
        menu.openWorkspace = { [weak self] in self?.workspace.showWorkspace() }
        menu.toggleOverlay = { [weak self] in
            guard let self else { return }
            overlayVisible.toggle()
            if overlayVisible { overlay.showOverlay() } else { overlay.hideOverlay() }
        }
        menu.enableVoice = { [weak self] in self?.enableVoice() }
        menu.analyticsConsentChanged = { [weak self] enabled in self?.configureAnalytics(enabled) }
        shortcut.onTransition = { [weak self] transition in self?.handleShortcut(transition) }
        transcription.onTranscript = { [weak self] text, final in self?.sendTranscript(text, final: final) }
        transcription.onError = { [weak self] _ in self?.showVoiceError() }
        pushToTalk.onError = { [weak self] _ in self?.showVoiceError() }
        workspace.onMessage = { [weak self] message in
            guard let self else { throw WorkspaceError.unsupportedMessage }
            switch message {
            case .action(let envelope):
                if case .caption(let action) = envelope.payload {
                    overlay.state.caption = action.payload.label ?? ""
                } else if case .clear = envelope.payload {
                    overlay.state.caption = ""
                    overlay.state.target = nil
                } else {
                    throw WorkspaceError.unsupportedMessage
                }
            default: throw WorkspaceError.unsupportedMessage
            }
        }
    }

    public func start() {
        overlay.showOverlay()
        workspace.load()
        workspace.showWorkspace()
        configureAnalytics(UserDefaults.standard.bool(forKey: "analyticsOptedIn"))
        analytics.trackAppOpened()
        displayObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.overlayVisible else { return }
                self.overlay.showOverlay()
            }
        }
    }

    public func stop() {
        shortcut.stop()
        pushToTalk.cancel()
        overlay.hideOverlay()
        if let displayObserver { NotificationCenter.default.removeObserver(displayObserver) }
        displayObserver = nil
    }

    private func enableVoice() {
        let alert = NSAlert()
        alert.messageText = "Sprechtaste aktivieren"
        alert.informativeText = """
            Für die globale Sprechtaste ⌃⌥ benötigt der Lotse die Erlaubnis zur Eingabeüberwachung.
            Mikrofon und Spracherkennung werden beim ersten Sprechen angefragt.
            """
        alert.addButton(withTitle: "Aktivieren")
        alert.addButton(withTitle: "Abbrechen")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        _ = CGRequestListenEventAccess()
        do { try shortcut.start() } catch { showVoiceError() }
    }

    private func handleShortcut(_ transition: ShortcutTransition) {
        pushToTalk.handle(transition)
    }

    private func sendTranscript(_ text: String, final: Bool) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await workspace.send(
                    .transcript(
                        .init(
                            id: UUID().uuidString, payload: .init(capsule: nil, language: "de-AT", text: text, transcriptFinal: final),
                            type: .transcript, v: .the100
                        )))
            } catch {
                transcription.cancel()
                workspace.showWorkspace()
                showVoiceError()
            }
        }
    }

    private func configureAnalytics(_ enabled: Bool) {
        do { try analytics.setConsent(enabled) } catch {
            let alert = NSAlert()
            alert.messageText = "Nutzungsstatistik ist nicht verfügbar."
            alert.informativeText = "Bitte prüfen Sie die konfigurierte Statistik-Adresse."
            alert.runModal()
        }
    }

    private func showVoiceError() {
        let alert = NSAlert()
        alert.messageText = "Spracheingabe ist derzeit nicht verfügbar."
        alert.informativeText = """
            Prüfen Sie Mikrofon, Eingabeüberwachung und die installierte deutsche Spracherkennung.
            Sie können im Arbeitsbereich tippen.
            """
        alert.runModal()
    }
}
