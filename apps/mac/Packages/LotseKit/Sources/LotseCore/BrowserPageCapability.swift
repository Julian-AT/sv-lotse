import AppKit
import ApplicationServices
import LotseGuidedWindow
import LotseProtocol
import LotseResolver
import os

/// Where allowlisted portal pages open: the user's default browser (default) or the in-app guided window.
public enum PortalPageMode: String, Sendable {
    case browser, guided
    public static let defaultsKey = "LotsePortalPagesIn"
    public static var current: PortalPageMode {
        PortalPageMode(rawValue: UserDefaults.standard.string(forKey: defaultsKey) ?? "") ?? .browser
    }
}

/// Opens allowlisted portal pages in the user's default browser and makes the overlay cursor
/// work there through Accessibility: reading the page, pointing, highlighting and approved typing.
/// Never submits, never clicks, never reads or fills password fields or login pages.
@MainActor
public final class BrowserPageCapability {
    struct ActivePage {
        let bundleID: String
        let pid: pid_t
        let url: URL
    }

    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "browser")
    private(set) var active: ActivePage?
    /// Handle labels from the last read, so a handle still resolves after the page re-rendered.
    private var labels: [String: String] = [:]
    var readyTimeout: Duration = .seconds(10)
    var policy: GuidedOriginPolicy? = try? GuidedWindowResources.originPolicy()
    /// Milliseconds between typed characters: readable, like the guided window.
    static let typingPace = 60

    public init() {}

    private static var primaryTop: CGFloat { NSScreen.screens.first?.frame.maxY ?? 0 }

    /// The URL is https, allowlisted and not a login page.
    func allows(_ address: String) -> Bool {
        policy?.allows(address) == true && BrowserPageSafety.isLoginPage(address) == false
    }

    // MARK: Routing

    /// `ui.openResource` for a portal page while the default-browser mode is on.
    func claimsOpen(_ action: Action) -> Bool {
        guard PortalPageMode.current == .browser, case .openResource(let open) = action, case .dom = open.target else { return false }
        return true
    }

    /// Display actions on the page opened in the browser.
    func claimsDisplay(_ target: Target) -> Bool {
        guard let active, isRunning(active) else { return false }
        switch target {
        case .dom(let dom): return Self.sameOrigin(dom.url, active.url.absoluteString)
        case .text(let text): return text.documentID == nil
        default: return false
        }
    }

    /// `ui.fill` for a field on the page opened in the browser.
    func claimsFill(_ invocation: ToolInvocation) -> Bool {
        guard invocation.toolName == .uiFill, let active, isRunning(active),
            case .unionMap(let target)? = invocation.input["target"], target["kind"] == .string("dom"),
            case .string(let url)? = target["url"]
        else { return false }
        return Self.sameOrigin(url, active.url.absoluteString)
    }

    nonisolated static func sameOrigin(_ left: String, _ right: String) -> Bool {
        guard let lhs = URL(string: left), let rhs = URL(string: right),
            let hostA = lhs.host?.lowercased(), let hostB = rhs.host?.lowercased()
        else { return false }
        return lhs.scheme == rhs.scheme && hostA == hostB && lhs.port == rhs.port
    }

    private func isRunning(_ page: ActivePage) -> Bool {
        NSRunningApplication(processIdentifier: page.pid)?.isTerminated == false
    }

    // MARK: Open

    func open(_ action: Action) async -> ActionResult {
        guard case .openResource(let open) = action, case .dom(let dom) = open.target else {
            return Self.result(GuidedPortalCapability.destination(action)?.0 ?? "", false, "RESOURCE_UNSUPPORTED")
        }
        guard allows(dom.url), let url = URL(string: dom.url) else {
            log.error("browser open refused: origin not allowed")
            return Self.result(open.id, false, "origin-not-allowed")
        }
        guard let browser = BrowserAccessibility.defaultBrowserURL(for: url),
            let bundleID = BrowserAccessibility.bundleIdentifier(of: browser)
        else { return Self.result(open.id, false, "BROWSER_UNAVAILABLE") }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        let application: NSRunningApplication
        do {
            application = try await NSWorkspace.shared.open([url], withApplicationAt: browser, configuration: configuration)
        } catch {
            log.error("browser open failed: \(error.localizedDescription, privacy: .public)")
            return Self.result(open.id, false, "BROWSER_UNAVAILABLE")
        }
        let pid = application.processIdentifier
        active = ActivePage(bundleID: bundleID, pid: pid, url: url)
        log.info("browser opened \(bundleID, privacy: .public) for \(url.host ?? "", privacy: .public)")
        guard AXIsProcessTrusted() else {
            // Opened, but the page cannot be watched without Accessibility.
            try? await Task.sleep(for: .seconds(2))
            return ActionResult(actionID: open.id, confidence: 0.5, failureReason: nil, resolvedBy: .ui, success: true)
        }
        let requested = url.absoluteString
        let top = Self.primaryTop
        let ready = await Self.awaitReady(timeout: readyTimeout) {
            await Task.detached { () -> String? in
                BrowserAccessibility.enableWebAccessibility(pid: pid)
                guard let area = BrowserAccessibility.webArea(pid: pid, primaryTop: top, where: {
                    $0.url.map { Self.sameOrigin($0, requested) } ?? false
                }) else { return nil }
                return Self.pageReady(url: area.url, childCount: area.children.count, requested: requested) ? area.url : nil
            }.value
        }
        if let ready {
            if let readyURL = URL(string: ready) { active = ActivePage(bundleID: bundleID, pid: pid, url: readyURL) }
            log.info("browser page ready via AX: \(URL(string: ready)?.path ?? "", privacy: .public)")
            return ActionResult(actionID: open.id, confidence: 1, failureReason: nil, resolvedBy: .ax, success: true)
        }
        log.error("browser page not confirmed via AX within timeout")
        return Self.result(open.id, false, "load-timeout")
    }

    /// A loaded page: the web area shows the requested origin and has content.
    nonisolated static func pageReady(url: String?, childCount: Int, requested: String) -> Bool {
        guard let url, childCount > 0 else { return false }
        return sameOrigin(url, requested)
    }

    /// Polls the probe until it returns a value or the timeout passed.
    static func awaitReady(timeout: Duration, interval: Duration = .milliseconds(250),
                           probe: () async -> String?) async -> String? {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            if let value = await probe() { return value }
            try? await Task.sleep(for: interval)
        }
        return nil
    }

    // MARK: Read

    /// The allowlisted page in the browser, when it was opened by Lotse or the browser is frontmost.
    public func snapshot() async -> Page? {
        guard AXIsProcessTrusted(), let (pid, _) = currentBrowser() else { return nil }
        let policy = policy
        let top = Self.primaryTop
        let page = await Task.detached { () -> Page? in
            BrowserAccessibility.enableWebAccessibility(pid: pid)
            guard let area = BrowserAccessibility.webArea(pid: pid, primaryTop: top, where: { $0.url.map { policy?.allows($0) == true } ?? false }),
                let url = area.url,
                policy?.allows(url) == true, BrowserPageSafety.isLoginPage(url) == false, let pageFrame = area.frame
            else { return nil }
            return Self.page(url: url, area: area, frame: pageFrame)
        }.value
        if let page {
            labels = Dictionary(page.handles.map { ($0.id, $0.label) }, uniquingKeysWith: { first, _ in first })
            log.info("browser page read via AX: \(page.handles.count) handles")
        }
        return page
    }

    nonisolated static func page<Node: BrowserAXNode>(url: String, area: Node, frame: CGRect) -> Page {
        let title = BrowserPageReader.clean(area.title) ?? ""
        var handles = [Handle(bbox: BoundingBox(height: 1, width: 1, x: 0, y: 0), id: "page", label: title, role: "document", value: "")]
        for element in BrowserPageReader.elements(in: area).prefix(120) {
            guard let box = BrowserPageReader.boundingBox(element.frame, in: frame) else { continue }
            handles.append(Handle(bbox: BoundingBox(height: box.height, width: box.width, x: box.minX, y: box.minY),
                id: element.id, label: element.label, role: element.role, value: element.value))
        }
        return Page(handles: handles, url: url)
    }

    /// The browser to read: the page Lotse opened, else the frontmost app when it is the default browser.
    private func currentBrowser() -> (pid_t, String)? {
        if let active, isRunning(active) { return (active.pid, active.bundleID) }
        guard let front = NSWorkspace.shared.frontmostApplication, let bundleID = front.bundleIdentifier,
            let probe = URL(string: "https://example.org"), let browser = BrowserAccessibility.defaultBrowserURL(for: probe),
            BrowserAccessibility.bundleIdentifier(of: browser) == bundleID
        else { return nil }
        return (front.processIdentifier, bundleID)
    }

    // MARK: Point

    /// Re-resolves a target on the browser page right before an action, scrolling it into view.
    /// Returns nil when the target is not on the browser page (callers fall back to OCR).
    public func resolve(_ target: Target) async throws -> ResolvedTarget? {
        guard claimsDisplay(target), AXIsProcessTrusted(), let active else { return nil }
        let pid = active.pid
        let policy = policy
        let top = Self.primaryTop
        let known = labels
        let (rect, reason) = await Task.detached { () -> (CGRect?, String) in
            guard let area = BrowserAccessibility.webArea(pid: pid, primaryTop: top, where: { $0.url.map { policy?.allows($0) == true } ?? false }),
                let url = area.url, BrowserPageSafety.isLoginPage(url) == false, let pageFrame = area.frame
            else { return (nil, "no allowlisted page") }
            let node: LiveAXNode
            switch target {
            case .dom(let dom):
                if dom.handle == "page" { return (CGRect(x: pageFrame.midX - 40, y: pageFrame.maxY - 120, width: 80, height: 80), "") }
                let elements = BrowserPageReader.elements(in: area)
                if let element = BrowserPageReader.element(handle: dom.handle, label: known[dom.handle], in: elements) {
                    node = element.node
                } else if let label = known[dom.handle], let match = BrowserPageReader.textMatch(label, in: area) {
                    node = match.0
                } else { return (nil, "handle not found among \(elements.count)") }
            case .text(let text):
                guard let match = BrowserPageReader.textMatch(text.quote, in: area) else { return (nil, "quote not found") }
                node = match.0
            default: return (nil, "unsupported")
            }
            guard let rect = Self.scrolledIntoView(node, page: pageFrame) else { return (nil, "off screen") }
            return (rect, "")
        }.value
        guard let rect else {
            log.info("browser target not resolved via AX: \(reason, privacy: .public)")
            return nil
        }
        NSRunningApplication(processIdentifier: pid)?.activate()
        log.info("browser target resolved via AX to rect \(Int(rect.minX)),\(Int(rect.minY)) \(Int(rect.width))x\(Int(rect.height))")
        return ResolvedTarget(rect: rect, method: .ax, confidence: 1)
    }

    /// The element's current rect; scrolls it into view first when it lies outside the page area.
    nonisolated static func scrolledIntoView(_ node: LiveAXNode, page: CGRect) -> CGRect? {
        guard let frame = node.frame else { return nil }
        if page.contains(CGPoint(x: frame.midX, y: frame.midY)) { return frame }
        node.perform("AXScrollToVisible")
        Thread.sleep(forTimeInterval: 0.35)
        guard let moved = node.refreshedFrame(), page.intersects(moved) else { return nil }
        return moved
    }

    // MARK: Fill

    /// Types an approved value into a field on the browser page. The approval is verified exactly
    /// like the guided window path; nothing is typed without it. Never presses Return.
    func fill(_ invocation: ToolInvocation, approvals: GuidedFillApprovals,
              moveCursor: @escaping @MainActor (CGRect, String) -> Void) async -> ToolOutput {
        let id = invocation.toolCallID
        let outcome: ActionResult
        do {
            let approved = try approvals.consume(invocation)
            outcome = try await type(approved, id: id, moveCursor: moveCursor)
        } catch GuidedFillError.approvalRequired {
            outcome = Self.result(id, false, "APPROVAL_REQUIRED")
        } catch let error as BrowserFillError {
            outcome = Self.result(id, false, error.rawValue)
        } catch {
            outcome = Self.result(id, false, "browser-fill-failed")
        }
        log.info("browser fill \(outcome.success ? "succeeded" : "failed", privacy: .public) \(outcome.failureReason ?? "", privacy: .public)")
        return ToolOutput(error: nil, output: .actionResult(outcome), toolCallID: id)
    }

    private func type(_ approved: GuidedApprovedFill, id: String,
                      moveCursor: @escaping @MainActor (CGRect, String) -> Void) async throws -> ActionResult {
        guard case .type(let typed) = approved.action, case .dom(let dom) = typed.target, let active else {
            throw BrowserFillError.invalid
        }
        guard AXIsProcessTrusted() else { throw BrowserFillError.accessibility }
        let pid = active.pid
        let policy = policy
        let top = Self.primaryTop
        let label = labels[dom.handle]
        let field = await Task.detached { () -> (LiveAXNode, CGRect)? in
            guard let area = BrowserAccessibility.webArea(pid: pid, primaryTop: top, where: { $0.url.map { policy?.allows($0) == true } ?? false }),
                let url = area.url,
                policy?.allows(url) == true, BrowserPageSafety.isLoginPage(url) == false, let pageFrame = area.frame,
                let element = BrowserPageReader.element(handle: dom.handle, label: label, in: BrowserPageReader.elements(in: area)),
                BrowserPageSafety.isFillable(role: element.role), BrowserPageReader.isSecure(element.node) == false,
                let rect = Self.scrolledIntoView(element.node, page: pageFrame)
            else { return nil }
            return (element.node, rect)
        }.value
        guard let (node, rect) = field else { throw BrowserFillError.fieldUnavailable }
        NSRunningApplication(processIdentifier: pid)?.activate()
        moveCursor(rect, typed.payload.value)
        try await Task.sleep(for: .milliseconds(450))
        let value = typed.payload.value.replacingOccurrences(of: "\n", with: " ").replacingOccurrences(of: "\r", with: " ")
        let focused = await Task.detached { node.focus() }.value
        try await Task.sleep(for: .milliseconds(150))
        var typedVisibly = false
        if focused, NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
            do {
                try await BrowserAccessibility.type(value, paceMilliseconds: Self.typingPace)
                typedVisibly = true
            } catch is CancellationError { throw CancellationError() } catch {}
        }
        try await Task.sleep(for: .milliseconds(200))
        var current = await Task.detached { node.currentValue() }.value ?? ""
        if current.contains(value) == false {
            if typedVisibly == false || current.isEmpty {
                _ = await Task.detached { node.setValue(value) }.value
                current = await Task.detached { node.currentValue() }.value ?? ""
            }
        }
        guard current.contains(value) else { throw BrowserFillError.valueNotSet }
        return ActionResult(actionID: id, confidence: 1, failureReason: nil, resolvedBy: .ax, success: true)
    }

    func stop() { active = nil }

    nonisolated static func result(_ id: String, _ success: Bool, _ reason: String? = nil) -> ActionResult {
        ActionResult(actionID: id, confidence: success ? 1 : 0, failureReason: reason, resolvedBy: .ax, success: success)
    }
}

enum BrowserFillError: String, Error {
    case invalid = "INVALID_TOOL_INPUT", accessibility = "ACCESSIBILITY_REQUIRED",
        fieldUnavailable = "target_unavailable", valueNotSet = "value-not-set"
}
