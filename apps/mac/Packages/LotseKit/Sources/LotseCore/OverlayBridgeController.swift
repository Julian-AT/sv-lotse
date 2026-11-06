import AppKit
import LotseBridge
import LotseCapture
import LotseOverlay
import LotseProtocol
import LotseResolver
import WebKit

@MainActor
final class OverlayBridgeController {
    private let workspace: WorkspaceWindowController
    private let overlay: OverlayWindowManager
    private let resolver = TargetResolver()
    private var tasks: [String: Task<Void, Never>] = [:]
    private var expiry: Task<Void, Never>?
    private var generation = UUID()
    private var activeSentence: Int?
    private var prepared: [String: (NativeOverlayAction, ResolvedTarget)] = [:]
    private var completed: Set<String> = []
    private var screens: [CompanionScreenCapture] = []
    private var capturedAt = Date.distantPast
    private var captureTask: Task<[CompanionScreenCapture], Error>?
    /// Resolves targets on a page outside the workspace (the default browser) before the ladder below.
    var externalResolve: ((Target) async throws -> ResolvedTarget?)?

    init(workspace: WorkspaceWindowController, overlay: OverlayWindowManager) {
        self.workspace = workspace
        self.overlay = overlay
    }

    func receive(_ message: BridgeToNative) throws {
        switch message {
        case .targetRect(let envelope): resolver.update(envelope.payload)
        case .action(let envelope): try receive(envelope.payload)
        case .speechSegment(let envelope):
            let segment = envelope.payload
            if activeSentence != segment.index {
                overlay.state.clear()
                activeSentence = segment.index
            }
            overlay.state.caption = segment.text
            for (_, value) in prepared where value.0.sentenceIndex == segment.index { present(value.0, at: value.1) }
            scheduleExpiry()
        case .speechControl(let envelope):
            if envelope.payload.stop || envelope.payload.state == .idle { stop() } else {
                if activeSentence != envelope.payload.segmentIndex { overlay.state.clear() }
                activeSentence = envelope.payload.segmentIndex
                for (_, value) in prepared where value.0.sentenceIndex == activeSentence { present(value.0, at: value.1) }
            }
        default: throw WorkspaceError.unsupportedMessage
        }
    }

    func stop() {
        generation = UUID()
        for task in tasks.values { task.cancel() }
        tasks.removeAll()
        captureTask?.cancel()
        captureTask = nil
        expiry?.cancel()
        expiry = nil
        prepared.removeAll()
        completed.removeAll()
        screens.removeAll()
        resolver.clear()
        activeSentence = nil
        overlay.state.clear()
    }

    private func receive(_ action: Action) throws {
        if case .clear(let value) = action {
            stop()
            report(.init(actionID: value.id, confidence: 1, failureReason: nil, resolvedBy: .ui, success: true))
            return
        }
        guard let presentation = NativeOverlayAction(action) else { throw WorkspaceError.unsupportedMessage }
        guard tasks[presentation.id] == nil, completed.contains(presentation.id) == false else { return }
        if presentation.kind == .caption {
            overlay.state.caption = presentation.label ?? ""
            complete(presentation, method: .ui, confidence: 1)
            scheduleExpiry()
            return
        }
        let currentGeneration = generation
        tasks[presentation.id] = Task { @MainActor [weak self] in
            await self?.prepare(presentation, generation: currentGeneration)
        }
    }

    private func prepare(_ presentation: NativeOverlayAction, generation currentGeneration: UUID) async {
        defer { if generation == currentGeneration { tasks.removeValue(forKey: presentation.id) } }
        do {
            let location = try await resolve(presentation)
            try Task.checkCancellation()
            guard generation == currentGeneration else { return }
            if presentation.kind != .typing { prepared[presentation.id] = (presentation, location) }
            if activeSentence == presentation.sentenceIndex || presentation.kind == .typing {
                present(presentation, at: location)
            }
        } catch {
            guard Task.isCancelled == false, generation == currentGeneration else { return }
            report(.init(actionID: presentation.id, confidence: 0, failureReason: "target_unavailable",
                resolvedBy: presentation.failureMethod, success: false))
        }
    }

    private func resolve(_ action: NativeOverlayAction) async throws -> ResolvedTarget {
        switch action.target {
        case .dom, .text:
            if let external = try await externalResolve?(action.target) { return external }
        default: break
        }
        switch action.target {
        case .ui, .form, .dom:
            guard let window = workspace.webView.window, window.isVisible else { throw TargetResolutionError.unavailable }
            let viewport = window.convertToScreen(workspace.webView.convert(workspace.webView.bounds, to: nil))
            return try resolver.workspaceTarget(action.target, actionID: action.id, viewport: viewport)
        case .point(let point):
            let frames = screens.isEmpty ? sortedScreenFrames() : screens.map(\.displayFrame)
            return try TargetResolver.point(point, screens: frames)
        case .ax(let target):
            do {
                let result = try await AccessibilityTargetResolver.resolve(
                    target, primaryTop: NSScreen.screens.first?.frame.maxY ?? 0
                )
                guard NSScreen.screens.contains(where: { $0.frame.intersects(result.rect) }) else {
                    throw TargetResolutionError.unavailable
                }
                return result
            } catch TargetResolutionError.ambiguous {
                throw TargetResolutionError.ambiguous
            } catch {
                try Task.checkCancellation()
                return try await vision(action.target, captures: capture())
            }
        case .text(let text):
            if let window = workspace.webView.window, window.isVisible {
                let viewport = window.convertToScreen(workspace.webView.convert(workspace.webView.bounds, to: nil))
                if let exact = try? resolver.workspaceTarget(action.target, actionID: action.id, viewport: viewport) { return exact }
            }
            return try await resolveText(text)
        }
    }

    private func resolveText(_ text: TargetText) async throws -> ResolvedTarget {
        let captures = try await capture()
        var matches: [ResolvedTarget] = []
        for screen in captures {
            do {
                let lines = try await OCRTargetResolver.lines(in: screen.imageData)
                matches.append(try OCRTargetResolver.resolve(quote: text.quote, lines: lines, display: screen.displayFrame))
            } catch TargetResolutionError.ambiguous {
                throw TargetResolutionError.ambiguous
            } catch { continue }
        }
        if matches.count > 1 { throw TargetResolutionError.ambiguous }
        if let match = matches.first { return match }
        return try await vision(.text(text), captures: captures)
    }

    private func capture() async throws -> [CompanionScreenCapture] {
        try Task.checkCancellation()
        if Date().timeIntervalSince(capturedAt) <= ResolverConfiguration.screenLifetime, screens.isEmpty == false { return screens }
        guard let exclusions = ResolverConfiguration.captureExclusions() else { throw TargetResolutionError.unavailable }
        let task: Task<[CompanionScreenCapture], Error>
        if let existing = captureTask { task = existing } else {
            task = Task { @MainActor in
                try await CompanionScreenCaptureUtility.captureAllScreensAsJPEG(excludingBundleIdentifiers: exclusions)
            }
            captureTask = task
        }
        defer { captureTask = nil }
        let result = try await task.value
        try Task.checkCancellation()
        screens = result
        capturedAt = Date()
        return result
    }

    private func vision(_ target: Target, captures: [CompanionScreenCapture]) async throws -> ResolvedTarget {
        var matches: [ResolvedTarget] = []
        for screen in captures {
            guard workspace.isReady else { throw WorkspaceError.notReady }
            let data = try JSONEncoder().encode(target)
            let object = try JSONSerialization.jsonObject(with: data)
            let result = try await workspace.webView.callAsyncJavaScript(
                """
                const response = await fetch(path, { method: 'POST', credentials: 'same-origin',
                  headers: {'Content-Type': 'application/json'}, body: JSON.stringify({target, image, screenIndex}) });
                if (!response.ok) throw new Error('resolve_failed');
                return JSON.stringify(await response.json());
                """,
                arguments: ["path": ResolverConfiguration.resolvePath, "target": object,
                    "image": screen.imageData.base64EncodedString(), "screenIndex": screen.screenIndex],
                in: nil, contentWorld: .page
            )
            try Task.checkCancellation()
            guard let json = result as? String, let bytes = json.data(using: .utf8) else { throw TargetResolutionError.unavailable }
            let response = try JSONDecoder().decode(VisionResponse.self, from: bytes)
            if let point = response.point {
                guard point.screenIndex == screen.screenIndex else { throw TargetResolutionError.unavailable }
                matches.append(try TargetResolver.point(point, screens: captures.map(\.displayFrame)))
            }
        }
        guard matches.count == 1, let match = matches.first else { throw TargetResolutionError.unavailable }
        return match
    }

    private func sortedScreenFrames() -> [CGRect] {
        NSScreen.screens.sorted {
            let key = NSDeviceDescriptionKey("NSScreenNumber")
            return ($0.deviceDescription[key] as? UInt32 ?? 0) < ($1.deviceDescription[key] as? UInt32 ?? 0)
        }.map(\.frame)
    }

    private func present(_ action: NativeOverlayAction, at location: ResolvedTarget) {
        overlay.state.target = CGPoint(x: location.rect.midX, y: location.rect.midY)
        if let label = action.label, activeSentence == nil { overlay.state.caption = label }
        if action.kind == .highlight || action.kind == .annotate {
            overlay.state.annotation = .init(rect: location.rect,
                style: action.kind == .highlight ? .highlight : AnnotationStyle(rawValue: action.style ?? "rectangle") ?? .rectangle,
                label: action.label, number: action.sentenceIndex + 1)
        }
        complete(action, method: location.method, confidence: location.confidence)
        scheduleExpiry()
    }

    private func complete(_ action: NativeOverlayAction, method: ResolvedBy, confidence: Double) {
        guard completed.insert(action.id).inserted else { return }
        report(.init(actionID: action.id, confidence: confidence, failureReason: nil, resolvedBy: method, success: true))
    }

    private func report(_ result: ActionResult) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await workspace.send(.actionResult(.init(id: UUID().uuidString, payload: result, type: .actionResult, v: .the100)))
            } catch { overlay.state.clear() }
        }
    }

    private func scheduleExpiry() {
        expiry?.cancel()
        expiry = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: OverlayConfiguration.stepLifetime) } catch { return }
            self?.stop()
        }
    }
}

private struct VisionResponse: Decodable { let point: TargetPoint? }
