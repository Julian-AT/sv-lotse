import AppKit
import ApplicationServices
import Carbon.HIToolbox

/// A live accessibility element; all attributes of a node are fetched in one round trip.
public final class LiveAXNode: BrowserAXNode, @unchecked Sendable {
    public let element: AXUIElement
    private let primaryTop: CGFloat
    private lazy var values: [String: CFTypeRef] = {
        let names = [kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
            kAXPlaceholderValueAttribute, kAXValueAttribute, kAXURLAttribute, kAXPositionAttribute, kAXSizeAttribute]
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
    public static func webArea(pid: pid_t, primaryTop: CGFloat) -> LiveAXNode? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 0.25)
        var windows: [AXUIElement] = []
        var focused: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute as CFString, &focused) == .success,
            let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
            windows.append(unsafeDowncast(focused, to: AXUIElement.self))
        }
        var all: CFTypeRef?
        if AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &all) == .success, let list = all as? [AXUIElement] {
            windows += list
        }
        for window in windows {
            if let area = BrowserPageReader.webArea(in: [LiveAXNode(window, primaryTop: primaryTop)]) { return area }
        }
        return nil
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
