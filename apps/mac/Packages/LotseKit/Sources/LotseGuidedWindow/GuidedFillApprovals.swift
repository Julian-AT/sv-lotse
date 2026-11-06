import CryptoKit
import Foundation
import LotseProtocol

/// A portal fill whose exact input matches a server-created `ui.fill` approval. Only
/// `GuidedFillApprovals.consume` can create one, so no page or bridge flag can mint it.
public struct GuidedApprovedFill: Sendable {
    public let approvalID: String
    public let toolCallID: String
    public let action: Action
}

public enum GuidedFillError: Error, Equatable {
    case approvalRequired, invalidInput
}

/// Binds `ui.fill` invocations for the guided portal to the server's approval rows.
///
/// The brain creates and HMAC-binds the approval row and streams its `ApprovalContext`
/// through the workspace. The workspace forwards the `ui.fill` invocation only after the
/// server verified the user's decision. Typing additionally requires that this invocation's
/// canonical input hash equals the server-bound `inputHash`. Each approval is single use and
/// expires; a declined or timed-out approval never produces a fill.
@MainActor
public final class GuidedFillApprovals {
    public static let toolName = "ui.fill"
    public static let lifetime: TimeInterval = 10 * 60
    /// Milliseconds between keystrokes; positive keeps portal typing visible.
    public static let typingPace = 60.0

    private struct Pending {
        let approvalID: String
        let inputHash: String
        let received: Date
    }

    private var pending: [String: Pending] = [:]

    public init() {}

    public func record(_ context: ApprovalContext, now: Date = Date()) {
        prune(now)
        guard context.toolName == Self.toolName else { return }
        pending[context.toolCallID] = Pending(approvalID: context.approvalID, inputHash: context.inputHash, received: now)
    }

    public func consume(_ invocation: ToolInvocation, now: Date = Date()) throws -> GuidedApprovedFill {
        prune(now)
        guard invocation.toolName == .uiFill, let approval = pending[invocation.toolCallID] else {
            throw GuidedFillError.approvalRequired
        }
        guard let hash = Self.inputHash(invocation.input), hash == approval.inputHash else {
            throw GuidedFillError.approvalRequired
        }
        pending.removeValue(forKey: invocation.toolCallID)
        return GuidedApprovedFill(
            approvalID: approval.approvalID, toolCallID: invocation.toolCallID,
            action: try Self.action(invocation)
        )
    }

    public func reset() { pending.removeAll() }

    private func prune(_ now: Date) {
        pending = pending.filter { now.timeIntervalSince($0.value.received) < Self.lifetime }
    }

    /// The `ui.fill` input as a visible type action: `{ target, value, provenance }`.
    static func action(_ invocation: ToolInvocation) throws -> Action {
        let input = invocation.input
        guard input.keys.sorted() == ["provenance", "target", "value"], let target = input["target"],
            let value = input["value"], let provenance = input["provenance"]
        else { throw GuidedFillError.invalidInput }
        let raw: JSONValue = .unionMap([
            "id": .string(invocation.toolCallID), "kind": .string("type"), "sentenceIndex": .double(0),
            "target": target,
            "payload": .unionMap(["value": value, "provenance": provenance, "pace": .double(typingPace)])
        ])
        do {
            let action: Action = try decodeValidated(JSONEncoder().encode(raw))
            guard case .type(let typed) = action, case .dom = typed.target else { throw GuidedFillError.invalidInput }
            return action
        } catch { throw GuidedFillError.invalidInput }
    }

    /// SHA-256 over RFC 8785 canonical JSON, matching `packages/brain/src/approvals/canonical.ts`.
    /// Returns nil (fail closed) for numbers whose canonical form is not reproduced exactly.
    nonisolated public static func inputHash(_ input: [String: JSONValue]) -> String? {
        var output = ""
        guard canonical(.unionMap(input), into: &output) else { return nil }
        return SHA256.hash(data: Data(output.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    nonisolated private static func canonical(_ value: JSONValue, into output: inout String) -> Bool {
        switch value {
        case .null: output += "null"
        case .bool(let flag): output += flag ? "true" : "false"
        case .string(let text): output += quoted(text)
        case .double(let number):
            guard let text = canonicalNumber(number) else { return false }
            output += text
        case .unionArray(let items): return canonical(array: items, into: &output)
        case .unionMap(let map): return canonical(map: map, into: &output)
        }
        return true
    }

    nonisolated private static func canonical(array items: [JSONValue], into output: inout String) -> Bool {
        output += "["
        for (index, item) in items.enumerated() {
            if index > 0 { output += "," }
            guard canonical(item, into: &output) else { return false }
        }
        output += "]"
        return true
    }

    /// Keys sort by UTF-16 code units, as RFC 8785 requires.
    nonisolated private static func canonical(map: [String: JSONValue], into output: inout String) -> Bool {
        output += "{"
        let keys = map.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
        for (index, key) in keys.enumerated() {
            if index > 0 { output += "," }
            output += quoted(key) + ":"
            guard let item = map[key], canonical(item, into: &output) else { return false }
        }
        output += "}"
        return true
    }

    nonisolated private static func canonicalNumber(_ value: Double) -> String? {
        guard value.isFinite else { return nil }
        if value == value.rounded(), abs(value) < 9_007_199_254_740_992 { return String(Int64(value)) }
        let text = "\(value)"
        // ECMAScript and Swift agree on shortest round-trip digits without an exponent.
        return text.contains("e") || abs(value) < 1e-6 ? nil : text
    }

    nonisolated private static func quoted(_ text: String) -> String {
        var result = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": result += "\\\""
            case "\\": result += "\\\\"
            case "\u{08}": result += "\\b"
            case "\u{09}": result += "\\t"
            case "\u{0A}": result += "\\n"
            case "\u{0C}": result += "\\f"
            case "\u{0D}": result += "\\r"
            default:
                if scalar.value < 0x20 {
                    result += String(format: "\\u%04x", scalar.value)
                } else {
                    result.unicodeScalars.append(scalar)
                }
            }
        }
        return result + "\""
    }
}
