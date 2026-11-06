import Foundation
import LotseBridge
import LotseGuidedWindow
import LotseImport
import LotseProtocol

@MainActor
public final class GuidedPortalCapability {
    public private(set) var window: GuidedWindowController?
    public private(set) var uploadQueue: EncryptedUploadQueue?
    /// Server-created `ui.fill` approvals seen through the workspace bridge.
    public let approvals = GuidedFillApprovals()
    /// Guided downloads enter the same preview as every other import (FR-D1).
    private var previewDownload: ((UUID) -> Void)?

    public init() {}

    /// Shares the import queue so downloads reach the import preview and `/api/documents`.
    public func connectImports(queue: EncryptedUploadQueue, preview: @escaping (UUID) -> Void) {
        uploadQueue = queue
        previewDownload = preview
        window?.downloads.onQueued = preview
    }

    /// Routes a workspace message that belongs to the guided portal and replies through the
    /// workspace. Returns true when consumed; approval contexts are recorded and passed on.
    public func receive(_ message: BridgeToNative, language: String, workspace: WorkspaceWindowController) -> Bool {
        switch message {
        case .approvalContext(let envelope):
            approvals.record(envelope.payload)
            return false
        case .toolInvocation(let envelope) where claims(envelope.payload):
            let invocation = envelope.payload
            Task { @MainActor [weak self, weak workspace] in
                guard let self, let workspace else { return }
                let output = await fill(invocation)
                await Self.send(.toolOutput(.init(id: UUID().uuidString, payload: output, type: .toolOutput, v: .the100)), workspace)
            }
            return true
        case .action(let envelope):
            guard let (_, target) = Self.destination(envelope.payload), case .dom = target else { return false }
            let action = envelope.payload
            Task { @MainActor [weak self, weak workspace] in
                guard let self, let workspace, let result = await handle(action, language: language) else { return }
                await Self.send(.actionResult(.init(id: UUID().uuidString, payload: result, type: .actionResult, v: .the100)), workspace)
            }
            return true
        default: return false
        }
    }

    private static func send(_ message: BridgeToWorkspace, _ workspace: WorkspaceWindowController) async {
        do { try await workspace.send(message) } catch { workspace.showWorkspace() }
    }

    /// A `ui.fill` whose DOM target lies on an allowlisted portal origin.
    func claims(_ invocation: ToolInvocation) -> Bool {
        guard invocation.toolName == .uiFill, case .unionMap(let target)? = invocation.input["target"],
            target["kind"] == .string("dom"), case .string(let url)? = target["url"]
        else { return false }
        let policy = window?.originPolicy ?? (try? GuidedWindowResources.originPolicy())
        return policy?.allows(url) == true
    }

    /// Types only after the server verified the approval; otherwise nothing is typed.
    func fill(_ invocation: ToolInvocation) async -> ToolOutput {
        let id = invocation.toolCallID
        let outcome: ActionResult
        do {
            let approved = try approvals.consume(invocation)
            guard let window else { throw GuidedWindowError.notReady }
            outcome = try await window.fill(approved)
        } catch GuidedFillError.approvalRequired {
            outcome = result(id, success: false, reason: "APPROVAL_REQUIRED")
        } catch {
            outcome = result(id, success: false, reason: "guided-action-failed")
        }
        return ToolOutput(error: nil, output: .actionResult(outcome), toolCallID: id)
    }

    public func handle(_ action: Action, language: String) async -> ActionResult? {
        guard let (id, target) = Self.destination(action), case .dom(let dom) = target else { return nil }
        do {
            try action.validate()
            if case .openResource = action {
                guard let url = URL(string: dom.url) else { throw GuidedOriginError.invalidOrigin }
                let portal = try makeWindow(language: language)
                try portal.open(url)
                return result(id, success: true)
            }
            guard let window else { throw GuidedWindowError.notReady }
            return try await window.execute([action]).first
        } catch GuidedWindowError.approvalRequired {
            return result(id, success: false, reason: "APPROVAL_REQUIRED")
        } catch GuidedOriginError.invalidOrigin {
            return result(id, success: false, reason: "origin-not-allowed")
        } catch {
            return result(id, success: false, reason: "guided-action-failed")
        }
    }

    public func snapshot() async throws -> Page? {
        guard let window, window.isReady else { return nil }
        return try await window.snapshot()
    }

    public func stop() {
        window?.close()
        approvals.reset()
    }

    private func makeWindow(language: String) throws -> GuidedWindowController {
        if let window { return window }
        let queue = try uploadQueue ?? EncryptedUploadQueue()
        let controller = try GuidedWindowController(
            originPolicy: GuidedWindowResources.originPolicy(), queue: queue, language: language
        )
        controller.downloads.onQueued = previewDownload
        uploadQueue = queue
        window = controller
        return controller
    }

    private func result(_ id: String, success: Bool, reason: String? = nil) -> ActionResult {
        ActionResult(actionID: id, confidence: success ? 1 : 0, failureReason: reason, resolvedBy: .dom, success: success)
    }

    static func destination(_ action: Action) -> (String, Target)? {
        switch action {
        case .openResource(let value): return (value.id, value.target)
        case .point(let value): return (value.id, value.target)
        case .highlight(let value): return (value.id, value.target)
        case .annotate(let value): return (value.id, value.target)
        case .caption(let value): return (value.id, value.target)
        case .type(let value): return (value.id, value.target)
        case .clear(let value): return (value.id, value.target)
        }
    }
}
