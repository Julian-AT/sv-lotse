import CoreGraphics
import Foundation

/// Display-relative coordinates, normalized from the shared video's content (without letterboxing).
struct HelperPointerEvent: Decodable, Sendable {
    enum Kind: String, Decodable { case cursor, annotation, clear }
    struct Point: Decodable, Sendable {
        let x: Double
        let y: Double
        var isValid: Bool { x.isFinite && y.isFinite && (0...1).contains(x) && (0...1).contains(y) }
        func screenPoint(in frame: CGRect) -> CGPoint {
            CGPoint(x: frame.minX + x * frame.width, y: frame.maxY - y * frame.height)
        }
    }
    let kind: Kind
    let sequence: UInt64
    let x: Double?
    let y: Double?
    let points: [Point]?

    static func decode(_ data: Data) -> Self? {
        guard data.count <= RelativesConfiguration.maximumEventBytes,
              let event = try? JSONDecoder().decode(Self.self, from: data) else { return nil }
        switch event.kind {
        case .cursor:
            guard let x = event.x, let y = event.y, Point(x: x, y: y).isValid else { return nil }
        case .annotation:
            guard let points = event.points, (2...RelativesConfiguration.maximumAnnotationPoints).contains(points.count),
                  points.allSatisfy(\.isValid) else { return nil }
        case .clear: break
        }
        return event
    }
}
