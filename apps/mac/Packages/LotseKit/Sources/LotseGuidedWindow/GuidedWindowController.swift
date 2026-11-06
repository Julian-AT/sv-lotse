import AppKit
import LotseImport
import LotseProtocol
import WebKit

@MainActor
public final class GuidedWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    public let webView: WKWebView
    public let originPolicy: GuidedOriginPolicy
    public let downloads: GuidedDownloadHandler
    public private(set) var isReady = false
    public private(set) var loadFailed = false
    private let copy: GuidedWindowCopy
    private var navigationID = UUID()
    private var currentNavigation: WKNavigation?
    private var loadedURL: URL?
    private var executing = false

    public init(originPolicy: GuidedOriginPolicy, queue: EncryptedUploadQueue, language: String = "de-AT") throws {
        self.originPolicy = originPolicy
        downloads = GuidedDownloadHandler(queue: queue, policy: originPolicy)
        copy = language.hasPrefix("en") ? .english : .german
        webView = WKWebView(frame: .zero, configuration: GuidedWindowConfiguration.make(
            guideSource: try GuidedWindowResources.guideSource()
        ))
        let window = NSWindow(
            contentRect: CGRect(origin: .zero, size: GuidedWindowConfiguration.initialSize),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
        )
        window.title = copy.title
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.center()
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        downloads.onFailure = { [weak self] in self?.showDownloadError() }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    public func open(_ url: URL) throws {
        guard originPolicy.allows(url.absoluteString) else { throw GuidedOriginError.invalidOrigin }
        invalidate()
        currentNavigation = webView.load(URLRequest(url: url))
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    public func snapshot() async throws -> Page {
        let result = try await call("return JSON.stringify(__lotseGuide.toCapsulePage(window.__lotsePortal.snapshot()));")
        return try decode(Page.self, result)
    }

    /// Pointing, highlighting and captions only. Typing and clearing enter exclusively through
    /// `fill(_:)` with a server-verified `ui.fill` approval; no page or bridge flag can bypass it.
    public func execute(_ actions: [Action]) async throws -> [ActionResult] {
        guard executing == false else { throw GuidedWindowError.busy }
        guard actions.isEmpty == false else { return [] }
        try actions.forEach { try $0.validate() }
        for action in actions {
            switch action {
            case .openResource: throw GuidedWindowError.unsupportedAction
            case .type, .clear: throw GuidedWindowError.approvalRequired
            default: continue
            }
        }
        return try await run(actions, navigation: navigationID)
    }

    /// Types one value whose exact input the server approved and verified before it was forwarded.
    public func fill(_ approved: GuidedApprovedFill) async throws -> ActionResult {
        guard executing == false else { throw GuidedWindowError.busy }
        try approved.action.validate()
        let expectedNavigation = navigationID
        let page = try await snapshot()
        // The approved target must still be a labelled field on the current portal page.
        _ = try change(approved.action, page: page)
        let results = try await run([approved.action], navigation: expectedNavigation)
        guard let result = results.first else { throw GuidedWindowError.invalidResult }
        return result
    }

    private func run(_ actions: [Action], navigation expectedNavigation: UUID) async throws -> [ActionResult] {
        try requireReady(expectedNavigation)
        executing = true
        defer {
            executing = false
            if Task.isCancelled { cancelRuntime() }
        }
        var results: [ActionResult] = []
        for action in actions {
            try Task.checkCancellation()
            try requireReady(expectedNavigation)
            let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(action))
            let result = try await call(
                "return JSON.stringify(await window.__lotsePortal.execute(action));", arguments: ["action": encoded]
            )
            let decoded: ActionResult = try decode(ActionResult.self, result)
            results.append(decoded)
            if decoded.success == false { break }
        }
        return results
    }

    public func clearOverlays() async throws {
        _ = try await call("window.__lotsePortal.clear(); return true;")
    }

    private func call(_ body: String, arguments: [String: Any] = [:]) async throws -> Any? {
        let expectedNavigation = navigationID
        try requireReady(expectedNavigation)
        var parameters = arguments
        parameters["origins"] = originPolicy.origins.sorted()
        let result = try await webView.callAsyncJavaScript(
            """
            if (!window.__lotsePortal) {
                window.__lotsePortal = __lotseGuide.createGuide({ allowlist: origins });
            }
            \(body)
            """,
            arguments: parameters, in: nil, contentWorld: GuidedWindowConfiguration.contentWorld
        )
        try Task.checkCancellation()
        try requireReady(expectedNavigation)
        return result
    }

    private func decode<Value: Decodable & ProtocolValidating>(_ type: Value.Type, _ result: Any?) throws -> Value {
        guard let json = result as? String else { throw GuidedWindowError.invalidResult }
        do { return try decodeValidated(Data(json.utf8)) } catch { throw GuidedWindowError.invalidResult }
    }

    private func requireReady(_ expectedNavigation: UUID) throws {
        guard expectedNavigation == navigationID else { throw GuidedWindowError.navigationChanged }
        guard isReady, let url = webView.url, originPolicy.allows(url.absoluteString) else { throw GuidedWindowError.notReady }
    }

    private func showDownloadError() {
        guard let window, window.isVisible, window.attachedSheet == nil else { return }
        let alert = NSAlert()
        alert.messageText = copy.downloadError
        alert.informativeText = copy.downloadErrorHint
        alert.beginSheetModal(for: window)
    }

    private func change(_ action: Action, page: Page) throws -> String? {
        let target: Target
        let value: String
        switch action {
        case .type(let instruction): target = instruction.target; value = instruction.payload.value
        default: return nil
        }
        guard case .dom(let field) = target, field.url == page.url,
            let handle = page.handles.first(where: { $0.id == field.handle }), handle.label.isEmpty == false
        else { throw GuidedWindowError.unsupportedAction }
        return "\(handle.label): \(value)"
    }

    private func invalidate() {
        if isReady { cancelRuntime() }
        navigationID = UUID()
        currentNavigation = nil
        isReady = false
        loadFailed = false
    }

    private func cancelRuntime() {
        webView.callAsyncJavaScript(
            "window.__lotsePortal?.clear(); return true;", arguments: [:], in: nil,
            in: GuidedWindowConfiguration.contentWorld, completionHandler: { _ in }
        )
    }

    public func windowWillClose(_ notification: Notification) {
        invalidate()
        loadedURL = nil
        webView.stopLoading()
        downloads.cancelAll()
    }

    public func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        if action.shouldPerformDownload {
            guard originPolicy.allowsDownload(url.absoluteString),
                webView.url.map({ originPolicy.allows($0.absoluteString) }) == true
            else { return .cancel }
            return .download
        }
        guard originPolicy.allows(url.absoluteString) else { return .cancel }
        if action.targetFrame == nil {
            webView.load(action.request)
            return .cancel
        }
        return .allow
    }

    public func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse) async -> WKNavigationResponsePolicy {
        guard let url = response.response.url, originPolicy.allowsDownload(url.absoluteString) else { return .cancel }
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
        if response.canShowMIMEType == false || disposition?.lowercased().hasPrefix("attachment") == true { return .download }
        return originPolicy.allows(url.absoluteString) ? .allow : .cancel
    }

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        invalidate()
        currentNavigation = navigation
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        guard navigation === currentNavigation, let url = webView.url, originPolicy.allows(url.absoluteString) else { return }
        loadedURL = url
        isReady = true
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        fail(navigation)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        fail(navigation)
    }

    private func fail(_ navigation: WKNavigation?) {
        guard navigation === currentNavigation else { return }
        invalidate()
        loadFailed = true
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { invalidate(); loadFailed = true }

    public func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        downloads.track(download)
    }

    public func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        downloads.track(download)
        // A main-frame download conversion leaves the preceding document loaded.
        if navigationResponse.isForMainFrame, let loadedURL, webView.url == loadedURL {
            currentNavigation = nil
            isReady = true
            loadFailed = false
        }
    }
}
