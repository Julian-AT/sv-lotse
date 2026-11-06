import AppKit
import CoreText
import Foundation
import LotseProtocol
import Testing

@testable import LotseCapture

@Test("FR-C2 Vision boxes become normalized top-left source coordinates")
func visionCoordinates() {
    let box = ScreenOCR.normalizedTopLeftBox(CGRect(x: 0.1, y: 0.7, width: 0.5, height: 0.2))
    #expect(abs(box.y - 0.1) < 0.0001)
    #expect(box.x == 0.1)
    #expect(box.width == 0.5)
    #expect(abs(box.height - 0.2) < 0.0001)
}

@Test("FR-C6 focus on a monitor left and above the main display uses that display's coordinates")
func focusedDisplayCoordinates() throws {
    let frame = CGRect(x: -2000, y: 100, width: 2000, height: 1000)
    let box = try ScreenContextBuilder.focusedBox(CGRect(x: -1800, y: 700, width: 400, height: 200), in: frame)
    #expect(box == BoundingBox(height: 0.2, width: 0.2, x: 0.1, y: 0.2))
    let clipped = try ScreenContextBuilder.focusedBox(CGRect(x: -2200, y: 900, width: 400, height: 400), in: frame)
    #expect(clipped == BoundingBox(height: 0.2, width: 0.1, x: 0, y: 0))
}

@Test("FR-C2 all displays contribute OCR and structured boxes remain on the cursor display")
func allDisplayContext() throws {
    let screens = [screenContext(index: 0, cursor: false), screenContext(index: 1, cursor: true)]
    let capsule = try ScreenContextBuilder.capsule(screens: screens, focus: nil, language: "de-AT")
    let screen = try #require(capsule.screen)
    #expect(screen.screenIndex == 1)
    #expect(screen.ocrLines.map(\.text) == ["Display 1"])
    #expect(screen.summary.contains("Display 0"))
    #expect(screen.summary.contains("Display 1"))
    #expect(capsule.focusedRegion == nil)
    #expect(screen.image == nil)
    let envelope = BridgeToWorkspace.transcript(.init(
        id: "screen-context-test", payload: Transcript(capsule: capsule, language: "de-AT", text: "Question", transcriptFinal: true),
        type: .transcript, v: .the100
    ))
    let data = try JSONEncoder().encode(envelope)
    let decoded: BridgeToWorkspace = try decodeValidated(data)
    #expect(decoded == envelope)
}

@Test("FR-C6 circled monitor overrides cursor monitor and a disconnected monitor fails closed")
func focusOverridesCursor() throws {
    let focus = ScreenFocus(displayID: 100, globalRect: CGRect(x: 100, y: 400, width: 200, height: 100))
    let screens = [screenContext(index: 0, cursor: false), screenContext(index: 1, cursor: true)]
    let capsule = try ScreenContextBuilder.capsule(screens: screens, focus: focus, language: "en-GB")
    #expect(capsule.screen?.screenIndex == 0)
    #expect(capsule.focusedRegion == BoundingBox(height: 0.2, width: 0.2, x: 0.1, y: 0))
    #expect(throws: CaptureError.self) {
        try ScreenContextBuilder.capsule(screens: [screens[1]], focus: focus, language: "de-AT")
    }
}

@Test("FR-C2 configured application exclusions extend rather than replace bundled protection")
func additionalExclusions() throws {
    let name = "capture-exclusion-test-\(UUID())"
    let preferences = try #require(UserDefaults(suiteName: name))
    defer { preferences.removePersistentDomain(forName: name) }
    preferences.set(["test.additional-sensitive"], forKey: CaptureConfiguration.additionalExclusionsKey)
    let exclusions = try CaptureConfiguration.excludedBundleIdentifiers(preferences: preferences)
    #expect(exclusions.contains("com.1password.1password"))
    #expect(exclusions.contains("com.moneymoney-app.retail"))
    #expect(exclusions.contains("test.additional-sensitive"))
}

private func screenContext(index: Int, cursor: Bool) -> CapturedScreenContext {
    CapturedScreenContext(
        capture: CompanionScreenCapture(
            imageData: Data(), screenIndex: index, isCursorScreen: cursor,
            displayFrame: CGRect(x: index * 1000, y: 0, width: 1000, height: 500),
            pixelSize: CGSize(width: 1000, height: 500), displayID: UInt32(100 + index)
        ),
        lines: [OcrLine(bbox: BoundingBox(height: 0.1, width: 0.5, x: 0.1, y: 0.2), text: "Display \(index)")]
    )
}

@Test("FR-C2 real Vision OCR returns text and normalized line boxes from an image")
func recognizeRenderedText() async throws {
    let context = try #require(CGContext(
        data: nil, width: 900, height: 180, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 900, height: 180))
    let font = CTFontCreateWithName("Helvetica" as CFString, 48, nil)
    let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
    ]
    let text = NSAttributedString(string: "SCREEN CONTEXT 42", attributes: attributes)
    context.textPosition = CGPoint(x: 30, y: 60)
    CTLineDraw(CTLineCreateWithAttributedString(text), context)
    let image = try #require(context.makeImage())
    let data = try #require(NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]))
    let lines = try await ScreenOCR.recognize(imageData: data)
    #expect(lines.contains { $0.text.contains("SCREEN CONTEXT 42") })
    #expect(lines.allSatisfy { $0.bbox.width > 0 && $0.bbox.height > 0 && $0.bbox.x >= 0 && $0.bbox.y >= 0 })
}
