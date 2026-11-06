import CoreGraphics
import Foundation

/// One node of an accessibility tree. The live implementation wraps `AXUIElement`; tests use a fake tree.
public protocol BrowserAXNode {
    var role: String? { get }
    var subrole: String? { get }
    var title: String? { get }
    var nodeDescription: String? { get }
    var placeholder: String? { get }
    var value: String? { get }
    var url: String? { get }
    /// AppKit global coordinates (bottom-left origin).
    var frame: CGRect? { get }
    var children: [Self] { get }
}

/// A labelled element of a browser page with its screen rectangle.
public struct BrowserPageElement<Node: BrowserAXNode> {
    public let role: String
    public let label: String
    public let value: String
    public let frame: CGRect
    public let node: Node
    public let id: String
}

/// Reads an allowlisted page in the user's browser through Accessibility. Never reads password
/// fields; callers refuse login pages before reading anything.
public enum BrowserPageReader {
    public static let maximumNodes = 4000
    public static let webAreaSearchNodes = 2500

    /// Accessibility roles mapped to the web roles the brain sees in page handles.
    public static let roles: [String: String] = [
        "AXHeading": "heading", "AXTextField": "textbox", "AXTextArea": "textbox", "AXComboBox": "combobox",
        "AXCheckBox": "checkbox", "AXRadioButton": "radio", "AXPopUpButton": "combobox",
        "AXButton": "button", "AXLink": "link", "AXSearchField": "searchbox"
    ]

    /// The first web content area below the given roots (breadth first).
    public static func webArea<Node: BrowserAXNode>(in roots: [Node]) -> Node? {
        var queue = roots
        var index = 0
        while index < queue.count && index < webAreaSearchNodes {
            let node = queue[index]
            index += 1
            if node.role == "AXWebArea" { return node }
            queue += node.children
        }
        return nil
    }

    public static func isSecure<Node: BrowserAXNode>(_ node: Node) -> Bool {
        node.role == "AXSecureTextField" || node.subrole == "AXSecureTextField"
    }

    /// Title, description or placeholder; for headings, buttons and links their visible text.
    public static func label<Node: BrowserAXNode>(_ node: Node) -> String {
        for candidate in [node.title, node.nodeDescription, node.placeholder] {
            if let text = clean(candidate), text.isEmpty == false { return text }
        }
        guard ["AXHeading", "AXButton", "AXLink", "AXCheckBox", "AXRadioButton"].contains(node.role ?? "") else { return "" }
        return clean(visibleText(node, depth: 3)) ?? ""
    }

    private static func visibleText<Node: BrowserAXNode>(_ node: Node, depth: Int) -> String {
        if node.role == "AXStaticText" { return node.value ?? node.title ?? "" }
        guard depth > 0 else { return "" }
        return node.children.map { visibleText($0, depth: depth - 1) }.filter { $0.isEmpty == false }.joined(separator: " ")
    }

    public static func clean(_ text: String?) -> String? {
        guard let text else { return nil }
        let joined = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        return String(joined.prefix(160))
    }

    /// Stable handle id per role, label and occurrence, so a later point re-resolves the same element.
    public static func handleID(role: String, label: String, occurrence: Int) -> String {
        var hash: UInt64 = 0xcbf29ce484222325
        for byte in "\(role)\u{1}\(label.lowercased())".utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100000001b3
        }
        return "ax-" + String(hash, radix: 36) + (occurrence > 0 ? "-\(occurrence)" : "")
    }

    /// Headings and labelled form controls, links and buttons in document order. Password fields
    /// are skipped entirely, their values are never read; text field values are reported.
    public static func elements<Node: BrowserAXNode>(in webArea: Node, limit: Int = maximumNodes) -> [BrowserPageElement<Node>] {
        var result: [BrowserPageElement<Node>] = []
        var occurrences: [String: Int] = [:]
        var visited = 0
        func visit(_ node: Node) {
            guard visited < limit else { return }
            visited += 1
            if isSecure(node) { return }
            if let role = node.role, let mapped = roles[role] {
                let text = label(node)
                if text.isEmpty == false, let frame = node.frame, frame.width > 0, frame.height > 0 {
                    let key = "\(mapped)\u{1}\(text.lowercased())"
                    let occurrence = occurrences[key, default: 0]
                    occurrences[key] = occurrence + 1
                    let value = ["textbox", "searchbox", "combobox", "checkbox", "radio"].contains(mapped)
                        ? String((node.value ?? "").prefix(200)) : ""
                    result.append(.init(role: mapped, label: text, value: value, frame: frame, node: node,
                        id: handleID(role: mapped, label: text, occurrence: occurrence)))
                }
                // Links and buttons are leaves for the page outline.
                if mapped == "link" || mapped == "button" || mapped == "heading" { return }
            }
            for child in node.children { visit(child) }
        }
        visit(webArea)
        return result
    }

    /// The element of a handle id, or a fresh one with the same role and label.
    public static func element<Node: BrowserAXNode>(handle: String, in elements: [BrowserPageElement<Node>]) -> BrowserPageElement<Node>? {
        elements.first { $0.id == handle }
    }

    /// The smallest static text (or labelled element) containing the quote, case and space insensitive.
    public static func textMatch<Node: BrowserAXNode>(_ quote: String, in webArea: Node, limit: Int = maximumNodes) -> (Node, CGRect)? {
        let wanted = (clean(quote) ?? "").lowercased()
        guard wanted.isEmpty == false else { return nil }
        var best: (Node, CGRect)?
        var visited = 0
        var queue = [webArea]
        while visited < queue.count && visited < limit {
            let node = queue[visited]
            visited += 1
            if isSecure(node) { continue }
            let text: String? = node.role == "AXStaticText" ? (node.value ?? node.title)
                : (roles[node.role ?? ""] != nil ? label(node) : nil)
            if let text, (clean(text) ?? "").lowercased().contains(wanted), let frame = node.frame, frame.width > 0, frame.height > 0 {
                if let current = best?.1, current.width * current.height <= frame.width * frame.height { continue }
                best = (node, frame)
            }
            queue += node.children
        }
        return best
    }

    /// Unit-interval box of a rect inside the page area, top-left origin; nil outside the page.
    public static func boundingBox(_ rect: CGRect, in page: CGRect) -> CGRect? {
        let visible = rect.intersection(page)
        guard visible.isNull == false, visible.width > 0, visible.height > 0, page.width > 0, page.height > 0 else { return nil }
        return CGRect(x: (visible.minX - page.minX) / page.width, y: (page.maxY - visible.maxY) / page.height,
            width: visible.width / page.width, height: visible.height / page.height)
    }
}

/// Fill and click safety for browser pages: no submit, send or buy controls, no credentials.
public enum BrowserPageSafety {
    /// Login, sign-in and identity-provider pages (from packages/knowledge/data/portal-login-pages.json).
    public static let loginPatterns = [
        "(?:^|[^\\p{L}\\p{N}])(?:log[-_]?in|log[-_]?on|sign[-_]?in|sign[-_]?on|einloggen)(?:$|[^\\p{L}\\p{N}])",
        "(?:^|[^\\p{L}\\p{N}])(?:sso|auth|authenticate|authentication|authorize|oauth2?|openid|oidc|saml2?|idp)(?:$|[^\\p{L}\\p{N}])",
        "(?:^|[^\\p{L}\\p{N}])(?:id[-_]?austria|handysignatur|b(?:ü|ue)rgerkarte|passwor[dt]|kennwort)(?:$|[^\\p{L}\\p{N}])"
    ]

    private static let deniedWords = [
        "absenden", "senden", "abschicken", "einreichen", "übermitteln", "uebermitteln", "bestätigen", "bestaetigen",
        "kaufen", "bezahlen", "zahlungspflichtig", "bestellen", "buchen", "unterschreiben", "signieren", "anmelden",
        "einloggen", "registrieren", "löschen", "submit", "send", "buy", "pay", "order", "purchase", "checkout",
        "confirm", "sign", "login", "log in", "delete", "book"
    ]

    /// Unparseable addresses count as login pages (fail closed), like the server check.
    public static func isLoginPage(_ address: String) -> Bool {
        guard let url = URL(string: address) else { return true }
        var location = url.path
        if let query = url.query { location += "?" + query }
        if let fragment = url.fragment { location += "#" + fragment }
        let decoded = location.removingPercentEncoding ?? location
        return loginPatterns.contains { pattern in
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return true }
            return regex.firstMatch(in: decoded, range: NSRange(decoded.startIndex..., in: decoded)) != nil
        }
    }

    /// Buttons and links whose label submits, sends, buys or signs in are never clicked or focused.
    public static func isDenied(role: String, label: String) -> Bool {
        guard ["button", "link", "AXButton", "AXLink", "AXMenuItem"].contains(role) else { return false }
        let text = label.lowercased()
        let words = Set(text.split(whereSeparator: { !$0.isLetter }).map(String.init))
        return deniedWords.contains { word in word.contains(" ") ? text.contains(word) : words.contains(word) }
    }

    /// Only text inputs receive typed values.
    public static func isFillable(role: String) -> Bool { ["textbox", "searchbox", "combobox"].contains(role) }
}
