import AppKit
import LotseProtocol

public enum TargetResolutionError: Error { case unavailable, ambiguous, stale, lowConfidence }

public enum TargetIdentity {
    /// Action id is preferred for rectangles, avoiding collisions between multiple form instances.
    public static func keys(for target: Target, actionID: String) -> [String] {
        switch target {
        case .ui(let value): return [actionID, value.elementID]
        case .form(let value): return [actionID, "\(value.formInstanceID):\(value.fieldID)", value.fieldID]
        case .dom(let value): return [actionID, value.handle]
        default: return [actionID]
        }
    }
}

@MainActor
public final class TargetResolver {
    private var rectangles: [String: (TargetRect, Date)] = [:]
    public init() {}

    public func update(_ rectangle: TargetRect, now: Date = Date()) {
        rectangles = rectangles.filter { now.timeIntervalSince($0.value.1) <= ResolverConfiguration.rectangleLifetime }
        rectangles[rectangle.targetID] = (rectangle, now)
    }

    public func clear() { rectangles.removeAll() }

    /// TargetRect uses top-left web-view points. Scale is metadata, never applied a second time.
    public func workspaceTarget(
        _ target: Target, actionID: String, viewport: CGRect, now: Date = Date()
    ) throws -> ResolvedTarget {
        for key in TargetIdentity.keys(for: target, actionID: actionID) {
            guard let (value, received) = rectangles[key] else { continue }
            guard now.timeIntervalSince(received) <= ResolverConfiguration.rectangleLifetime else { throw TargetResolutionError.stale }
            let rect = CGRect(x: value.rect.x, y: value.rect.y, width: value.rect.width, height: value.rect.height)
            guard value.visible, value.scale.isFinite, value.scale > 0, rect.isEmpty == false,
                rect.minX >= 0, rect.minY >= 0, rect.maxX <= viewport.width, rect.maxY <= viewport.height
            else { throw TargetResolutionError.unavailable }
            let global = CGRect(
                x: viewport.minX + rect.minX, y: viewport.maxY - rect.maxY, width: rect.width, height: rect.height
            )
            return ResolvedTarget(rect: global, method: target.isDOM ? .dom : .ui, confidence: 1)
        }
        throw TargetResolutionError.unavailable
    }

    public static func point(_ target: TargetPoint, screens: [CGRect]) throws -> ResolvedTarget {
        guard (ResolverConfiguration.minimumConfidence...1).contains(target.confidence) else { throw TargetResolutionError.lowConfidence }
        guard screens.indices.contains(target.screenIndex), (0...1).contains(target.x), (0...1).contains(target.y) else {
            throw TargetResolutionError.unavailable
        }
        let frame = screens[target.screenIndex]
        let point = CGPoint(
            x: min(frame.maxX - 0.5, max(frame.minX + 0.5, frame.minX + target.x * frame.width)),
            y: min(frame.maxY - 0.5, max(frame.minY + 0.5, frame.maxY - target.y * frame.height))
        )
        return .init(rect: CGRect(x: point.x - 0.5, y: point.y - 0.5, width: 1, height: 1), method: .vision, confidence: target.confidence)
    }
}

private extension Target {
    var isDOM: Bool { if case .dom = self { true } else { false } }
}
