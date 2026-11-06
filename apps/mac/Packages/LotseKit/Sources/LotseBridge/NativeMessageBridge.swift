import Foundation
import LotseProtocol

/// A tool failure with a stable code that the workspace reports as the tool's error.
public struct NativeToolError: Error, Equatable, Sendable {
    public let code: String
    public init(_ code: String) { self.code = code }
}

/// Routes the workspace's tool, approval, job and safety messages to native capabilities and
/// answers with `ToolOutput` and `ApprovalDecision`. Approval decisions are only relayed: the
/// workspace answers the SDK approval and the brain verifies it server-side. Nothing executes here.
@MainActor
public final class NativeMessageBridge {
    public var runTool: ((ToolInvocation) async throws -> ToolOutputOutput)?
    public var onApprovalContext: ((ApprovalContext) -> Void)?
    public var onJobProgress: ((JobProgress) -> Void)?
    /// Called once per job when it reaches a finished state.
    public var onJobFinished: ((JobProgress) -> Void)?
    public var onSafetyNotice: ((SafetyNotice) -> Void)?
    private let send: @MainActor (BridgeToWorkspace) async throws -> Void
    private var runningTools: [String: Task<Void, Never>] = [:]
    private var answeredTools: Set<String> = []
    private var pendingApprovals: Set<String> = []
    private var finishedJobs: Set<String> = []

    public init(send: @escaping @MainActor (BridgeToWorkspace) async throws -> Void) { self.send = send }

    public convenience init(workspace: WorkspaceWindowController) {
        self.init(send: { [weak workspace] message in
            guard let workspace else { throw WorkspaceError.notReady }
            try await workspace.send(message)
        })
    }

    public static let finishedJobStates: Set<String> = ["completed", "done", "succeeded"]

    /// Returns false for messages that belong to other capabilities.
    public func receive(_ message: BridgeToNative) -> Bool {
        switch message {
        case .toolInvocation(let envelope): invoke(envelope.payload)
        case .approvalContext(let envelope):
            let context = envelope.payload
            guard pendingApprovals.insert(context.approvalID).inserted else { return true }
            onApprovalContext?(context)
        case .jobProgress(let envelope):
            let progress = envelope.payload
            onJobProgress?(progress)
            if Self.finishedJobStates.contains(progress.state), finishedJobs.insert(progress.jobID).inserted {
                onJobFinished?(progress)
            }
        case .safetyNotice(let envelope): onSafetyNotice?(envelope.payload)
        default: return false
        }
        return true
    }

    public func isPending(approvalID: String) -> Bool { pendingApprovals.contains(approvalID) }

    /// Relays the user's decision once. Only approvals the workspace announced can be answered.
    public func decide(approvalID: String, approved: Bool, via: Via, reason: String? = nil) async throws {
        guard pendingApprovals.remove(approvalID) != nil else { return }
        try await send(.approvalDecision(.init(
            id: UUID().uuidString,
            payload: ApprovalDecision(approvalID: approvalID, approved: approved, reason: reason, via: via),
            type: .approvalDecision, v: .the100
        )))
    }

    /// A new workspace document has its own conversation: drop pending work of the old one.
    public func reset() {
        for task in runningTools.values { task.cancel() }
        runningTools.removeAll()
        answeredTools.removeAll()
        pendingApprovals.removeAll()
    }

    private func invoke(_ invocation: ToolInvocation) {
        let id = invocation.toolCallID
        guard runningTools[id] == nil, answeredTools.contains(id) == false else { return }
        runningTools[id] = Task { @MainActor [weak self] in
            let output: ToolOutput
            do {
                guard let runTool = self?.runTool else { throw NativeToolError("CLIENT_TOOL_UNAVAILABLE") }
                output = ToolOutput(error: nil, output: try await runTool(invocation), toolCallID: id)
            } catch {
                let code = (error as? NativeToolError)?.code ?? (error is CancellationError ? "USER_STOPPED" : "NATIVE_TOOL_FAILED")
                output = ToolOutput(error: code, output: .actionResult(.init(
                    actionID: id, confidence: 0, failureReason: code, resolvedBy: .ui, success: false
                )), toolCallID: id)
            }
            guard let self, Task.isCancelled == false, runningTools.removeValue(forKey: id) != nil else { return }
            answeredTools.insert(id)
            try? await send(.toolOutput(.init(id: UUID().uuidString, payload: output, type: .toolOutput, v: .the100)))
        }
    }
}
