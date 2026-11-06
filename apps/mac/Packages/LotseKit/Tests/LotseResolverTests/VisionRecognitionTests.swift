import CoreGraphics
import CoreText
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import LotseResolver

@Test("FR-C3 Apple Vision resolves an actual rendered line without a provider or screen capture")
func recognizesRenderedLine() async throws {
    let image = try renderedLine()
    let lines = try await OCRTargetResolver.lines(in: image)
    let result = try OCRTargetResolver.resolve(quote: "Visible label", lines: lines,
        display: CGRect(x: -1200, y: 200, width: 1000, height: 400))
    #expect(result.method == .ocr)
    #expect(result.rect.width > 100)
    #expect(result.rect.minX >= -1200)
    #expect(result.rect.maxX <= -200)
}

private func renderedLine() throws -> Data {
    let color = CGColorSpaceCreateDeviceRGB()
    let context = try #require(CGContext(data: nil, width: 1000, height: 400, bitsPerComponent: 8, bytesPerRow: 4000,
        space: color, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 1000, height: 400))
    let font = CTFontCreateWithName("Helvetica" as CFString, 56, nil)
    let text = NSAttributedString(string: "Visible label", attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
    ])
    context.textPosition = CGPoint(x: 80, y: 180)
    CTLineDraw(CTLineCreateWithAttributedString(text), context)
    let image = try #require(context.makeImage())
    let bytes = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(bytes, UTType.png.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    #expect(CGImageDestinationFinalize(destination))
    return bytes as Data
}
