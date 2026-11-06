import AppKit
import LotseProtocol
import os

extension MacShellController {
    /// Portal pages in the default browser: opening, approved typing, and display actions that
    /// must reach the overlay instead of the guided window. Returns true when consumed.
    /// The companion cursor leaves the mouse, flies to the step and highlights it; it returns to the
    /// mouse only when no further step follows for a while.
    func presentBrowserStep(_ step: BrowserPageCapability.Step) {
        // Re-showing the overlay would reset the cursor to the mouse: only show it when it is gone.
        if overlayVisible, overlay.isShowing == false { overlay.showOverlay() }
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

    /// The visible tour on the page just opened: the cursor detaches from the mouse, outlines the
    /// heading block, scrolls down by itself, outlines the application section and its link, then
    /// returns to the mouse.
    func runBrowserTour(pace: BrowserPageCapability.TourPace) async {
        browserStepExpiry?.cancel()
        if overlayVisible == false {
            browserPage.log.error("tour runs without the cursor: the overlay is hidden")
        } else if overlay.isShowing == false {
            overlay.showOverlay()
        }
        overlay.state.annotation = nil
        overlay.state.highlights = []
        let tour = "tour-\(UUID().uuidString)"
        var index = 0
        await browserPage.visibleTour(english: settings.language == .english, pace: pace,
            show: { [weak self] frame in self?.overlay.state.tour = frame },
            say: { [weak self] text in
                defer { index += 1 }
                return self?.narrateTourStep(text, tour: tour, index: index)
            })
    }

    /// Speaks a tour step with the companion's voice, also after a typed message (the person asked
    /// to be shown the page); silent when voice is switched off in the settings. The task ends when
    /// the sentence has been spoken or was stopped.
    func narrateTourStep(_ text: String, tour: String, index: Int) -> Task<Void, Never>? {
        guard settings.voiceEnabled else { return nil }
        let segment = SpeechSegment(actionIDS: [], citations: [], index: index, language: settings.language.rawValue,
            text: text, turnID: tour)
        return Task { @MainActor [weak self] in await self?.speech.narrate(segment) }
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
            var hint: String?
            if case .openResource(let open) = action { hint = open.payload.style }
            let pace = BrowserPageCapability.TourPace(hint: hint)
            Task { @MainActor [weak self] in
                guard let self else { return }
                let result = await browserPage.open(action)
                await sendBrowserResult(result)
                // Show the page right away instead of waiting for the next model turn.
                guard result.success else { return }
                await runBrowserTour(pace: pace)
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
