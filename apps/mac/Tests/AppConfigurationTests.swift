import XCTest

final class AppConfigurationTests: XCTestCase {
    func testFR_C7_menuBarAgentHasJustInTimePermissionDescriptions() {
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "LSUIElement") as? Bool, true)
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String)
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") as? String)
    }
}
