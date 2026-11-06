// Adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import AppKit
import SwiftUI

@MainActor
public final class OverlayWindow: NSWindow {
    public init(screen: NSScreen) {
        let frame = Self.frame(for: screen)
        super.init(contentRect: frame, styleMask: .borderless, backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        level = .screenSaver
        ignoresMouseEvents = true
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        isExcludedFromWindowsMenu = true
        isReleasedWhenClosed = false
        hasShadow = false
        hidesOnDeactivate = false
        setFrame(frame, display: true)
    }

    /// The screen without the menu-bar strip: the overlay never sits over the menu bar or its status items.
    public static func frame(for screen: NSScreen) -> CGRect {
        frame(screen: screen.frame, visible: screen.visibleFrame, topInset: screen.safeAreaInsets.top,
              menuBarThickness: NSStatusBar.system.thickness)
    }

    nonisolated static func frame(
        screen: CGRect, visible: CGRect, topInset: CGFloat, menuBarThickness: CGFloat
    ) -> CGRect {
        let menuBar = max(screen.maxY - visible.maxY, topInset, menuBarThickness)
        var frame = screen
        frame.size.height = max(1, screen.height - menuBar)
        return frame
    }

    public override var canBecomeKey: Bool { false }
    public override var canBecomeMain: Bool { false }
    /// Only the circle-to-ask gesture takes clicks; every other moment is click-through.
    public func setDrawMode(_ enabled: Bool) { ignoresMouseEvents = enabled == false }
}

public enum AnnotationStyle: String, Sendable {
    case arrow, circle, rectangle, numbered, highlight
}

public struct OverlayAnnotation: Equatable, Sendable {
    public let rect: CGRect
    public let style: AnnotationStyle
    public let label: String?
    public let number: Int

    public init(rect: CGRect, style: AnnotationStyle, label: String?, number: Int) {
        self.rect = rect
        self.style = style
        self.label = label
        self.number = number
    }
}

@MainActor
@Observable
public final class OverlayState {
    public var target: CGPoint?
    /// The spoken sentence. Its arrival ends the "answer on its way" spinner.
    public var caption = "" {
        didSet { if caption.isEmpty == false, listening.phase == .sending { listening.hide() } }
    }
    public var highlights: [CGRect] = []
    public var annotation: OverlayAnnotation?
    public var position = CGPoint.zero
    public var rotation = -35.0
    public var scale = 1.0
    public var helperCursor: HelperCursor?
    public var helperAnnotations: [HelperAnnotation] = []
    /// A pinned notice, such as the safety notice with emergency numbers. Step clearing keeps it.
    public var notice = ""
    /// Speech capture shown at the cursor: Clicky's waveform, then its spinner until the answer speaks.
    public var listening = ListeningIndicator()
    public var listeningEnglish = false
    /// True while the cursor flies along its arc; following and easing are off then.
    public var isFlying = false
    public init() {}

    public var cursorMode: CursorMode {
        switch listening.phase {
        case .listening: .listening
        case .sending: .processing
        case .hidden, .error: .pointer
        }
    }

    public func clear() {
        target = nil
        caption = ""
        annotation = nil
    }
}

@MainActor
public final class OverlayWindowManager {
    public let state = OverlayState()
    private var windows: [OverlayWindow] = []
    private var animationTask: Task<Void, Never>?
    public private(set) var isDrawing = false
    public var onSelection: ((CircleSelection) -> Void)?
    private var localEscapeMonitor: Any?
    private var globalEscapeMonitor: Any?
    public init() {}

    public func showOverlay(on screens: [NSScreen] = NSScreen.screens) {
        hideOverlay()
        state.position = NSEvent.mouseLocation
        for screen in screens {
            let window = OverlayWindow(screen: screen)
            window.contentView = NSHostingView(rootView: ZStack {
                CompanionCursorView(screenFrame: window.frame, state: state)
                HelperCursorView(screenFrame: window.frame, state: state)
            })
            window.setDrawMode(false)
            windows.append(window)
            window.orderFrontRegardless()
        }
        animationTask = Task { @MainActor [weak self] in await self?.animate() }
    }

    public func hideOverlay() {
        animationTask?.cancel()
        animationTask = nil
        cancelDrawing()
        for window in windows {
            window.orderOut(nil)
            window.contentView = nil
        }
        windows.removeAll()
    }

    private func animate() async {
        var lastTarget: CGPoint?
        var flight: CursorFlight?
        var started = ContinuousClock.now
        while Task.isCancelled == false {
            let mouse = NSEvent.mouseLocation
            if lastTarget != state.target {
                lastTarget = state.target
                flight = CursorFlight(start: state.position, end: state.target ?? CGPoint(x: mouse.x + 25, y: mouse.y - 25))
                started = .now
            }
            if let current = flight {
                let elapsed = started.duration(to: .now).components
                let speed = CursorSpeed(rawValue: UserDefaults.standard.string(forKey: OverlayPreferenceKey.cursorSpeed) ?? "") ?? .standard
                let progress = (Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1e18) / (current.duration / speed.multiplier)
                let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ||
                    UserDefaults.standard.bool(forKey: OverlayPreferenceKey.reducedMotion)
                state.position = current.position(at: reduced ? 1 : progress)
                state.rotation = reduced ? -35 : current.rotation(at: progress)
                state.scale = reduced ? 1 : current.scale(at: progress)
                if progress >= 1 || reduced { flight = nil }
                state.isFlying = flight != nil
            } else {
                state.isFlying = false
                state.position = state.target ?? CGPoint(x: mouse.x + 25, y: mouse.y - 25)
                state.rotation = -35
                state.scale = 1
            }
            do { try await Task.sleep(for: OverlayConfiguration.frameInterval) } catch { return }
        }
    }

    public func beginDrawing(instruction: String) {
        cancelDrawing()
        if windows.isEmpty { showOverlay() }
        isDrawing = true
        for window in windows {
            let view = CircleDrawingView(frame: CGRect(origin: .zero, size: window.frame.size))
            view.instruction = instruction
            view.setAccessibilityLabel(instruction)
            view.completed = { [weak self, weak window] rect in
                guard let self, let window else { return }
                let displayID = window.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
                let globalRect = rect.map { window.convertToScreen($0) }
                // Restore click-through before callbacks can start capture or prompt for permissions.
                cancelDrawing()
                if let globalRect, let displayID { onSelection?(CircleSelection(displayID: displayID, globalRect: globalRect)) }
            }
            window.contentView = view
            window.setDrawMode(true)
        }
        localEscapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return event }
            MainActor.assumeIsolated { self?.cancelDrawing() }
            return nil
        }
        globalEscapeMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.keyCode == 53 else { return }
            MainActor.assumeIsolated { self?.cancelDrawing() }
        }
    }

    public func cancelDrawing() {
        if let localEscapeMonitor { NSEvent.removeMonitor(localEscapeMonitor) }
        if let globalEscapeMonitor { NSEvent.removeMonitor(globalEscapeMonitor) }
        localEscapeMonitor = nil
        globalEscapeMonitor = nil
        guard isDrawing else { return }
        isDrawing = false
        for window in windows {
            window.setDrawMode(false)
            window.contentView = NSHostingView(rootView: ZStack {
                CompanionCursorView(screenFrame: window.frame, state: state)
                HelperCursorView(screenFrame: window.frame, state: state)
            })
        }
    }
}

@MainActor
struct CompanionCursorView: View {
    let screenFrame: CGRect
    let state: OverlayState
    @AppStorage(OverlayPreferenceKey.cursorSize) private var cursorSize = CursorSize.standard.rawValue
    @AppStorage(OverlayPreferenceKey.reducedMotion) private var reducedMotionPreference = false
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @State private var appeared = false
    private let brand = OverlayPalette.brand
    private var sizeScale: Double { (CursorSize(rawValue: cursorSize) ?? .standard).scale }
    private var reduceMotion: Bool { systemReduceMotion || reducedMotionPreference }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            if state.notice.isEmpty == false, screenFrame.contains(state.position) {
                let width = min(OverlayConfiguration.captionWidth * 1.4, max(1, screenFrame.width - 20))
                Text(verbatim: state.notice)
                    .font(.system(size: 17, weight: .semibold)).foregroundStyle(.primary).padding(16)
                    .frame(width: width, alignment: .leading)
                    .lotseGlassSurface(cornerRadius: 20)
                    .overlay(RoundedRectangle(cornerRadius: 20).stroke(brand, lineWidth: 2))
                    .fixedSize(horizontal: false, vertical: true)
                    .position(x: screenFrame.width / 2, y: 110)
                    .accessibilityLabel(state.notice)
            }
            ForEach(Array(state.highlights.enumerated()), id: \.offset) { _, box in
                let local = CGRect(x: box.minX - screenFrame.minX, y: screenFrame.maxY - box.maxY, width: box.width, height: box.height)
                if screenFrame.intersects(box) {
                    Rectangle().fill(brand.opacity(0.2))
                        .overlay(Rectangle().stroke(brand, lineWidth: 2))
                        .frame(width: local.width, height: local.height)
                        .position(x: local.midX, y: local.midY)
                        .accessibilityHidden(true)
                }
            }
            if let annotation = state.annotation, screenFrame.intersects(annotation.rect) {
                AnnotationView(annotation: annotation, screenFrame: screenFrame)
            }
            if screenFrame.contains(state.position) {
                cursor(at: localPoint(state.position))
            }
        }
        .opacity(appeared ? 1 : 0)
        .onAppear { withAnimation(.easeIn(duration: reduceMotion ? 0 : 0.6)) { appeared = true } }
        .allowsHitTesting(false)
    }

    /// Clicky's cursor: the triangle, the waveform and the spinner stay in the tree and cross-fade
    /// in place, so the cursor itself turns into the listening and thinking indicators.
    @ViewBuilder
    private func cursor(at point: CGPoint) -> some View {
        let mode = state.cursorMode
        // Clicky follows the mouse with a quick spring; during a flight the arc drives every frame.
        let follow: Animation? = state.isFlying || reduceMotion ? nil : .spring(response: 0.2, dampingFraction: 0.6)
        ZStack {
            PointerGlyph(size: 14 * sizeScale, fill: brand, rotation: state.rotation,
                         glowRadius: PointerGlyph.glowRadius + (state.scale - 1) * 20)
                .scaleEffect(state.scale)
                .animation(state.isFlying || reduceMotion ? nil : .easeInOut(duration: 0.3), value: state.rotation)
                .opacity(mode == .pointer ? 1 : 0)
                .animation(.easeIn(duration: 0.25), value: mode)
            CursorWaveformView(level: state.listening.level, active: mode == .listening, reduceMotion: reduceMotion)
                .scaleEffect(sizeScale)
                .opacity(mode == .listening ? 1 : 0)
                .animation(.easeIn(duration: 0.15), value: mode)
            CursorSpinnerView(active: mode == .processing, reduceMotion: reduceMotion)
                .scaleEffect(sizeScale)
                .opacity(mode == .processing ? 1 : 0)
                .animation(.easeIn(duration: 0.15), value: mode)
        }
        .position(point)
        .animation(follow, value: point)
        // The waveform and spinner are wider than the triangle's tip, so the bubble steps aside a little more.
        let gap = CGSize(width: (mode == .pointer ? 10 : 16) * sizeScale, height: 7 * sizeScale)
        CursorBubbleLayout(cursor: point, gap: gap) {
            if let bubble { bubble.transition(.opacity) }
        }
        .frame(width: screenFrame.width, height: screenFrame.height)
        .animation(follow, value: point)
        .animation(.easeOut(duration: reduceMotion ? 0.2 : 0.5), value: bubbleText)
    }

    /// Errors and the live transcript while capturing; otherwise the spoken sentence (captions for all speech).
    private var bubbleText: String {
        switch state.listening.phase {
        case .error(let message): message
        case .listening, .sending: state.listening.partial
        case .hidden: state.caption
        }
    }

    private var bubble: CursorBubble? {
        let text = bubbleText
        guard text.isEmpty == false else { return nil }
        let width = min(OverlayConfiguration.captionWidth, max(1, screenFrame.width - 20))
        switch state.listening.phase {
        case .error:
            return CursorBubble(text: text, symbol: "exclamationmark.triangle.fill", fontSize: 13, maxWidth: width,
                                animated: reduceMotion == false)
        case .listening, .sending:
            return CursorBubble(text: text, style: .user, fontSize: 13, maxWidth: width * 0.8, lineLimit: 2, animated: false)
        case .hidden:
            return CursorBubble(text: text, fontSize: 15, maxWidth: width, animated: reduceMotion == false)
        }
    }

    private func localPoint(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x - screenFrame.minX, y: screenFrame.maxY - point.y)
    }
}

private struct AnnotationView: View {
    let annotation: OverlayAnnotation
    let screenFrame: CGRect
    private var rect: CGRect {
        CGRect(x: annotation.rect.minX - screenFrame.minX, y: screenFrame.maxY - annotation.rect.maxY,
            width: max(24, annotation.rect.width), height: max(24, annotation.rect.height))
    }

    var body: some View {
        Canvas { context, _ in
            let color = OverlayPalette.brand
            switch annotation.style {
            case .circle: context.stroke(Path(ellipseIn: rect.insetBy(dx: -4, dy: -4)), with: .color(color), lineWidth: 3)
            case .rectangle: context.stroke(Path(rect.insetBy(dx: -4, dy: -4)), with: .color(color), lineWidth: 3)
            case .highlight:
                context.fill(Path(rect), with: .color(color.opacity(0.2)))
                context.stroke(Path(rect), with: .color(color), lineWidth: 2)
            case .arrow:
                var path = Path()
                let end = CGPoint(x: rect.midX, y: rect.midY)
                path.move(to: CGPoint(x: end.x - 60, y: end.y - 50))
                path.addLine(to: end)
                path.addLine(to: CGPoint(x: end.x - 18, y: end.y - 4))
                path.move(to: end)
                path.addLine(to: CGPoint(x: end.x - 7, y: end.y - 18))
                context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: 4, lineCap: .round))
            case .numbered:
                let marker = CGRect(x: rect.minX - 16, y: rect.minY - 16, width: 32, height: 32)
                context.fill(Path(ellipseIn: marker), with: .color(color))
                context.draw(Text(verbatim: String(annotation.number)).foregroundStyle(OverlayPalette.onBrand).bold(),
                    at: CGPoint(x: marker.midX, y: marker.midY))
            }
            if let label = annotation.label, label.isEmpty == false {
                context.draw(Text(verbatim: label).foregroundStyle(color).bold(), at: CGPoint(x: rect.midX, y: max(15, rect.minY - 18)))
            }
        }
        .accessibilityHidden(true)
    }
}
