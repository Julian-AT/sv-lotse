import Foundation
import LotseProtocol
import Testing

@testable import LotseGuidedWindow

/// Reference value from `inputHash` in packages/brain/src/approvals/canonical.ts for `fillInput()`.
private let serverHash = "bac27c3ec5cc3088748d15203319d5986517251fe897b4e51c5bf497c824d097"

private func fillInput(value: String = "Müller \"Alex\"\n\u{01}") -> [String: JSONValue] {
    [
        "value": .string(value),
        "target": .unionMap([
            "kind": .string("dom"), "url": .string("https://portal.example.at/form"), "handle": .string("h-1")
        ]),
        "provenance": .unionMap([
            "factId": .string("fact-1"),
            "source": .unionMap([
                "kind": .string("document"), "documentId": .string("doc-1"), "page": .double(2),
                "quote": .string("Müller"),
                "bbox": .unionMap([
                    "x": .double(0.125), "y": .double(0.5), "width": .double(0.25), "height": .double(0.0625)
                ])
            ])
        ])
    ]
}

private func context(toolCallID: String = "call-1", hash: String = serverHash, tool: String = "ui.fill") -> ApprovalContext {
    ApprovalContext(
        approvalID: "approval-1", caseID: "case-1", inputHash: hash, provenance: [], summary: "",
        toolCallID: toolCallID, toolName: tool
    )
}

@Test("FR-D7 the native input hash equals the server's canonical approval hash")
func canonicalHash() {
    #expect(GuidedFillApprovals.inputHash(fillInput()) == serverHash)
}

@Test("FR-D7 portal typing needs the server-bound approval of exactly this input, once") @MainActor
func serverBoundFill() throws {
    let approvals = GuidedFillApprovals()
    let invocation = ToolInvocation(input: fillInput(), toolCallID: "call-1", toolName: .uiFill)
    #expect(throws: GuidedFillError.approvalRequired) { try approvals.consume(invocation) }

    approvals.record(context(tool: "calendar.createEvent"))
    #expect(throws: GuidedFillError.approvalRequired) { try approvals.consume(invocation) }

    approvals.record(context())
    let changed = ToolInvocation(input: fillInput(value: "Other"), toolCallID: "call-1", toolName: .uiFill)
    #expect(throws: GuidedFillError.approvalRequired) { try approvals.consume(changed) }

    let approved = try approvals.consume(invocation)
    #expect(approved.approvalID == "approval-1")
    guard case .type(let action) = approved.action, case .dom(let target) = action.target else {
        Issue.record("expected a DOM type action")
        return
    }
    #expect(action.payload.value == "Müller \"Alex\"\n\u{01}")
    #expect(action.payload.pace > 0)
    #expect(target.handle == "h-1")
    // Single use: a replayed invocation types nothing.
    #expect(throws: GuidedFillError.approvalRequired) { try approvals.consume(invocation) }
}

@Test("FR-D7 an approval that was never verified expires without typing") @MainActor
func expiredApproval() {
    let approvals = GuidedFillApprovals()
    let start = Date()
    approvals.record(context(), now: start)
    let invocation = ToolInvocation(input: fillInput(), toolCallID: "call-1", toolName: .uiFill)
    #expect(throws: GuidedFillError.approvalRequired) {
        try approvals.consume(invocation, now: start.addingTimeInterval(GuidedFillApprovals.lifetime + 1))
    }
}
