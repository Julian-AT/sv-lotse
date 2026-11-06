import AppKit
import ApplicationServices
import Carbon.HIToolbox

/// A live accessibility element; all attributes of a node are fetched in one round trip.
public final class LiveAXNode: BrowserAXNode, @unchecked Sendable {
    public let element: AXUIElement
    private let primaryTop: CGFloat
    private lazy var values: [String: CFTypeRef] = {
        let names = [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
            kAXPlaceholderValueAttribute, kAXValueAttribute, kAXURLAttribute, kAXPositionAttribute, kAXSizeAttribute, "AXExpanded"]
        var raw: CFArray?
        guard AXUIElementCopyMultipleAttributeValues(element, names as CFArray, [], &raw) == .success,
            let array = raw as? [CFTypeRef], array.count == names.count
        else { return [:] }
        var result: [String: CFTypeRef] = [:]
        for (name, value) in zip(names, array) where CFGetTypeID(value) != AXValueGetTypeID() || AXValueGetType(unsafeDowncast(value, to: AXValue.self)) != .axError {
            result[name] = value
        }
        return result
    }()

    public init(_ element: AXUIElement, primaryTop: CGFloat) {
        self.element = element
        self.primaryTop = primaryTop
        AXUIElementSetMessagingTimeout(element, 0.25)
    }

    public var role: String? { values[kAXRoleAttribute] as? String }
    public var subrole: String? { values[kAXSubroleAttribute] as? String }
    public var title: String? { values[kAXTitleAttribute] as? String }
    public var nodeDescription: String? { values[kAXDescriptionAttribute] as? String }
    public var placeholder: String? { values[kAXPlaceholderValueAttribute] as? String }
    /// Never read for secure fields: the value of a password field is not requested by callers.
    public var value: String? {
        if BrowserPageReader.isSecure(self) { return nil }
        return values[kAXValueAttribute] as? String
    }
    public var url: String? {
        guard let raw = values[kAXURLAttribute] else { return nil }
        if let url = raw as? URL { return url.absoluteString }
        return raw as? String
    }
    public var expanded: Bool? {
        guard let raw = values["AXExpanded"], CFGetTypeID(raw) == CFBooleanGetTypeID() else { return nil }
        return CFBooleanGetValue(unsafeDowncast(raw, to: CFBoolean.self))
    }
    public var frame: CGRect? {
        guard let position = values[kAXPositionAttribute], CFGetTypeID(position) == AXValueGetTypeID(),
            let size = values[kAXSizeAttribute], CFGetTypeID(size) == AXValueGetTypeID()
        else { return nil }
        var point = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(unsafeDowncast(position, to: AXValue.self), .cgPoint, &point),
            AXValueGetValue(unsafeDowncast(size, to: AXValue.self), .cgSize, &dimensions)
        else { return nil }
        return CGRect(x: point.x, y: primaryTop - point.y - dimensions.height, width: dimensions.width, height: dimensions.height)
    }
    public lazy var children: [LiveAXNode] = {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &raw) == .success,
            let elements = raw as? [AXUIElement]
        else { return [] }
        return elements.map { LiveAXNode($0, primaryTop: primaryTop) }
    }()

    public func refreshedFrame() -> CGRect? { LiveAXNode(element, primaryTop: primaryTop).frame }

    @discardableResult
    public func perform(_ action: String) -> Bool { AXUIElementPerformAction(element, action as CFString) == .success }

    @discardableResult
    public func focus() -> Bool {
        AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
    }

    @discardableResult
    public func setValue(_ text: String) -> Bool {
        guard BrowserPageReader.isSecure(self) == false else { return false }
        return AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString) == .success
    }

    public func currentValue() -> String? { LiveAXNode(element, primaryTop: primaryTop).value }

    /// A fresh read of the same element, so its URL and frame are current.
    public func refreshed() -> LiveAXNode { LiveAXNode(element, primaryTop: primaryTop) }

    public func isSameElement(as other: LiveAXNode) -> Bool { CFEqual(element, other.element) }

    /// The page finished loading (Chromium and WebKit report AXLoaded on the web area).
    public var isLoaded: Bool {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, "AXLoaded" as CFString, &raw) == .success, let raw,
            CFGetTypeID(raw) == CFBooleanGetTypeID()
        else { return true }
        return CFBooleanGetValue(unsafeDowncast(raw, to: CFBoolean.self))
    }

    /// The enclosing element (the div, section or article around this one), read fresh.
    public var parent: LiveAXNode? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXParentAttribute as CFString, &raw) == .success, let raw,
            CFGetTypeID(raw) == AXUIElementGetTypeID()
        else { return nil }
        return LiveAXNode(unsafeDowncast(raw, to: AXUIElement.self), primaryTop: primaryTop)
    }

    /// Up to `limit` enclosing elements, nearest first, stopping at the page's web area.
    public func ancestors(limit: Int = 10) -> [LiveAXNode] {
        var result: [LiveAXNode] = []
        var current = parent
        while let node = current, result.count < limit, node.role != "AXWebArea" {
            result.append(node)
            current = node.parent
        }
        return result
    }

    /// Brings the window that shows this page to the front of its app.
    public func raiseWindow() {
        var window: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXWindowAttribute as CFString, &window) == .success, let window,
            CFGetTypeID(window) == AXUIElementGetTypeID()
        else { return }
        let ref = unsafeDowncast(window, to: AXUIElement.self)
        AXUIElementPerformAction(ref, kAXRaiseAction as CFString)
        AXUIElementSetAttributeValue(ref, kAXMainAttribute as CFString, kCFBooleanTrue)
    }
}

/// The user's default browser and its frontmost page, read through Accessibility.
public enum BrowserAccessibility {
    public static func defaultBrowserURL(for page: URL) -> URL? { NSWorkspace.shared.urlForApplication(toOpen: page) }

    public static func bundleIdentifier(of application: URL) -> String? { Bundle(url: application)?.bundleIdentifier }

    /// Chromium and Electron build their web accessibility tree only when asked.
    public static func enableWebAccessibility(pid: pid_t) {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    }

    /// The web area of the browser's focused (else first) window.
    public static func webArea(pid: pid_t, primaryTop: CGFloat, focusedOnly: Bool = false,
                               where accept: (LiveAXNode) -> Bool = { $0.url != nil }) -> LiveAXNode? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var windows: [AXUIElement] = []
        var focused: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
            let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
            windows.append(unsafeDowncast(focused, to: AXUIElement.self))
        }
        var all: CFTypeRef?
        if focusedOnly == false, AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &all) == .success,
            let list = all as? [AXUIElement] {
            windows += list
        }
        for window in windows {
            if let area = BrowserPageReader.webArea(in: [LiveAXNode(window, primaryTop: primaryTop)], where: accept) { return area }
        }
        return nil
    }

    /// Every web area in the app's windows (pages already open before Lotse opens one).
    public static func webAreas(pid: pid_t, primaryTop: CGFloat) -> [LiveAXNode] {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var all: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &all) == .success,
            let windows = all as? [AXUIElement]
        else { return [] }
        var found: [LiveAXNode] = []
        for window in windows {
            var queue = [LiveAXNode(window, primaryTop: primaryTop)]
            var index = 0
            while index < queue.count && index < BrowserPageReader.webAreaSearchNodes {
                let node = queue[index]
                index += 1
                if node.role == "AXWebArea" { found.append(node) } else { queue += node.children }
            }
        }
        return found
    }

    /// One small scroll-wheel step (pixels, positive scrolls the page down) at a point given in
    /// AppKit global coordinates. Posted to the session, so the mouse pointer itself never moves;
    /// the browser scrolls the page under that point, smoothly like a trackpad.
    public static func scrollWheel(pixels: Int32, at point: CGPoint, primaryTop: CGFloat) {
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -pixels, wheel2: 0,
            wheel3: 0)
        else { return }
        event.location = CGPoint(x: point.x, y: primaryTop - point.y)
        event.post(tap: .cgSessionEventTap)
    }

    /// Types text with Unicode key events at a readable pace. Never sends Return or Enter.
    public static func type(_ text: String, paceMilliseconds: Int) async throws {
        let source = CGEventSource(stateID: .combinedSessionState)
        for character in text {
            try Task.checkCancellation()
            if character == "\n" || character == "\r" { continue }
            let units = Array(String(character).utf16)
            for keyDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(kVK_Space), keyDown: keyDown) else {
                    throw BrowserAccessibilityError.typingUnavailable
                }
                event.flags = []
                event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                event.post(tap: .cghidEventTap)
            }
            try await Task.sleep(for: .milliseconds(paceMilliseconds))
        }
    }
}

public enum BrowserAccessibilityError: Error { case typingUnavailable }
