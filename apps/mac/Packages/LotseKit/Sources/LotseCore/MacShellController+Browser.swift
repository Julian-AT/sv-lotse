import AppKit
import LotseProtocol

extension MacShellController {
    /// Portal pages in the default browser: opening, approved typing, and display actions that
    /// must reach the overlay instead of the guided window. Returns true when consumed.
    func receiveBrowserMessage(_ message: BridgeToNative) -> Bool {
        switch message {
        case .action(let envelope) where browserPage.claimsOpen(envelope.payload):
            let action = envelope.payload
            Task { @MainActor [weak self] in
                guard let self else { return }
                let result = await browserPage.open(action)
                try? await workspace.send(.actionResult(.init(id: UUID().uuidString, payload: result, type: .actionResult, v: .the100)))
            }
            return true
        case .action(let envelope) where envelope.payload.sourceText == nil:
            guard let target = GuidedPortalCapability.destination(envelope.payload)?.1, browserPage.claimsDisplay(target)
            else { return false }
            switch envelope.payload {
            case .point, .highlight, .annotate, .caption:
                try? receiveWorkspaceAction(envelope)
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
