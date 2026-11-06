import CoreGraphics
import CoreText
import Foundation
import ImageIO
@testable import LotseResolver
import Testing

@Test("FR-D4 exact sentence across OCR lines keeps character ranges")
func quoteAcrossOCRLines() {
    #expect(ExactQuoteMatcher.ranges(lines: ["Before. Original", "sentence. After."], quote: "Original\nsentence.") == [
        QuoteLineRange(line: 0, start: 8, end: 16), QuoteLineRange(line: 1, start: 0, end: 9)
    ])
}

@Test("FR-D4 similar or duplicated OCR sentences never choose a guessed target")
func quoteRejectsAmbiguity() {
    #expect(ExactQuoteMatcher.ranges(lines: ["Original sentences."], quote: "Original sentence.").isEmpty)
    #expect(ExactQuoteMatcher.ranges(lines: ["Original sentence.", "Original sentence."], quote: "Original sentence.").isEmpty)
}

@Test("FR-D4 Vision coordinates preserve Retina-independent secondary display placement")
func quoteDisplayCoordinates() {
    let frame = CGRect(x: -1920, y: 400, width: 1920, height: 1080)
    let box = TextQuoteResolver.globalRect(CGRect(x: 0.25, y: 0.5, width: 0.5, height: 0.1), displayFrame: frame)
    #expect(box.minX == -1440)
    #expect(box.minY == 940)
    #expect(box.width == 960)
    #expect(box.height == 108)
}

@Test("FR-D4 real Vision OCR recognizes a rendered administrative quote")
func quoteVisionRecognition() async throws {
    let quote = "Bitte bringen Sie die Unterlagen mit."
    let context = try #require(CGContext(
        data: nil, width: 1000, height: 160, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ))
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 1000, height: 160))
    let font = CTFontCreateWithName("Helvetica" as CFString, 36, nil)
    let text = NSAttributedString(string: quote, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
    context.textPosition = CGPoint(x: 30, y: 70)
    CTLineDraw(CTLineCreateWithAttributedString(text), context)
    let image = try #require(context.makeImage())
    let data = try #require(CFDataCreateMutable(kCFAllocatorDefault, 0))
    let destination = try #require(CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    #expect(CGImageDestinationFinalize(destination))
    let frame = CGRect(x: -1000, y: 400, width: 1000, height: 160)
    let boxes = try await TextQuoteResolver().resolve(quote: quote, imageData: data as Data, displayFrame: frame)
    #expect(boxes.isEmpty == false)
    #expect(boxes.allSatisfy { frame.contains($0) && $0.width > 0 && $0.height > 0 })
}
