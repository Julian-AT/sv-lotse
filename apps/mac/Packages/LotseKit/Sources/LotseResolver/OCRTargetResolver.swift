import CoreGraphics
import Foundation
import ImageIO
import Vision

public struct OCRLine: Sendable, Equatable {
    public let text: String
    /// Normalized, top-left coordinates, independent of screenshot pixel scaling.
    public let box: CGRect
    public let confidence: Double

    public init(text: String, box: CGRect, confidence: Double) {
        self.text = text
        self.box = box
        self.confidence = confidence
    }
}

public enum OCRTargetResolver {
    public static func lines(in image: Data) async throws -> [OCRLine] {
        try await Task.detached {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ResolverConfiguration.recognitionLanguages
            request.usesLanguageCorrection = false
            try VNImageRequestHandler(data: image).perform([request])
            try Task.checkCancellation()
            return (request.results ?? []).compactMap { observation in
                guard let text = observation.topCandidates(1).first else { return nil }
                let box = observation.boundingBox
                return OCRLine(text: text.string,
                    box: CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height),
                    confidence: Double(text.confidence))
            }
        }.value
    }

    public static func resolve(quote: String, lines: [OCRLine], display: CGRect) throws -> ResolvedTarget {
        let normalized = normalize(quote)
        guard normalized.isEmpty == false else { throw TargetResolutionError.unavailable }
        let matches = lines.filter { normalize($0.text).contains(normalized) }
        if matches.contains(where: { normalize($0.text).components(separatedBy: normalized).count > 2 }) {
            throw TargetResolutionError.ambiguous
        }
        guard matches.count < 2 else { throw TargetResolutionError.ambiguous }
        guard let line = matches.first, line.confidence >= ResolverConfiguration.minimumConfidence else {
            throw TargetResolutionError.unavailable
        }
        let box = line.box
        return .init(rect: CGRect(x: display.minX + box.minX * display.width,
            y: display.maxY - box.maxY * display.height, width: box.width * display.width, height: box.height * display.height),
            method: .ocr, confidence: line.confidence)
    }

    private static func normalize(_ value: String) -> String { value.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ") }
}
