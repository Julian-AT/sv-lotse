import Foundation
import Testing

@testable import LotseRelatives

@Test("FR-R2 decodes the web token route's fractional ISO expiry and rejects insecure providers")
func webCredentials() throws {
    let expiry = ISO8601DateFormatter.string(from: Date().addingTimeInterval(60), timeZone: .gmt,
                                            formatOptions: [.withInternetDateTime, .withFractionalSeconds])
    let json = """
    {"serverUrl":"wss://livekit.test","participantToken":"test-only-token","expiresAt":"\(expiry)"}
    """
    let decoded = try JSONDecoder().decode(RelativesCredentials.self, from: Data(json.utf8))
    #expect(decoded.participantToken == "test-only-token")
    #expect(decoded.expiresAt > Date())
    for url in ["ws://livekit.test", "https://livekit.test", "wss://user:password@livekit.test"] {
        #expect(throws: RelativesError.invalidCredentials) {
            try RelativesCredentials(serverUrl: #require(URL(string: url)), participantToken: "test-only-token",
                                     expiresAt: Date().addingTimeInterval(60))
        }
    }
    #expect(throws: RelativesError.invalidCredentials) {
        try RelativesCredentials(serverUrl: #require(URL(string: "wss://livekit.test")), participantToken: "test-only-token",
                                 expiresAt: .distantPast)
    }
}
