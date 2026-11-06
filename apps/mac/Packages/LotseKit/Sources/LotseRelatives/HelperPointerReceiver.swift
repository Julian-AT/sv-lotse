import Foundation
import LotseOverlay

@MainActor
final class HelperPointerReceiver {
    private let overlay: OverlayState
    private var sequences: [String: UInt64] = [:]
    private var displayFrame: CGRect = .zero

    init(overlay: OverlayState) { self.overlay = overlay }

    func begin(displayFrame: CGRect) {
        clear()
        self.displayFrame = displayFrame
    }

    func receive(data: Data, identity: String, name: String, topic: String) {
        guard topic == RelativesConfiguration.eventTopic,
              identity.hasPrefix(RelativesConfiguration.helperIdentityPrefix),
              let event = HelperPointerEvent.decode(data),
              sequences[identity].map({ event.sequence > $0 }) ?? true else { return }
        sequences[identity] = event.sequence
        let label = String(name.unicodeScalars.filter {
            CharacterSet.controlCharacters.contains($0) == false
        }.prefix(RelativesConfiguration.maximumLabelScalars))
        switch event.kind {
        case .cursor:
            guard let x = event.x, let y = event.y else { return }
            let point = HelperPointerEvent.Point(x: x, y: y).screenPoint(in: displayFrame)
            overlay.helperCursor = .init(
                identity: identity, name: label.isEmpty ? RelativesCopy().helper : label,
                position: CGPoint(x: min(point.x, displayFrame.maxX.nextDown), y: min(point.y, displayFrame.maxY.nextDown))
            )
        case .annotation:
            guard let points = event.points else { return }
            overlay.helperAnnotations.append(.init(identity: identity, points: points.map { $0.screenPoint(in: displayFrame) }))
            overlay.helperAnnotations = Array(overlay.helperAnnotations.suffix(RelativesConfiguration.maximumAnnotations))
        case .clear:
            remove(identity: identity)
        }
    }

    func remove(identity: String) {
        if overlay.helperCursor?.identity == identity { overlay.helperCursor = nil }
        overlay.helperAnnotations.removeAll { $0.identity == identity }
    }

    func disconnect(identity: String) {
        sequences.removeValue(forKey: identity)
        remove(identity: identity)
    }

    func clear() {
        sequences.removeAll()
        overlay.helperCursor = nil
        overlay.helperAnnotations.removeAll()
    }
}
