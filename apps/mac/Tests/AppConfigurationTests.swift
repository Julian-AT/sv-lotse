import XCTest

final class AppConfigurationTests: XCTestCase {
    func testFR_C7_dockAppHasJustInTimePermissionDescriptions() {
        XCTAssertNil(Bundle.main.object(forInfoDictionaryKey: "LSUIElement"))
        XCTAssertEqual(Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String, "SV KI-Lotse")
        XCTAssertEqual(
            Bundle.main.object(forInfoDictionaryKey: "LSApplicationCategoryType") as? String, "public.app-category.productivity"
        )
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String)
        XCTAssertNotNil(Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") as? String)
    }
}
