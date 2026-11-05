import Foundation
import LotseProtocol
import XCTest

final class ProtocolTests: XCTestCase {
    private var fixtureRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("fixtures")
    }

    private func normalize(_ data: Data) throws -> Data {
        let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .fragmentsAllowed])
    }

    private func roundTrip<Value: Codable & Sendable & Equatable>(
        _ type: Value.Type, _ data: Data
    ) throws -> Data {
        let value = try JSONDecoder().decode(type, from: data)
        let encoded = try JSONEncoder().encode(value)
        XCTAssertEqual(value, try JSONDecoder().decode(type, from: encoded))
        return encoded
    }

    private func roundTrip(_ name: String, _ data: Data) throws -> Data {
        switch name {
        case "BridgeHello": return try roundTrip(BridgeHello.self, data)
        case "ClientHello": return try roundTrip(ClientHello.self, data)
        case "Transcript": return try roundTrip(Transcript.self, data)
        case "TurnRequest": return try roundTrip(TurnRequest.self, data)
        case "ContextCapsule": return try roundTrip(ContextCapsule.self, data)
        case "SpeechSegment": return try roundTrip(SpeechSegment.self, data)
        case "Action": return try roundTrip(Action.self, data)
        case "ToolInvocation": return try roundTrip(ToolInvocation.self, data)
        case "ToolOutput": return try roundTrip(ToolOutput.self, data)
        case "ApprovalContext": return try roundTrip(ApprovalContext.self, data)
        case "ApprovalDecision": return try roundTrip(ApprovalDecision.self, data)
        case "ActionResult": return try roundTrip(ActionResult.self, data)
        case "SpeechControl": return try roundTrip(SpeechControl.self, data)
        case "TargetRect": return try roundTrip(TargetRect.self, data)
        case "Fact": return try roundTrip(Fact.self, data)
        case "CaseEvent": return try roundTrip(CaseEvent.self, data)
        case "JobProgress": return try roundTrip(JobProgress.self, data)
        case "SafetyNotice": return try roundTrip(SafetyNotice.self, data)
        case "Target": return try roundTrip(Target.self, data)
        default: throw NSError(domain: "Uncovered protocol fixture", code: 1)
        }
    }

    func testAC3EveryValidFixtureRoundTripsWithoutChangingJSON() throws {
        let directories = try FileManager.default.contentsOfDirectory(
            at: fixtureRoot, includingPropertiesForKeys: nil
        ).filter { $0.hasDirectoryPath }.sorted { $0.path < $1.path }
        XCTAssertEqual(directories.count, 19)
        var count = 0
        for directory in directories {
            for fixture in try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: nil
            ).filter({ $0.lastPathComponent.hasPrefix("valid") && $0.pathExtension == "json" }) {
                let source = try Data(contentsOf: fixture)
                let encoded = try roundTrip(directory.lastPathComponent, source)
                XCTAssertEqual(try normalize(source), try normalize(encoded), fixture.path)
                count += 1
            }
        }
        XCTAssertGreaterThanOrEqual(count, 19)
    }

    func testAC3InvalidFixturesRespectSwiftTypeConstraints() throws {
        let directories = try FileManager.default.contentsOfDirectory(
            at: fixtureRoot, includingPropertiesForKeys: nil
        ).filter { $0.hasDirectoryPath }
        for directory in directories {
            for fixture in try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: nil
            ).filter({ $0.lastPathComponent.hasPrefix("invalid") && $0.pathExtension == "json" }) {
                let data = try Data(contentsOf: fixture)
                if fixture.lastPathComponent.hasPrefix("invalid-uri-") {
                    // URI formats are schema constraints; Codable represents them as strings.
                    let encoded = try roundTrip(directory.lastPathComponent, data)
                    XCTAssertEqual(try normalize(data), try normalize(encoded), fixture.path)
                } else {
                    XCTAssertThrowsError(try roundTrip(directory.lastPathComponent, data), fixture.path)
                }
            }
        }
    }

    func testFRC5BridgeEnvelopesPreserveDiscriminantsAndRejectMismatchedPayloads() throws {
        let workspace = ["BridgeHello", "Transcript", "ToolOutput", "ApprovalDecision", "ActionResult", "SpeechControl"]
        let native = ["SpeechSegment", "Action", "TargetRect", "ToolInvocation", "ApprovalContext", "JobProgress", "SafetyNotice", "SpeechControl"]
        for (names, isWorkspace) in [(workspace, true), (native, false)] {
            for name in names {
                let payload = try JSONSerialization.jsonObject(with: Data(contentsOf:
                    fixtureRoot.appendingPathComponent(name).appendingPathComponent("valid.json")
                ))
                var envelope: [String: Any] = [
                    "v": "1.0.0", "type": name, "id": "bridge-message-1", "payload": payload
                ]
                let source = try JSONSerialization.data(withJSONObject: envelope)
                let encoded = isWorkspace
                    ? try roundTrip(BridgeToWorkspace.self, source)
                    : try roundTrip(BridgeToNative.self, source)
                XCTAssertEqual(try normalize(source), try normalize(encoded), name)
                for (key, value) in [("v", "2.0.0"), ("type", "UnknownMessage")] {
                    var invalid = envelope
                    invalid[key] = value
                    let data = try JSONSerialization.data(withJSONObject: invalid)
                    if isWorkspace {
                        XCTAssertThrowsError(try JSONDecoder().decode(BridgeToWorkspace.self, from: data))
                    } else {
                        XCTAssertThrowsError(try JSONDecoder().decode(BridgeToNative.self, from: data))
                    }
                }
                envelope["payload"] = ["unexpected": true]
                let invalidPayload = try JSONSerialization.data(withJSONObject: envelope)
                if isWorkspace {
                    XCTAssertThrowsError(try JSONDecoder().decode(BridgeToWorkspace.self, from: invalidPayload))
                } else {
                    XCTAssertThrowsError(try JSONDecoder().decode(BridgeToNative.self, from: invalidPayload))
                }
            }
        }
    }
}
