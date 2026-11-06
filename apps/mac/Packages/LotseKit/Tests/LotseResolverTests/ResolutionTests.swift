import CoreGraphics
import Foundation
import LotseProtocol
import Testing

@testable import LotseResolver

@Test("FR-C2 screen points convert using the selected display origin")
func coordinateConversion() {
    let frame = CGRect(x: -1200, y: 200, width: 1200, height: 900)
    #expect(ScreenCoordinates.localPoint(CGPoint(x: -1100, y: 1000), in: frame) == CGPoint(x: 100, y: 100))
}

@Test("FR-C3 retina TargetRect uses window points and the current viewport origin") @MainActor
func workspaceRectangle() throws {
    let resolver = TargetResolver()
    resolver.update(.init(rect: .init(height: 30, width: 120, x: 10, y: 20), scale: 2, targetID: "field", visible: true))
    let result = try resolver.workspaceTarget(.ui(.init(elementID: "field", kind: .ui)), actionID: "action",
        viewport: CGRect(x: -1200, y: 200, width: 1000, height: 800))
    #expect(result.rect == CGRect(x: -1190, y: 950, width: 120, height: 30))
    #expect(result.method == .ui)
}

@Test("FR-C3 hidden, stale and offscreen workspace targets cannot be pointed at") @MainActor
func unavailableRectangle() {
    let resolver = TargetResolver()
    let target = LotseProtocol.Target.ui(.init(elementID: "field", kind: .ui))
    let viewport = CGRect(x: 0, y: 0, width: 1000, height: 800)
    let now = Date()
    resolver.update(.init(rect: .init(height: 30, width: 120, x: 10, y: 20), scale: 2, targetID: "field", visible: false))
    #expect(throws: TargetResolutionError.self) { try resolver.workspaceTarget(target, actionID: "action", viewport: viewport) }
    resolver.update(.init(rect: .init(height: 30, width: 120, x: 10, y: 20), scale: 2, targetID: "field", visible: true), now: now)
    #expect(throws: TargetResolutionError.self) {
        try resolver.workspaceTarget(target, actionID: "action", viewport: viewport, now: now.addingTimeInterval(4))
    }
    resolver.update(.init(rect: .init(height: 30, width: 120, x: 990, y: 20), scale: 2, targetID: "field", visible: true))
    #expect(throws: TargetResolutionError.self) { try resolver.workspaceTarget(target, actionID: "action", viewport: viewport) }
}

@Test("FR-C3 OCR preserves line geometry and refuses ambiguous quotes")
func ocrLineResolution() throws {
    let line = OCRLine(text: "Visible   label", box: CGRect(x: 0.1, y: 0.2, width: 0.3, height: 0.1), confidence: 0.99)
    let display = CGRect(x: -1200, y: 200, width: 1000, height: 800)
    let resolved = try OCRTargetResolver.resolve(quote: "Visible label", lines: [line], display: display)
    #expect(abs(resolved.rect.minY - 760) < 0.001)
    #expect(resolved.rect.minX == -1100)
    #expect(resolved.method == .ocr)
    #expect(throws: TargetResolutionError.self) {
        try OCRTargetResolver.resolve(quote: "Visible label", lines: [line, line], display: display)
    }
}

@Test("FR-C3 points select the requested monitor and reject low confidence") @MainActor
func normalizedPoint() throws {
    let displays = [CGRect(x: 0, y: 0, width: 1000, height: 800), CGRect(x: -1200, y: 200, width: 1200, height: 900)]
    let target = TargetPoint(confidence: 0.95, kind: .point, screenIndex: 1, x: 0.25, y: 0.5)
    let result = try TargetResolver.point(target, screens: displays)
    #expect(CGPoint(x: result.rect.midX, y: result.rect.midY) == CGPoint(x: -900, y: 650))
    #expect(throws: TargetResolutionError.self) {
        try TargetResolver.point(.init(confidence: 0.5, kind: .point, screenIndex: 1, x: 0.2, y: 0.2), screens: displays)
    }
}

@Test("FR-C3 points on screenshot edges remain visible on their requested monitor") @MainActor
func screenEdges() throws {
    let screen = CGRect(x: -1200, y: 200, width: 1200, height: 900)
    for x in [0.0, 1.0] {
        for y in [0.0, 1.0] {
            let result = try TargetResolver.point(.init(confidence: 1, kind: .point, screenIndex: 0, x: x, y: y), screens: [screen])
            #expect(screen.contains(CGPoint(x: result.rect.midX, y: result.rect.midY)))
        }
    }
}
