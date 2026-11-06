import AppKit
import LotseProtocol

struct ApprovalPromptCopy {
    let title: String
    let approve: String
    let decline: String
    let approveHint: String
    let declineHint: String

    init(english: Bool) {
        title = english ? "Approval needed" : "Ihre Freigabe"
        approve = english ? "Approve (Enter)" : "Freigeben (Eingabe)"
        decline = english ? "Decline (Esc)" : "Ablehnen (Esc)"
        approveHint = english ? "Approves exactly the described change." : "Gibt genau die beschriebene Änderung frei."
        declineHint = english ? "Nothing is changed." : "Es wird nichts geändert."
    }
}

/// Non-modal prompt near the overlay caption. It only reports the user's choice; the workspace
/// answers the SDK approval and the brain verifies it. Enter approves, Escape declines.
@MainActor
final class ApprovalPromptController {
    var onDecision: ((ApprovalContext, Bool, Via) -> Void)?
    var copy = ApprovalPromptCopy(english: false)
    private var queue: [ApprovalContext] = []
    private var panel: ApprovalPanel?

    var current: ApprovalContext? { queue.first }

    func present(_ context: ApprovalContext) {
        guard queue.contains(where: { $0.approvalID == context.approvalID }) == false else { return }
        queue.append(context)
        if queue.count == 1 { show(context) }
    }

    func dismissAll() {
        queue.removeAll()
        panel?.orderOut(nil)
        panel = nil
    }

    func decide(_ approved: Bool, via: Via) {
        guard let context = queue.first else { return }
        queue.removeFirst()
        panel?.orderOut(nil)
        panel = nil
        onDecision?(context, approved, via)
        if let next = queue.first { show(next) }
    }

    private func show(_ context: ApprovalContext) {
        let panel = ApprovalPanel(context: context, copy: copy)
        panel.onDecision = { [weak self] approved, via in self?.decide(approved, via: via) }
        let screen = NSScreen.screens.first(where: { $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main
        if let visible = screen?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: visible.maxX - panel.frame.width - 24, y: visible.maxY - panel.frame.height - 24))
        }
        self.panel = panel
        panel.orderFrontRegardless()
        panel.makeKey()
        NSAccessibility.post(element: panel, notification: .announcementRequested, userInfo: [
            .announcement: "\(copy.title): \(context.summary)", .priority: NSAccessibilityPriorityLevel.high.rawValue
        ])
    }
}

@MainActor
private final class ApprovalPanel: NSPanel {
    var onDecision: ((Bool, Via) -> Void)?
    /// A keystroke meant for another app must not answer a prompt that just appeared.
    private let keyArmedAt = Date().addingTimeInterval(0.6)

    init(context: ApprovalContext, copy: ApprovalPromptCopy) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 380, height: 10),
            styleMask: [.titled, .nonactivatingPanel, .fullSizeContentView, .utilityWindow], backing: .buffered, defer: false)
        title = copy.title
        level = .floating
        isFloatingPanel = true
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        standardWindowButton(.closeButton)?.isHidden = true
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true

        let heading = NSTextField(labelWithString: copy.title)
        heading.font = .systemFont(ofSize: 13, weight: .semibold)
        let summary = NSTextField(wrappingLabelWithString: context.summary)
        summary.font = .systemFont(ofSize: 15)
        summary.preferredMaxLayoutWidth = 340
        summary.setAccessibilityLabel(context.summary)
        let decline = NSButton(title: copy.decline, target: nil, action: nil)
        decline.setAccessibilityLabel(copy.decline)
        decline.setAccessibilityHelp(copy.declineHint)
        let approve = NSButton(title: copy.approve, target: nil, action: nil)
        approve.bezelColor = .controlAccentColor
        approve.setAccessibilityLabel(copy.approve)
        approve.setAccessibilityHelp(copy.approveHint)
        decline.target = self
        decline.action = #selector(declineClicked)
        approve.target = self
        approve.action = #selector(approveClicked)
        let buttons = NSStackView(views: [decline, approve])
        buttons.spacing = 10
        let stack = NSStackView(views: [heading, summary, buttons])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.edgeInsets = NSEdgeInsets(top: 34, left: 20, bottom: 18, right: 20)
        stack.setAccessibilityElement(true)
        stack.setAccessibilityRole(.group)
        stack.setAccessibilityLabel("\(copy.title): \(context.summary)")
        contentView = stack
        setContentSize(stack.fittingSize)
        initialFirstResponder = approve
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 36, 76: keyDecision(true, event)
        case 53: keyDecision(false, event)
        default: super.keyDown(with: event)
        }
    }

    override func cancelOperation(_ sender: Any?) {
        if Date() >= keyArmedAt { onDecision?(false, .key) }
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.keyCode == 36 || event.keyCode == 76 else { return super.performKeyEquivalent(with: event) }
        keyDecision(true, event)
        return true
    }

    private func keyDecision(_ approved: Bool, _ event: NSEvent) {
        guard event.isARepeat == false, Date() >= keyArmedAt else { return }
        onDecision?(approved, .key)
    }

    @objc private func approveClicked() { onDecision?(true, .click) }
    @objc private func declineClicked() { onDecision?(false, .click) }
}
