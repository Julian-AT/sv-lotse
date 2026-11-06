import CoreGraphics
import Foundation
import Vision

public struct QuoteLineRange: Equatable, Sendable {
    public let line: Int
    public let start: Int
    public let end: Int
}

public enum ExactQuoteMatcher {
    public static func ranges(lines: [String], quote: String) -> [QuoteLineRange] {
        var characters: [Character] = []
        var locations: [(line: Int, offset: Int)] = []
        for (line, text) in lines.enumerated() {
            if characters.isEmpty == false && characters.last != " " {
                characters.append(" ")
                locations.append((line, 0))
            }
            for (offset, character) in text.enumerated() {
                if character.isWhitespace {
                    if characters.isEmpty || characters.last == " " { continue }
                    characters.append(" ")
                } else { characters.append(character) }
                locations.append((line, offset))
            }
        }
        let needle = quote.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let text = String(characters)
        guard needle.isEmpty == false, let match = text.range(of: needle),
            text.range(of: needle, range: text.index(after: match.lowerBound)..<text.endIndex) == nil
        else { return [] }
        let start = text.distance(from: text.startIndex, to: match.lowerBound)
        let end = text.distance(from: text.startIndex, to: match.upperBound)
        var result: [QuoteLineRange] = []
        for location in locations[start..<end] {
            if let last = result.last, last.line == location.line {
                result[result.count - 1] = .init(line: last.line, start: last.start, end: location.offset + 1)
            } else { result.append(.init(line: location.line, start: location.offset, end: location.offset + 1)) }
        }
        return result
    }
}

public actor TextQuoteResolver {
    public init() {}

    public func resolve(quote: String, imageData: Data, displayFrame: CGRect) throws -> [CGRect] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["de-DE", "en-US"]
        request.usesLanguageCorrection = false
        try perform(request, imageData: imageData)
        let candidates = (request.results ?? []).compactMap { $0.topCandidates(1).first }
        let matches = ExactQuoteMatcher.ranges(lines: candidates.map(\.string), quote: quote)
        return try matches.compactMap { match in
            let candidate = candidates[match.line]
            let start = candidate.string.index(candidate.string.startIndex, offsetBy: match.start)
            let end = candidate.string.index(candidate.string.startIndex, offsetBy: match.end)
            guard let box = try candidate.boundingBox(for: start..<end)?.boundingBox else { return nil }
            return Self.globalRect(box, displayFrame: displayFrame)
        }
    }

    private func perform(_ request: VNRecognizeTextRequest, imageData: Data) throws {
        let handler = VNImageRequestHandler(data: imageData)
        do { try handler.perform([request]) } catch {
            // Some displays/sessions expose no usable GPU. Retry with supported CPU stages.
            var configured = false
            for (stage, devices) in try request.supportedComputeStageDevices {
                if let cpu = devices.first(where: { device in
                    if case .cpu = device { return true }
                    return false
                }) {
                    request.setComputeDevice(cpu, for: stage)
                    configured = true
                }
            }
            guard configured else { throw error }
            try handler.perform([request])
        }
    }

    public static func globalRect(_ normalized: CGRect, displayFrame: CGRect) -> CGRect {
        CGRect(x: displayFrame.minX + normalized.minX * displayFrame.width,
               y: displayFrame.minY + normalized.minY * displayFrame.height,
               width: normalized.width * displayFrame.width, height: normalized.height * displayFrame.height)
    }
}
