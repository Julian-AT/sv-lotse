import Foundation
import LotseProtocol
import Testing
import WebKit

@testable import LotseBridge

/// Tool, approval, job and safety messages through the real WebKit bridge.
@Suite(.serialized) @MainActor
struct NativeMessageBridgeTests {
    private let base = BridgeTests()

    @Test("FR-B1 a ToolInvocation runs natively and the workspace receives its ToolOutput once")
    func toolInvocation() async throws {
        let (server, controller) = try await base.makeWorkspace()
        defer { server.stop() }
        let bridge = NativeMessageBridge(workspace: controller)
        var invocations: [ToolInvocation] = []
        bridge.runTool = { invocation in
            invocations.append(invocation)
            if invocation.toolName == .calendarCreateEvent { throw NativeToolError("CALENDAR_ACCESS_DENIED") }
            return .actionResult(.init(actionID: invocation.toolCallID, confidence: 1, failureReason: nil, resolvedBy: .ui, success: true))
        }
        controller.onMessage = { _ = bridge.receive($0) }
        controller.load()
        try await base.wait { controller.isReady }
        let share = ToolInvocation(input: ["caseId": .string("case-1"), "scope": .unionMap([:])],
            toolCallID: "call-share", toolName: .sessionShareWithHelper)
        try await post(.toolInvocation(.init(id: "tool-1", payload: share, type: .toolInvocation, v: .the100)), in: controller)
        try await post(.toolInvocation(.init(id: "tool-1-repeat", payload: share, type: .toolInvocation, v: .the100)), in: controller)
        let calendar = ToolInvocation(input: ["ics": .string("BEGIN:VCALENDAR")], toolCallID: "call-calendar",
            toolName: .calendarCreateEvent)
        try await post(.toolInvocation(.init(id: "tool-2", payload: calendar, type: .toolInvocation, v: .the100)), in: controller)
        var outputs: [ToolOutput] = []
        let deadline = ContinuousClock.now.advanced(by: .seconds(15))
        while outputs.count < 2, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
            outputs = try await received(controller).compactMap {
                if case .toolOutput(let envelope) = $0 { envelope.payload } else { nil }
            }
        }
        try await Task.sleep(for: .milliseconds(200))
        #expect(invocations.map(\.toolCallID) == ["call-share", "call-calendar"])
        let shared = try #require(outputs.first { $0.toolCallID == "call-share" })
        #expect(shared.error == nil)
        #expect(shared.output == .actionResult(.init(actionID: "call-share", confidence: 1, failureReason: nil,
            resolvedBy: .ui, success: true)))
        let failed = try #require(outputs.first { $0.toolCallID == "call-calendar" })
        #expect(failed.error == "CALENDAR_ACCESS_DENIED")
        #expect(try await received(controller).filter { if case .toolOutput = $0 { true } else { false } }.count == 2)
    }

    @Test("FR-A4 an ApprovalContext is relayed once as an ApprovalDecision with its input channel")
    func approvalDecision() async throws {
        let (server, controller) = try await base.makeWorkspace()
        defer { server.stop() }
        let bridge = NativeMessageBridge(workspace: controller)
        var contexts: [ApprovalContext] = []
        bridge.onApprovalContext = { contexts.append($0) }
        controller.onMessage = { _ = bridge.receive($0) }
        controller.load()
        try await base.wait { controller.isReady }
        let context = ApprovalContext(approvalID: "approval-1", caseID: "case-1",
            inputHash: String(repeating: "a1", count: 32), provenance: [],
            summary: "Den angezeigten Termin in Ihrem Kalender speichern.", toolCallID: "call-1", toolName: "calendar.createEvent")
        try await post(.approvalContext(.init(id: "approval-message", payload: context, type: .approvalContext, v: .the100)),
            in: controller)
        try await post(.approvalContext(.init(id: "approval-repeat", payload: context, type: .approvalContext, v: .the100)),
            in: controller)
        #expect(contexts == [context])
        #expect(bridge.isPending(approvalID: "approval-1"))
        try await bridge.decide(approvalID: "unknown", approved: true, via: .click)
        try await bridge.decide(approvalID: "approval-1", approved: true, via: .key)
        try await bridge.decide(approvalID: "approval-1", approved: false, via: .click)
        let decisions = try await received(controller).compactMap {
            if case .approvalDecision(let envelope) = $0 { envelope.payload } else { nil }
        }
        #expect(decisions == [ApprovalDecision(approvalID: "approval-1", approved: true, reason: nil, via: .key)])
        #expect(bridge.isPending(approvalID: "approval-1") == false)
    }

    @Test("FR-J2 JobProgress reaches the hook on every update and finishes once")
    func jobProgress() async throws {
        let (server, controller) = try await base.makeWorkspace()
        defer { server.stop() }
        let bridge = NativeMessageBridge(workspace: controller)
        var updates: [JobProgress] = []
        var finished: [String] = []
        bridge.onJobProgress = { updates.append($0) }
        bridge.onJobFinished = { finished.append($0.jobID) }
        controller.onMessage = { _ = bridge.receive($0) }
        controller.load()
        try await base.wait { controller.isReady }
        for (index, (state, progress)) in [("running", 0.4), ("completed", 1.0), ("completed", 1.0)].enumerated() {
            let payload = JobProgress(jobID: "job-1", message: "Dokument ist bereit.", progress: progress, state: state)
            try await post(.jobProgress(.init(id: "job-\(index)", payload: payload, type: .jobProgress, v: .the100)), in: controller)
        }
        #expect(updates.map(\.state) == ["running", "completed", "completed"])
        #expect(finished == ["job-1"])
    }

    @Test("SR-1 a SafetyNotice always reaches the native presentation with its numbers")
    func safetyNotice() async throws {
        let (server, controller) = try await base.makeWorkspace()
        defer { server.stop() }
        let bridge = NativeMessageBridge(workspace: controller)
        var notices: [SafetyNotice] = []
        bridge.onSafetyNotice = { notices.append($0) }
        controller.onMessage = { _ = bridge.receive($0) }
        controller.load()
        try await base.wait { controller.isReady }
        let notice = SafetyNotice(numbers: [.init(label: "Rettung", number: "144"), .init(label: "Euronotruf", number: "112")],
            scopeAfter: .administrativeOnly, text: "Bitte rufen Sie sofort den Notruf an.")
        for id in ["safety-1", "safety-2"] {
            try await post(.safetyNotice(.init(id: id, payload: notice, type: .safetyNotice, v: .the100)), in: controller)
        }
        #expect(notices == [notice, notice])
    }

    private func post(_ message: BridgeToNative, in controller: WorkspaceWindowController) async throws {
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(message))
        let result = try await controller.webView.callAsyncJavaScript(
            "await window.webkit.messageHandlers.lotse.postMessage(message); return true",
            arguments: ["message": object], in: nil, contentWorld: .page
        )
        #expect(result as? Bool == true)
    }

    private func received(_ controller: WorkspaceWindowController) async throws -> [BridgeToWorkspace] {
        let data = try await controller.webView.callAsyncJavaScript(
            "return JSON.stringify(window.received)", arguments: [:], in: nil, contentWorld: .page
        )
        let json = try #require(data as? String)
        return try JSONDecoder().decode([BridgeToWorkspace].self, from: Data(json.utf8))
    }
}
