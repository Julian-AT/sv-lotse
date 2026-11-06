import AppKit
import LotseProtocol
import os

extension MacShellController {
    /// Portal pages in the default browser: opening, approved typing, and display actions that
    /// must reach the overlay instead of the guided window. Returns true when consumed.
    /// The companion cursor leaves the mouse, flies to the step and highlights it; it returns to the
    /// mouse only when no further step follows for a while.
    func presentBrowserStep(_ step: BrowserPageCapability.Step) {
        if overlayVisible { overlay.showOverlay() }
        overlay.state.highlights = []
        overlay.state.target = CGPoint(x: step.rect.midX, y: step.rect.midY)
        overlay.state.caption = step.label
        overlay.state.annotation = .init(rect: step.rect, style: .highlight, label: nil, number: 1)
        browserStepExpiry?.cancel()
        browserStepExpiry = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(6)) } catch { return }
            self?.overlay.state.clear()
        }
    }

    /// One short spoken sentence for a step the pilot does on its own in the browser.
    func sayBrowserStep(_ text: String) {
        speech.enqueue(SpeechSegment(actionIDS: [], citations: [], index: 0, language: settings.language.rawValue,
            text: settings.language == .english ? Self.englishStep(text) : text, turnID: "browser-\(UUID().uuidString)"))
    }

    private static func englishStep(_ text: String) -> String {
        [
            "Hier steht der Antrag.": "Here is the application.",
            "Hier finden Sie das Antragsformular.": "Here is the application form.",
            "Ich öffne den Link zum Antrag.": "I am opening the link to the application."
        ][text] ?? text
    }

    /// The open result continues the conversation, so a failed delivery is retried and logged.
    private func sendBrowserResult(_ result: ActionResult) async {
        for attempt in 1...3 {
            do {
                try await workspace.send(.actionResult(.init(id: UUID().uuidString.lowercased(), payload: result,
                    type: .actionResult, v: .the100)))
                return
            } catch {
                Logger(subsystem: "dev.svkilotse.mac", category: "browser")
                    .error("open result delivery \(attempt) failed: \(String(describing: error), privacy: .public)")
                try? await Task.sleep(for: .milliseconds(400))
            }
        }
    }

    func receiveBrowserMessage(_ message: BridgeToNative) -> Bool {
        switch message {
        case .action(let envelope) where browserPage.claimsOpen(envelope.payload):
            let action = envelope.payload
            Task { @MainActor [weak self] in
                guard let self else { return }
                let result = await browserPage.open(action)
                await sendBrowserResult(result)
                // Show the page right away instead of waiting for the next model turn.
                guard result.success else { return }
                if let step = await browserPage.firstLook() {
                    presentBrowserStep(step)
                    try? await Task.sleep(for: .milliseconds(900))
                }
                await browserPage.applicationTour(present: { [weak self] in self?.presentBrowserStep($0) },
                    say: { [weak self] in self?.sayBrowserStep($0) })
            }
            return true
        case .action(let envelope) where envelope.payload.sourceText == nil:
            guard let target = GuidedPortalCapability.destination(envelope.payload)?.1, browserPage.claimsDisplay(target)
            else { return false }
            switch envelope.payload {
            case .point, .highlight, .annotate, .caption:
                // On the browser page the cursor moves at once, also in silent typed turns, instead
                // of waiting for a spoken sentence; steps run one after another.
                let action = envelope.payload
                let previous = browserSteps
                browserSteps = Task { @MainActor [weak self] in
                    await previous?.value
                    guard let self else { return }
                    var resolved = try? await browserPage.resolve(target)
                    if resolved == nil {
                        // The page may still be moving: retry once, then show the page's heading.
                        try? await Task.sleep(for: .milliseconds(400))
                        resolved = try? await browserPage.resolve(target)
                    }
                    if let resolved {
                        presentBrowserStep(.init(rect: resolved.rect, label: ""))
                    } else if let heading = await browserPage.firstLook() {
                        browserPage.log.info("browser target fell back to the page heading")
                        presentBrowserStep(heading)
                    }
                    let id = GuidedPortalCapability.destination(action)?.0 ?? ""
                    try? await workspace.send(.actionResult(.init(id: UUID().uuidString.lowercased(), payload: ActionResult(
                        actionID: id, confidence: resolved?.confidence ?? 0, failureReason: resolved == nil ? "target_unavailable" : nil,
                        resolvedBy: .ax, success: resolved != nil), type: .actionResult, v: .the100)))
                    try? await Task.sleep(for: .milliseconds(700))
                }
                return true
            default: return false
            }
        case .toolInvocation(let envelope) where browserPage.claimsFill(envelope.payload):
            let invocation = envelope.payload
            Task { @MainActor [weak self] in
                guard let self else { return }
                let output = await browserPage.fill(invocation, approvals: guidedPortal.approvals) { [weak self] rect, value in
                    self?.overlay.state.target = CGPoint(x: rect.midX, y: rect.midY)
                    self?.overlay.state.caption = value
                }
                try? await workspace.send(.toolOutput(.init(id: UUID().uuidString, payload: output, type: .toolOutput, v: .the100)))
            }
            return true
        default: return false
        }
    }
}
