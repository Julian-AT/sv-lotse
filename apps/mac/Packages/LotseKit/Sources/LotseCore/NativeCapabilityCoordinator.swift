import AppKit
import AVFoundation
import LotseBridge
import LotseCapture
import LotseOverlay
import LotseProtocol
import LotseVoice

/// Runs the workspace's OS-bound client tools and presents approval, job and safety messages.
/// It never decides an approval itself and never executes anything because of one.
@MainActor
final class NativeCapabilityCoordinator {
    let bridge: NativeMessageBridge
    var onJobProgress: ((JobProgress) -> Void)?
    private(set) var jobStatusText = ""
    private let overlay: OverlayWindowManager
    private let speech: SpeechPlaybackController
    private weak var shell: MacShellController?
    private let approvals = ApprovalPromptController()
    private lazy var calendar = CalendarEventWriter()
    private let announcer = AVSpeechSynthesizer()
    private var noticeExpiry: Task<Void, Never>?

    init(shell: MacShellController, overlay: OverlayWindowManager, speech: SpeechPlaybackController) {
        bridge = NativeMessageBridge(workspace: shell.workspace)
        self.shell = shell
        self.overlay = overlay
        self.speech = speech
        bridge.runTool = { [weak self] invocation in
            guard let self else { throw NativeToolError("CLIENT_TOOL_UNAVAILABLE") }
            return try await run(invocation)
        }
        bridge.onSafetyNotice = { [weak self] in self?.presentSafety($0) }
        bridge.onApprovalContext = { [weak self] context in
            guard let self else { return }
            approvals.copy = ApprovalPromptCopy(english: language == .english)
            approvals.present(context)
        }
        approvals.onDecision = { [weak self] context, approved, via in
            Task { @MainActor [weak self] in
                // The workspace may be gone; the in-page approval card still answers the request.
                try? await self?.bridge.decide(approvalID: context.approvalID, approved: approved, via: via)
            }
        }
        bridge.onJobProgress = { [weak self] progress in
            guard let self else { return }
            jobStatusText = progress.message.isEmpty ? progress.state : progress.message
            onJobProgress?(progress)
        }
        bridge.onJobFinished = { [weak self] progress in self?.announce(progress.message) }
    }

    private var language: CompanionLanguage { shell?.settings.language ?? .german }

    func receive(_ message: BridgeToNative) -> Bool { bridge.receive(message) }

    func reset() {
        bridge.reset()
        approvals.dismissAll()
    }

    func stop() {
        reset()
        announcer.stopSpeaking(at: .immediate)
    }

    // MARK: Tools

    private func run(_ invocation: ToolInvocation) async throws -> ToolOutputOutput {
        let id = invocation.toolCallID
        switch invocation.toolName {
        case .contextReadScreen:
            // The tool call is the explicit request; ScreenContextCapture applies the exclusion list.
            do { return .contextCapsule(try await ScreenContextCapture.capture(language: language.rawValue)) } catch {
                if error is CancellationError { throw error }
                throw NativeToolError("SCREEN_CAPTURE_UNAVAILABLE")
            }
        case .contextReadPage:
            // The page Lotse opened in the browser (Accessibility), else the guided portal window.
            var page = await shell?.browserPage.snapshot()
            if page == nil { page = try? await shell?.guidedPortal.snapshot() }
            return .contextCapsule(ContextCapsule(focusedRegion: nil, page: page, screen: nil))
        case .uiClick:
            guard let shell else { throw NativeToolError("CLIENT_TOOL_UNAVAILABLE") }
            return .actionResult(await shell.browserPage.click(invocation) { shell.presentBrowserStep($0) })
        case .uiScroll:
            guard let shell else { throw NativeToolError("CLIENT_TOOL_UNAVAILABLE") }
            return .actionResult(await shell.browserPage.scroll(invocation) { shell.presentBrowserStep($0) })
        case .sessionShareWithHelper:
            // Opens the consent UI only; sharing starts after the user confirms there.
            guard let shell else { throw NativeToolError("CLIENT_TOOL_UNAVAILABLE") }
            shell.relatives.showSharing()
            return .actionResult(.init(actionID: id, confidence: 1, failureReason: nil, resolvedBy: .ui, success: true))
        case .calendarCreateEvent:
            guard case .string(let ics) = invocation.input["ics"] else { throw NativeToolError("INVALID_CALENDAR_EVENT") }
            _ = try await calendar.save(ics: ics)
            return .actionResult(.init(actionID: id, confidence: 1, failureReason: nil, resolvedBy: .ui, success: true))
        case .uiFill:
            let fill = try FillInput(invocation.input)
            guard case .ax = fill.target else { throw NativeToolError("CLIENT_TOOL_UNAVAILABLE") }
            // Native apps are never typed into: the cursor points at the field and the user types the value.
            shell?.performVoiceAction(.type(.init(id: "\(id)-pointer", kind: .type,
                payload: .init(pace: 0, provenance: fill.provenance, value: fill.value), sentenceIndex: 0, target: fill.target)))
            overlay.state.caption = fill.value
            return .actionResult(.init(actionID: id, confidence: 0, failureReason: "USER_TYPES", resolvedBy: .ax, success: false))
        }
    }

    // MARK: Safety and jobs

    private func presentSafety(_ notice: SafetyNotice) {
        let numbers = notice.numbers.map { "\($0.label): \($0.number)" }
        let text = ([notice.text] + numbers).joined(separator: "\n")
        if let shell, shell.overlayVisible == false {
            shell.overlayVisible = true
            overlay.showOverlay()
        }
        overlay.state.notice = text
        noticeExpiry?.cancel()
        noticeExpiry = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(180)) } catch { return }
            if self?.overlay.state.notice == text { self?.overlay.state.notice = "" }
        }
        let spoken = ([notice.text] + numbers).joined(separator: ". ")
        // Never suppressed: the provider voice falls back to the Apple voice when unavailable.
        speech.enqueue(SpeechSegment(actionIDS: [], citations: [], index: 0, language: language.rawValue,
            text: spoken, turnID: "safety-\(UUID().uuidString)"))
    }

    private func announce(_ message: String) {
        guard message.isEmpty == false else { return }
        let utterance = AVSpeechUtterance(string: message)
        utterance.voice = AVSpeechSynthesisVoice(language: language.rawValue)
        announcer.speak(utterance)
    }
}

private struct FillInput: Decodable {
    let target: Target
    let value: String
    let provenance: Provenance

    init(_ input: [String: JSONValue]) throws {
        do { self = try JSONDecoder().decode(Self.self, from: JSONEncoder().encode(input)) } catch {
            throw NativeToolError("INVALID_TOOL_INPUT")
        }
    }
}

extension MacShellController {
    /// Job progress from the workspace stream, for the menu bar and dashboard.
    public var onJobProgress: ((JobProgress) -> Void)? {
        get { native.onJobProgress }
        set { native.onJobProgress = newValue }
    }

    /// The latest job message, or its state when the message is empty.
    public var jobStatusText: String { native.jobStatusText }
}
