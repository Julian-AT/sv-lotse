import AppKit
import SwiftUI

public struct CircleSelection: Sendable {
    public let displayID: CGDirectDisplayID
    public let globalRect: CGRect
}

/// Bounding a scribble also supports an ellipse, a rectangle, or a diagonal drag.
struct CircleSelectionBounds {
    private var bounds: CGRect?

    mutating func append(_ point: CGPoint) {
        let sample = CGRect(origin: point, size: .zero)
        bounds = bounds.map { $0.union(sample) } ?? sample
    }

    func selection(in frame: CGRect) -> CGRect? {
        guard let bounds else { return nil }
        let clipped = bounds.intersection(frame)
        guard clipped.isNull == false,
            clipped.width >= OverlayConfiguration.minimumSelectionSize,
            clipped.height >= OverlayConfiguration.minimumSelectionSize
        else { return nil }
        return clipped
    }
}

@MainActor
final class CircleDrawingView: NSView {
    var completed: ((CGRect?) -> Void)?
    var instruction = ""
    private var selection = CircleSelectionBounds()
    private var stroke = NSBezierPath()

    override var acceptsFirstResponder: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func mouseDown(with event: NSEvent) {
        selection = CircleSelectionBounds()
        stroke = NSBezierPath()
        let point = convert(event.locationInWindow, from: nil)
        selection.append(point)
        stroke.move(to: point)
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        selection.append(point)
        stroke.line(to: point)
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        selection.append(convert(event.locationInWindow, from: nil))
        completed?(selection.selection(in: bounds))
    }

    override func rightMouseDown(with event: NSEvent) { completed?(nil) }

    override func draw(_ dirtyRect: NSRect) {
        (instruction as NSString).draw(
            at: CGPoint(x: 20, y: max(20, bounds.height - 50)),
            withAttributes: [.font: NSFont.systemFont(ofSize: 18), .foregroundColor: NSColor.labelColor,
                             .backgroundColor: NSColor.windowBackgroundColor]
        )
        NSColor(OverlayPalette.brand).setStroke()
        stroke.lineWidth = OverlayConfiguration.selectionStrokeWidth
        stroke.lineCapStyle = .round
        stroke.lineJoinStyle = .round
        stroke.stroke()
    }
}
