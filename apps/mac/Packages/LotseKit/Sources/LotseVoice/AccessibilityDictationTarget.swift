import AppKit
import ApplicationServices

@MainActor
struct AccessibilityDictationTarget: DictationTextTarget {
    private let element: AXUIElement
    private let processID: pid_t
    private let selection: CFTypeRef?

    static func capture() throws -> Self {
        guard AXIsProcessTrusted() else { throw DictationInsertionError.accessibilityRequired }
        guard let element = focusedElement() else { throw DictationInsertionError.noEditableField }
        guard stringAttribute(element, kAXSubroleAttribute) != kAXSecureTextFieldSubrole else {
            throw DictationInsertionError.secureField
        }
        var settable = DarwinBoolean(false)
        AXUIElementIsAttributeSettable(element, kAXSelectedTextAttribute as CFString, &settable)
        let role = stringAttribute(element, kAXRoleAttribute)
        let selection = attribute(element, kAXSelectedTextRangeAttribute)
        let textRole = role == kAXTextFieldRole || role == kAXTextAreaRole || role == kAXComboBoxRole
        guard settable.boolValue || textRole || selection != nil,
            attribute(element, kAXEnabledAttribute) as? Bool != false
        else { throw DictationInsertionError.noEditableField }
        var processID: pid_t = 0
        guard AXUIElementGetPid(element, &processID) == .success else { throw DictationInsertionError.noEditableField }
        return Self(element: element, processID: processID, selection: selection)
    }

    func insert(_ text: String) async throws {
        try Task.checkCancellation()
        try validateFocus()
        if AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, text as CFString) == .success {
            return
        }
        try await RestoringPasteboard(pasteboard: .general).insert(text, validate: validateFocus, sendPaste: sendPaste)
    }

    private func validateFocus() throws {
        guard AXIsProcessTrusted(), NSWorkspace.shared.frontmostApplication?.processIdentifier == processID,
            let focused = Self.focusedElement(), CFEqual(focused, element)
        else { throw DictationInsertionError.focusChanged }
        if let selection {
            guard let current = Self.attribute(element, kAXSelectedTextRangeAttribute), CFEqual(selection, current) else {
                throw DictationInsertionError.focusChanged
            }
        }
        guard Self.stringAttribute(element, kAXSubroleAttribute) != kAXSecureTextFieldSubrole else {
            throw DictationInsertionError.secureField
        }
    }

    private func sendPaste() throws {
        guard let down = CGEvent(keyboardEventSource: nil, virtualKey: VoiceConfiguration.pasteKeyCode, keyDown: true),
            let up = CGEvent(keyboardEventSource: nil, virtualKey: VoiceConfiguration.pasteKeyCode, keyDown: false)
        else { throw DictationInsertionError.pasteUnavailable }
        down.flags = .maskCommand
        up.flags = .maskCommand
        // Address the captured process rather than whichever application becomes frontmost next.
        down.postToPid(processID)
        up.postToPid(processID)
    }

    private static func focusedElement() -> AXUIElement? {
        guard let value = attribute(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute),
            CFGetTypeID(value) == AXUIElementGetTypeID()
        else { return nil }
        // AX returns a CFTypeRef; its runtime type has been checked above before bridging the handle.
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
        return value
    }

    private static func stringAttribute(_ element: AXUIElement, _ name: String) -> String? {
        attribute(element, name) as? String
    }
}
