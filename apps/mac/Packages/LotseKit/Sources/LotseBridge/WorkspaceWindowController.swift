import AppKit
import LotseProtocol
import WebKit

@MainActor
public final class WorkspaceWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate {
    public let webView: WKWebView
    public let configuration: WorkspaceConfiguration
    public var onMessage: ((BridgeToNative) throws -> Void)? {
        didSet { messageHandler.receive = onMessage }
    }
    public private(set) var isReady = false
    public private(set) var loadError: Error?
    private let messageHandler: WorkspaceMessageHandler
    private let hello: BridgeHello
    private var documentReady = false
    private var navigationID = UUID()
    private var currentNavigation: WKNavigation?
    private var helloTask: Task<Void, Never>?
    private let receiverTimeout: Duration

    public init(configuration: WorkspaceConfiguration, hello: BridgeHello, receiverTimeout: Duration = .seconds(5)) {
        self.configuration = configuration
        self.hello = hello
        self.receiverTimeout = receiverTimeout
        messageHandler = WorkspaceMessageHandler(origin: configuration.origin)
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = WKWebsiteDataStore(forIdentifier: configuration.dataStoreIdentifier)
        webConfiguration.preferences.inactiveSchedulingPolicy = .none
        webConfiguration.userContentController.addScriptMessageHandler(messageHandler, contentWorld: .page, name: "lotse")
        webView = WKWebView(frame: .zero, configuration: webConfiguration)
        let window = WorkspaceWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 760),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false
        )
        window.title = "SV KI-Lotse"
        window.isReleasedWhenClosed = false
        window.contentView = webView
        window.center()
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    public func load() {
        resetNavigation()
        currentNavigation = webView.load(URLRequest(url: configuration.url))
    }

    public func showWorkspace() {
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    public func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    public func send(_ message: BridgeToWorkspace) async throws {
        guard isReady else { throw WorkspaceError.notReady }
        try await deliver(message, navigationID: navigationID)
    }

    private func deliver(_ message: BridgeToWorkspace, navigationID: UUID) async throws {
        try Task.checkCancellation()
        guard self.navigationID == navigationID, documentReady, let url = webView.url,
            try WorkspaceOrigin(url: url) == configuration.origin
        else { throw WorkspaceError.notReady }
        let data = try JSONEncoder().encode(message)
        let object = try JSONSerialization.jsonObject(with: data)
        // Arguments cross the WebKit serialization boundary; never interpolate content into JavaScript.
        _ = try await webView.callAsyncJavaScript(
            "return await window.__lotse.receive(message)", arguments: ["message": object], in: nil, contentWorld: .page
        )
        try Task.checkCancellation()
        guard self.navigationID == navigationID else { throw WorkspaceError.notReady }
    }

    public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard navigationAction.targetFrame?.isMainFrame == true else {
            return navigationAction.targetFrame == nil ? .cancel : .allow
        }
        guard let url = navigationAction.request.url,
            let origin = try? WorkspaceOrigin(url: url), origin == configuration.origin
        else { return .cancel }
        return .allow
    }

    public func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        resetNavigation()
        currentNavigation = navigation
    }

    public func webView(
        _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse
    ) async -> WKNavigationResponsePolicy {
        guard navigationResponse.isForMainFrame else { return .allow }
        guard let url = navigationResponse.response.url,
            let origin = try? WorkspaceOrigin(url: url), origin == configuration.origin
        else { return .cancel }
        return .allow
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        guard navigation === currentNavigation,
            let url = webView.url, let origin = try? WorkspaceOrigin(url: url), origin == configuration.origin
        else { return }
        documentReady = true
        let navigationID = navigationID
        helloTask?.cancel()
        helloTask = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await waitForReceiver(navigationID: navigationID)
                try await deliver(
                    .bridgeHello(.init(id: UUID().uuidString, payload: hello, type: .bridgeHello, v: .the100)),
                    navigationID: navigationID
                )
                isReady = true
            } catch {
                guard Task.isCancelled == false, self.navigationID == navigationID else { return }
                loadError = error
            }
        }
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        guard navigation === currentNavigation else { return }
        resetNavigation()
        loadError = error
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        guard navigation === currentNavigation else { return }
        resetNavigation()
        loadError = error
    }

    private func resetNavigation() {
        helloTask?.cancel()
        helloTask = nil
        navigationID = UUID()
        currentNavigation = nil
        isReady = false
        documentReady = false
        loadError = nil
    }

    private func waitForReceiver(navigationID: UUID) async throws {
        let deadline = ContinuousClock.now.advanced(by: receiverTimeout)
        while ContinuousClock.now < deadline {
            try Task.checkCancellation()
            guard self.navigationID == navigationID, documentReady else { throw WorkspaceError.notReady }
            let ready = try await webView.callAsyncJavaScript(
                "return typeof window.__lotse?.receive === 'function'", arguments: [:], in: nil, contentWorld: .page
            )
            try Task.checkCancellation()
            guard self.navigationID == navigationID else { throw WorkspaceError.notReady }
            if ready as? Bool == true { return }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw WorkspaceError.notReady
    }

    public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        resetNavigation()
        webView.reload()
    }
}

@MainActor
private final class WorkspaceWindow: NSWindow {
    override func close() { orderOut(nil) }
}
