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

    private func roundTrip<Value: ProtocolValidating & Sendable & Equatable>(
        _ type: Value.Type, _ data: Data
    ) throws -> Data {
        let value: Value = try decodeValidated(data)
        let encoded = try JSONEncoder().encode(value)
        let decoded: Value = try decodeValidated(encoded)
        XCTAssertEqual(value, decoded)
        return encoded
    }

    private func roundTrip(_ name: String, _ data: Data) throws -> Data {
        let codecs: [String: (Data) throws -> Data] = [
            "BridgeHello": { try self.roundTrip(BridgeHello.self, $0) },
            "ClientHello": { try self.roundTrip(ClientHello.self, $0) },
            "Transcript": { try self.roundTrip(Transcript.self, $0) },
            "TurnRequest": { try self.roundTrip(TurnRequest.self, $0) },
            "ContextCapsule": { try self.roundTrip(ContextCapsule.self, $0) },
            "SpeechSegment": { try self.roundTrip(SpeechSegment.self, $0) },
            "Action": { try self.roundTrip(Action.self, $0) },
            "ToolInvocation": { try self.roundTrip(ToolInvocation.self, $0) },
            "ToolOutput": { try self.roundTrip(ToolOutput.self, $0) },
            "ApprovalContext": { try self.roundTrip(ApprovalContext.self, $0) },
            "ApprovalDecision": { try self.roundTrip(ApprovalDecision.self, $0) },
            "ActionResult": { try self.roundTrip(ActionResult.self, $0) },
            "SpeechControl": { try self.roundTrip(SpeechControl.self, $0) },
            "TargetRect": { try self.roundTrip(TargetRect.self, $0) },
            "Fact": { try self.roundTrip(Fact.self, $0) },
            "CaseEvent": { try self.roundTrip(CaseEvent.self, $0) },
            "JobProgress": { try self.roundTrip(JobProgress.self, $0) },
            "SafetyNotice": { try self.roundTrip(SafetyNotice.self, $0) },
            "Target": { try self.roundTrip(Target.self, $0) },
            "BridgeToNative": { try self.roundTrip(BridgeToNative.self, $0) },
            "BridgeToWorkspace": { try self.roundTrip(BridgeToWorkspace.self, $0) }
        ]
        guard let codec = codecs[name] else {
            throw NSError(domain: "Uncovered protocol fixture", code: 1)
        }
        return try codec(data)
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

    func testAC1EveryInvalidFixtureIsRejectedByValidatedDecoding() throws {
        let directories = try FileManager.default.contentsOfDirectory(
            at: fixtureRoot, includingPropertiesForKeys: nil
        ).filter { $0.hasDirectoryPath }
        for directory in directories {
            for fixture in try FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: nil
            ).filter({ $0.lastPathComponent.hasPrefix("invalid") && $0.pathExtension == "json" }) {
                let data = try Data(contentsOf: fixture)
                XCTAssertThrowsError(try roundTrip(directory.lastPathComponent, data), fixture.path)
            }
        }
    }

    func testAC1SharedConstraintFixturesAgreeWithZod() throws {
        struct Fixture: Decodable {
            let name: String
            let schema: String
            let valid: Bool
            let value: JSONValue
        }
        let url = fixtureRoot.deletingLastPathComponent()
            .appendingPathComponent("test/fixtures/validation.json")
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(fixtures.count, 40)
        for fixture in fixtures {
            let data = try JSONEncoder().encode(fixture.value)
            if fixture.valid {
                XCTAssertNoThrow(try roundTrip(fixture.schema, data), fixture.name)
            } else {
                XCTAssertThrowsError(try roundTrip(fixture.schema, data), fixture.name)
            }
        }
    }

    func testNFR13ValidateAlsoRejectsInvalidValuesConstructedInSwift() throws {
        let result = ActionResult(actionID: "", confidence: 1.01, failureReason: nil,
                                  resolvedBy: .ui, success: true)
        XCTAssertThrowsError(try result.validate())
        let point = TargetPoint(confidence: 0.5, kind: .point, screenIndex: -1, x: 0, y: 1)
        XCTAssertThrowsError(try point.validate())
        let target = Target.point(point)
        XCTAssertThrowsError(try target.validate())
        let request = TurnRequest(actionResults: [result], capsule: ContextCapsule(
            focusedRegion: nil, page: nil, screen: nil
        ), caseID: nil, inputKind: .text, language: nil, subjectID: nil)
        XCTAssertThrowsError(try request.validate()) { error in
            XCTAssertEqual(error as? ProtocolValidationError,
                           ProtocolValidationError(path: ["actionResults", "0", "actionId"],
                                                   keyword: "minLength"))
        }
    }

    func testNFR13JSONValuesKeepOpenKeysAndRecursivelyRejectNonfiniteNumbers() throws {
        let valid = JSONValue.unionMap(["additional": .unionArray([.null, .double(0.5)])])
        XCTAssertNoThrow(try valid.validate())
        let encoded = try JSONEncoder().encode(valid)
        let decoded: JSONValue = try decodeValidated(encoded)
        XCTAssertEqual(decoded, valid)
        let invalid = JSONValue.unionMap(["additional": .unionArray([.double(.infinity)])])
        XCTAssertThrowsError(try invalid.validate()) { error in
            XCTAssertEqual(error as? ProtocolValidationError,
                           ProtocolValidationError(path: ["additional", "0"], keyword: "type"))
        }
    }

    func testFRC5BridgeEnvelopesPreserveDiscriminantsAndRejectMismatchedPayloads() throws {
        let workspace = ["BridgeHello", "Transcript", "ToolOutput", "ApprovalDecision", "ActionResult", "SpeechControl"]
        let native = [
            "SpeechSegment", "Action", "TargetRect", "ToolInvocation",
            "ApprovalContext", "JobProgress", "SafetyNotice", "SpeechControl"
        ]
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
                        XCTAssertThrowsError(try decodeValidated(data) as BridgeToWorkspace)
                    } else {
                        XCTAssertThrowsError(try decodeValidated(data) as BridgeToNative)
                    }
                }
                envelope["payload"] = ["unexpected": true]
                let invalidPayload = try JSONSerialization.data(withJSONObject: envelope)
                if isWorkspace {
                    XCTAssertThrowsError(try decodeValidated(invalidPayload) as BridgeToWorkspace)
                } else {
                    XCTAssertThrowsError(try decodeValidated(invalidPayload) as BridgeToNative)
                }
            }
        }
    }
}
