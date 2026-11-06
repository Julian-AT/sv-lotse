import AppKit
import ApplicationServices
import LotseProtocol

public enum AccessibilityTargetResolver {
    public static func resolve(_ target: TargetAx, primaryTop: CGFloat) async throws -> ResolvedTarget {
        try await Task.detached {
            guard AXIsProcessTrusted(),
                let application = NSRunningApplication.runningApplications(withBundleIdentifier: target.appBundleID).first
            else { throw TargetResolutionError.unavailable }
            let root = AXUIElementCreateApplication(application.processIdentifier)
            AXUIElementSetMessagingTimeout(root, ResolverConfiguration.axMessagingTimeout)
            var queue: [(AXUIElement, [String])] = [(root, [])]
            let deadline = Date().addingTimeInterval(ResolverConfiguration.axTraversalBudget)
            var visited = 0
            var matches: [CGRect] = []
            while visited < queue.count && visited < ResolverConfiguration.maximumAXNodes {
                try Task.checkCancellation()
                guard Date() < deadline else { throw TargetResolutionError.unavailable }
                let (element, ancestors) = queue[visited]
                visited += 1
                let role = string(element, kAXRoleAttribute)
                let label = string(element, kAXTitleAttribute) ?? string(element, kAXDescriptionAttribute)
                let identifier = string(element, kAXIdentifierAttribute)
                let token = identifier ?? label ?? role ?? ""
                let path = ancestors + [token]
                if role == target.role, target.label.isEmpty || label == target.label,
                    target.path.isEmpty || path.suffix(target.path.count).elementsEqual(target.path),
                    let rect = frame(element, primaryTop: primaryTop) {
                    matches.append(rect)
                    if matches.count > 1 { throw TargetResolutionError.ambiguous }
                }
                if let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement] {
                    queue += children.prefix(max(0, ResolverConfiguration.maximumAXNodes - queue.count)).map { ($0, path) }
                }
            }
            guard let rect = matches.first else { throw TargetResolutionError.unavailable }
            return ResolvedTarget(rect: rect, method: .ax, confidence: 1)
        }.value
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value
    }

    private static func string(_ element: AXUIElement, _ name: String) -> String? { attribute(element, name) as? String }

    private static func frame(_ element: AXUIElement, primaryTop: CGFloat) -> CGRect? {
        guard let position = attribute(element, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
            let sizeValue = attribute(element, kAXSizeAttribute), CFGetTypeID(sizeValue) == AXValueGetTypeID()
        else { return nil }
        var point = CGPoint.zero
        // Core Foundation type IDs are verified above before the toll-free casts.
        let pointValue = unsafeDowncast(position, to: AXValue.self)
        let size = unsafeDowncast(sizeValue, to: AXValue.self)
        var dimensions = CGSize.zero
        guard AXValueGetValue(pointValue, .cgPoint, &point), AXValueGetValue(size, .cgSize, &dimensions),
            dimensions.width > 0, dimensions.height > 0
        else { return nil }
        return CGRect(x: point.x, y: primaryTop - point.y - dimensions.height, width: dimensions.width, height: dimensions.height)
    }
}
