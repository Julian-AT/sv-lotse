// Extracted from Clicky's OverlayWindow.swift. See THIRD_PARTY_NOTICES.md.
import CoreGraphics
import Foundation

public struct CursorFlight: Sendable {
    public let start: CGPoint
    public let end: CGPoint
    public let duration: TimeInterval
    private let control: CGPoint

    public init(start: CGPoint, end: CGPoint) {
        self.start = start
        self.end = end
        let distance = hypot(end.x - start.x, end.y - start.y)
        duration = min(
            max(distance / OverlayConfiguration.flightPointsPerSecond, OverlayConfiguration.minimumFlightDuration),
            OverlayConfiguration.maximumFlightDuration
        )
        control = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - min(distance * 0.2, 80))
    }

    public func position(at progress: Double) -> CGPoint {
        let progress = min(max(progress, 0), 1)
        let eased = progress * progress * (3 - 2 * progress)
        let inverse = 1 - eased
        return CGPoint(
            x: inverse * inverse * start.x + 2 * inverse * eased * control.x + eased * eased * end.x,
            y: inverse * inverse * start.y + 2 * inverse * eased * control.y + eased * eased * end.y
        )
    }

    public func rotation(at progress: Double) -> Double {
        let progress = min(max(progress, 0), 1)
        let eased = progress * progress * (3 - 2 * progress)
        let tangentX = 2 * (1 - eased) * (control.x - start.x) + 2 * eased * (end.x - control.x)
        let tangentY = 2 * (1 - eased) * (control.y - start.y) + 2 * eased * (end.y - control.y)
        return atan2(tangentY, tangentX) * 180 / .pi + 90
    }

    public func scale(at progress: Double) -> Double {
        1 + sin(min(max(progress, 0), 1) * .pi) * 0.3
    }
}
