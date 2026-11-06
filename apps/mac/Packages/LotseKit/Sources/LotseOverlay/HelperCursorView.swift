import AppKit
import SwiftUI

public struct HelperCursor: Equatable, Sendable {
    public let identity: String
    public let name: String
    public let position: CGPoint

    public init(identity: String, name: String, position: CGPoint) {
        self.identity = identity
        self.name = name
        self.position = position
    }
}

public struct HelperAnnotation: Identifiable, Sendable {
    public let id = UUID()
    public let identity: String
    public let points: [CGPoint]

    public init(identity: String, points: [CGPoint]) {
        self.identity = identity
        self.points = points
    }
}

@MainActor
struct HelperCursorView: View {
    let screenFrame: CGRect
    let state: OverlayState
    private let color = OverlayPalette.helper

    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(state.helperAnnotations) { annotation in
                Path { path in
                    guard let first = annotation.points.first else { return }
                    path.move(to: localPoint(first))
                    for point in annotation.points.dropFirst() { path.addLine(to: localPoint(point)) }
                }
                .stroke(color, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
                .accessibilityHidden(true)
            }
            if let cursor = state.helperCursor, screenFrame.contains(cursor.position) {
                VStack(alignment: .leading, spacing: 2) {
                    let pointer = PointerGlyph(size: 14, fill: color, rotation: -35)
                    pointer.padding(-pointer.padding)
                    Text(verbatim: cursor.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OverlayPalette.onBrand)
                        .padding(6)
                        .background(color, in: .rect(cornerRadius: 6))
                }
                .foregroundStyle(color)
                .fixedSize()
                .offset(x: localPoint(cursor.position).x, y: localPoint(cursor.position).y)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(cursor.name)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipped()
        .allowsHitTesting(false)
    }

    private func localPoint(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x - screenFrame.minX, y: screenFrame.maxY - point.y)
    }
}
