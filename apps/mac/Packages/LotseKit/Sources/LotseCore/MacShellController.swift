import AppKit
import ApplicationServices
import LotseBridge
import LotseCapture
import LotseImport
import LotseOverlay
import LotseProtocol
import LotseRelatives
import LotseResolver
import LotseVoice
/// Composes native capabilities. All conversation state and requests belong to the workspace.
@MainActor
public final class MacShellController {
    public let workspace: WorkspaceWindowController
    public let menu = MenuBarController()
    public private(set) lazy var dashboard = DashboardModel(workspace: workspace)
    let overlay = OverlayWindowManager()
    lazy var overlayBridge = OverlayBridgeController(workspace: workspace, overlay: overlay)
    lazy var native = NativeCapabilityCoordinator(shell: self, overlay: overlay, speech: speech)
    lazy var relatives: RelativesWindowController = {
        let controller = RelativesWindowController(
            webView: workspace.webView, origin: workspace.configuration.origin, overlay: overlay.state,
            copy: RelativesCopy(english: settings.language == .english)
        )
        controller.session.onStatusChanged = { [weak self] status in self?.menu.setSharingActive(status == .sharing) }
        return controller
    }()
    lazy var sourceHighlights = SourceHighlightCoordinator(overlay: overlay,
        enqueueSpeech: { [weak self] in self?.speech.enqueue($0) })
    let shortcut = GlobalPushToTalkShortcutMonitor()
    let dictationShortcut = GlobalPushToTalkShortcutMonitor(shortcut: VoiceConfiguration.dictationShortcut, name: "dictation")
    lazy var shortcutSupervisor = makeShortcutSupervisor()
    var listeningHide: Task<Void, Never>?
    var browserStepExpiry: Task<Void, Never>?
    var browserSteps: Task<Void, Never>?
    public let settings = CompanionSettingsModel()
    public let guidedPortal = GuidedPortalCapability()
    public let browserPage = BrowserPageCapability()
    lazy var settingsWindow = CompanionSettingsWindow(model: settings)
    lazy var setupWindow = GuidedSetupWindow(settings, workspace: workspace, menu: menu, settingsWindow: settingsWindow)
    lazy var transcription = FallbackTranscriptionProvider(
        primary: scribeTranscriptionProvider,
        fallback: AppleSpeechTranscriptionProvider(localeIdentifier: { [weak self] in
            self?.settings.language.rawValue ?? CompanionLanguage.german.rawValue
        })
    )
    lazy var speech = SpeechPlaybackController(loadToken: tokenLoader)
    let sentenceActions = SentenceActionScheduler()
    private var speechTurnID: String?
    /// Other context capabilities can contribute a real capsule at the final-transcript boundary.
    public var onSentenceAction: ((Action) -> Void)?
    public var captureVoiceContext: (@MainActor () async throws -> ContextCapsule)?
    lazy var pushToTalk = PushToTalkController(transcription: transcription)
    lazy var dictation = DictationController(localeIdentifier: { [weak self] in
        self?.settings.language.rawValue ?? CompanionLanguage.german.rawValue
    })
    private lazy var transcriptSender = ScreenTranscriptSender(capture: { [weak self] focus, language in
        guard let self else { throw WorkspaceError.notReady }
        return try await captureTranscriptContext(focus: focus, language: language)
    }, send: { [weak self] payload in
        guard let self else { throw WorkspaceError.notReady }
        try await workspace.send(
            .transcript(.init(id: UUID().uuidString, payload: payload, type: .transcript, v: .the100))
        )
    })
    private let analytics = ClickyAnalytics()
    private var uploads: DocumentUploadCoordinator?
    private var importPanel: DocumentImportPanel?
    var overlayVisible = true
    private var displayObserver: NSObjectProtocol?
    private var activationObserver: NSObjectProtocol?
    var recording = false {
        didSet { if oldValue != recording { workspace.publishVoiceState(listening: recording) } }
    }
    var voiceToggle: Task<Void, Never>?
    var shortcutRunning = false
    lazy var wakeWord = WakeWordListener(enabled: WakeWordPreferences.enabled())
    lazy var wakeCapture = WakeWordCapture(transcription: transcription)
    public init(bundle: Bundle = .main) throws {
        let info = bundle.object(forInfoDictionaryKey: "LOTSE_WORKSPACE_URL") as? String
        let configuration = try WorkspaceConfiguration(info: info.map { ["LOTSE_WORKSPACE_URL": $0] } ?? [:])
        let hello = BridgeHello(
            appVersion: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0",
            capabilities: .init(
                accessibility: AXIsProcessTrusted(), ocr: true, onDeviceContextSize: 0, onDeviceModel: false, overlay: true
            ),
            protocolVersion: .the100
        )
        workspace = WorkspaceWindowController(configuration: configuration, hello: hello)
        configureDashboard()
        configureMenuAndSettings()
        configureVoiceAndBridge()
        configureDocumentImport()
        configureWakeWord()
    }
    private func configureMenuAndSettings() {
        menu.openWorkspace = { [weak self] in self?.workspace.showWorkspace() }
        menu.openSettings = { [weak self] in self?.presentSettings() }
        configureChromeMenu()
        menu.openRelatives = { [weak self] in self?.relatives.showSharing() }
        settingsWindow.openWorkspace = { [weak self] in self?.workspace.showWorkspace() }
        settings.onPermissionsChanged = { [weak self] in self?.reconcileVoice() }
        settings.onVoiceEnabledChanged = { [weak self] in self?.reconcileVoice() }
        settings.onLanguageChanged = { [weak self] in
            guard let self else { return }
            pushToTalk.cancel()
            dictation.cancel()
            transcriptSender.cancel()
            recording = false
            menu.setLanguage(settings.language)
            synchronizeProfileLanguage()
            speech.prepareAcknowledgements(language: settings.language.providerLanguage)
            importPanel?.copy = ImportCopy(english: settings.language == .english)
            refreshMenuStatus()
        }
        menu.toggleOverlay = { [weak self] in
            guard let self else { return }
            transcriptSender.focus = nil
            overlayVisible.toggle()
            if overlayVisible { overlay.showOverlay() } else { overlay.hideOverlay() }
        }
        menu.circleToAsk = { [weak self] in
            guard let self else { return }
            overlayVisible = true
            transcriptSender.focus = nil
            overlay.beginDrawing(instruction: copy.circleInstruction)
        }
        menu.cancelCircle = { [weak self] in
            self?.overlay.cancelDrawing()
            self?.transcriptSender.focus = nil
        }
        overlay.onSelection = { [weak self] selection in
            guard let self else { return }
            transcriptSender.focus = ScreenFocus(displayID: selection.displayID, globalRect: selection.globalRect)
            overlay.state.caption = copy.circleReady
        }
        shortcut.configure(shortcut: menu.shortcutChoice.shortcut)
        menu.shortcutChanged = { [weak self] choice in
            guard let self else { return }
            pushToTalk.cancel()
            recording = false
            refreshMenuStatus()
            shortcut.configure(shortcut: choice.shortcut)
        }
        menu.enableVoice = { [weak self] in self?.enableVoice() }
        menu.analyticsConsentChanged = { [weak self] enabled in self?.configureAnalytics(enabled) }
    }
    private func configureVoiceAndBridge() {
        shortcut.onTransition = { [weak self] transition in self?.handleShortcut(transition) }
        workspace.onVoiceCommand = { [weak self] command in self?.handleVoiceCommand(command) ?? false }
        dictationShortcut.onTransition = { [weak self] transition in self?.handleDictationShortcut(transition) }
        dictation.onRecordingChanged = { [weak self] recording in
            self?.recording = recording
            self?.refreshMenuStatus()
        }
        dictation.onError = { [weak self] _ in
            guard let self else { return }
            dictation.cancel()
            settings.refreshPermissions()
            showCompanionAlert(message: copy.dictationError, hint: copy.dictationErrorHint)
        }
        configureListening()
        transcriptSender.captureFailed = { [weak self] in
            guard let self else { return }
            overlay.state.caption = copy.captureUnavailable
            settings.refreshPermissions()
        }
        transcriptSender.sendFailed = { [weak self] in
            self?.transcriptSender.cancel()
            self?.transcription.cancel()
            self?.workspace.showWorkspace()
            self?.showVoiceError()
        }
        transcription.onError = { [weak self] _ in self?.showVoiceError() }
        pushToTalk.onError = { [weak self] _ in self?.showVoiceError() }
        workspace.onNavigationReset = { [weak self] in
            guard let self else { return }
            speech.stop(notify: false)
            speech.silenceUntilNextVoiceQuestion()
            sentenceActions.reset()
            speechTurnID = nil
            sourceHighlights.clear()
            overlayBridge.stop()
            native.reset()
        }
        speech.speed = UserDefaults.standard.object(forKey: VoiceConfiguration.speedPreferenceKey) as? Double ?? 1
        menu.speechSpeedChanged = { [weak self] in self?.speech.speed = $0 }
        sourceHighlights.connect(speech: speech, workspace: workspace, overlayBridge: overlayBridge, sentenceActions: sentenceActions)
        sentenceActions.onAction = { [weak self] in self?.performVoiceAction($0) }
        overlayBridge.externalResolve = { [weak self] target in try await self?.browserPage.resolve(target) }
        workspace.onMessage = { [weak self] message in
            guard let self else { throw WorkspaceError.unsupportedMessage }
            try receiveWorkspaceMessage(message)
        }
    }
    public func start() {
        overlay.showOverlay()
        shortcutSupervisor.startPolling()
        workspace.load()
        uploads?.start()
        setupWindow.start()
        openDebugWindows()
        settings.refreshPermissions()
        startWakeWord()
        activationObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.settings.refreshPermissions()
                Task { @MainActor [weak self] in
                    await self?.dashboard.refresh()
                    await self?.dashboard.refreshServices()
                }
            }
        }
        configureAnalytics(UserDefaults.standard.bool(forKey: "analyticsOptedIn"))
        analytics.trackAppOpened()
        displayObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.overlayVisible else { return }
                self.transcriptSender.focus = nil
                self.overlay.showOverlay()
            }
        }
    }
    public func stop() {
        transcriptSender.cancel()
        guidedPortal.stop()
        browserPage.stop()
        uploads?.stop()
        relatives.stop()
        sourceHighlights.stop(notify: false)
        stopWakeWord()
        pushToTalk.cancel()
        dictation.cancel()
        shortcutSupervisor.stopPolling()
        shortcut.stop()
        dictationShortcut.stop()
        setupWindow.stop()
        overlayBridge.stop()
        native.stop()
        speech.stop(notify: false)
        sentenceActions.reset()
        overlay.hideOverlay()
        if let displayObserver { NotificationCenter.default.removeObserver(displayObserver) }
        displayObserver = nil
        if let activationObserver { NotificationCenter.default.removeObserver(activationObserver) }
        activationObserver = nil
    }
    private func enableVoice() {
        settings.voiceEnabled.toggle()
        if voiceEnabled && settings.permissions[.inputMonitoring] != .granted {
            presentSettings(tab: "privacy")
            Task { @MainActor [weak self] in
                guard let self, voiceEnabled else { return }
                await settings.request(.inputMonitoring)
            }
        }
    }
    private func reconcileVoice() {
        shortcutSupervisor.enabled = voiceEnabled
        shortcutSupervisor.tick()
        shortcutRunning = shortcutSupervisor.status == .running
        wakeWord.set(.companionPaused, paused: voiceEnabled == false)
        refreshMenuStatus()
    }
    func refreshMenuStatus() {
        let status: CompanionWorkspaceStatus = workspace.loadError == nil ? (workspace.isReady ? .connected : .connecting) : .unavailable
        let audioGranted = settings.permissions[.microphone] == .granted
        menu.updateStatus(workspace: status, voiceEnabled: voiceEnabled,
                          voiceAvailable: shortcutRunning && audioGranted, recording: recording)
    }
    private func handleDictationShortcut(_ transition: ShortcutTransition) {
        pauseWakeWord(for: transition)
        if transition == .pressed {
            pushToTalk.cancel()
            recording = false
        }
        dictation.handle(transition)
        refreshMenuStatus()
    }
}
extension MacShellController {
    private func configureDocumentImport() {
        do {
            let setup = try DocumentImportSetup(workspace: workspace, menu: menu, language: settings.language, portal: guidedPortal)
            uploads = setup.uploads
            importPanel = setup.panel
        } catch {
            menu.updateUploadStatus(.storageError, count: 0)
        }
    }
    private func receiveWorkspaceMessage(_ message: BridgeToNative) throws {
        if receiveBrowserMessage(message) { return }
        if guidedPortal.receive(message, language: settings.language.rawValue, workspace: workspace) { return }
        switch message {
        case .speechSegment(let envelope):
            if speechTurnID != envelope.payload.turnID {
                if speechTurnID != nil {
                    sentenceActions.beginTurn()
                    sourceHighlights.beginTurn()
                }
                speechTurnID = envelope.payload.turnID
            }
            try sourceHighlights.receive(message)
        case .speechControl(let envelope):
            speech.handle(envelope.payload)
            if envelope.payload.stop {
                sentenceActions.reset()
                sourceHighlights.stop(notify: false)
            }
            try overlayBridge.receive(message)
        case .action(let envelope): try receiveWorkspaceAction(envelope)
        case .toolInvocation, .approvalContext, .jobProgress, .safetyNotice: _ = native.receive(message)
        default: try overlayBridge.receive(message)
        }
    }
    func receiveWorkspaceAction(_ envelope: BridgeToNativeAction) throws {
        if envelope.payload.sourceText != nil {
            try sourceHighlights.receive(.action(envelope))
            return
        }
        switch envelope.payload {
        case .clear:
            sourceHighlights.clear()
            sentenceActions.reset()
            try overlayBridge.receive(.action(envelope))
        case .type: try overlayBridge.receive(.action(envelope))
        default: sentenceActions.enqueue(envelope.payload)
        }
    }
    func sendTranscript(_ text: String, final: Bool) {
        if final, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            speech.allowSpeechForVoiceTurn(language: settings.language.providerLanguage)
        }
        if final {
            overlay.cancelDrawing()
            if overlay.state.caption == copy.circleReady { overlay.state.caption = "" }
        }
        transcriptSender.submit(text, final: final, language: settings.language.rawValue)
    }
    private func captureTranscriptContext(focus: ScreenFocus?, language: String) async throws -> ContextCapsule {
        var captured = try? await captureVoiceContext?()
        try Task.checkCancellation()
        if captured == nil {
            do {
                captured = try await ScreenContextCapture.capture(focus: focus, language: language)
            } catch {
                try Task.checkCancellation()
                transcriptSender.captureFailed?()
            }
        }
        try Task.checkCancellation()
        if let captured, captured.page != nil { return captured }
        if let browserPage = await browserPage.snapshot() {
            try Task.checkCancellation()
            return ContextCapsule(focusedRegion: captured?.focusedRegion, page: browserPage, screen: captured?.screen)
        }
        let portalPage = try? await guidedPortal.snapshot()
        try Task.checkCancellation()
        if let portalPage {
            return ContextCapsule(focusedRegion: captured?.focusedRegion, page: portalPage, screen: captured?.screen)
        }
        let workspaceContext = try? await workspace.voiceContextCapsule()
        return ContextCapsule(focusedRegion: captured?.focusedRegion, page: workspaceContext?.page, screen: captured?.screen)
    }
    func performVoiceAction(_ action: Action) {
        switch action {
        case .point, .highlight, .annotate: overlay.state.highlights = []
        default: break
        }
        onSentenceAction?(action)
        try? overlayBridge.receive(.action(.init(
            id: UUID().uuidString, payload: action, type: .action, v: .the100
        )))
    }
    private func configureAnalytics(_ enabled: Bool) {
        do { try analytics.setConsent(enabled) } catch {
            showCompanionAlert(message: copy.analyticsError, hint: copy.analyticsErrorHint)
        }
    }
    private func showVoiceError() {
        recording = false
        settings.refreshPermissions()
        let micGranted = settings.permissions[.microphone] == .granted
        overlay.state.listening.fail(micGranted ? copy.speechServiceUnavailable : copy.microphoneUnavailable)
        hideListening(after: .seconds(4))
        showCompanionAlert(message: copy.voiceError, hint: copy.voiceErrorHint)
    }
}
