// Adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import AppKit
import SwiftUI

@MainActor
public final class OverlayWindow: NSWindow {
    public init(screen: NSScreen) {
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        level = .screenSaver
        ignoresMouseEvents = true
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        isReleasedWhenClosed = false
        hasShadow = false
        hidesOnDeactivate = false
        setFrame(screen.frame, display: true)
    }

    public override var canBecomeKey: Bool { false }
    public override var canBecomeMain: Bool { false }

    public func setDrawMode(_ enabled: Bool) { ignoresMouseEvents = enabled == false }
}

@MainActor
@Observable
public final class OverlayState {
    public var target: CGPoint?
    public var caption = ""
    public init() {}
}

@MainActor
public final class OverlayWindowManager {
    public let state = OverlayState()
    private var windows: [OverlayWindow] = []
    public init() {}

    public func showOverlay(on screens: [NSScreen] = NSScreen.screens) {
        hideOverlay()
        for screen in screens {
            let window = OverlayWindow(screen: screen)
            window.contentView = NSHostingView(rootView: BlueCursorView(screenFrame: screen.frame, state: state))
            windows.append(window)
            window.orderFrontRegardless()
        }
    }

    public func hideOverlay() {
        for window in windows {
            window.orderOut(nil)
            window.contentView = nil
        }
        windows.removeAll()
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        let size = min(rect.width, rect.height)
        let height = size * sqrt(3) / 2
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.midY - height / 1.5))
        path.addLine(to: CGPoint(x: rect.midX - size / 2, y: rect.midY + height / 3))
        path.addLine(to: CGPoint(x: rect.midX + size / 2, y: rect.midY + height / 3))
        path.closeSubpath()
        return path
    }
}

@MainActor
private struct BlueCursorView: View {
    let screenFrame: CGRect
    let state: OverlayState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var position: CGPoint = .zero
    @State private var visible = false
    @State private var rotation: Double = -35
    @State private var scale = 1.0
    private let blue = Color(red: 0.17, green: 0.51, blue: 1)

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            if visible {
                Triangle()
                    .fill(blue)
                    .frame(width: 14, height: 14)
                    .rotationEffect(.degrees(rotation))
                    .scaleEffect(scale)
                    .shadow(color: blue.opacity(0.6), radius: 6)
                    .position(position)
                    .accessibilityHidden(true)
                if state.caption.isEmpty == false {
                    Text(state.caption)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(10)
                        .background(blue, in: RoundedRectangle(cornerRadius: 8))
                        .frame(maxWidth: min(360, screenFrame.width - 40), alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .position(x: min(position.x + 190, screenFrame.width - 200), y: max(35, position.y + 35))
                        .accessibilityLabel(state.caption)
                }
            }
        }
        .allowsHitTesting(false)
        .task {
            while Task.isCancelled == false {
                let mouse = NSEvent.mouseLocation
                let point = state.target ?? mouse
                visible = screenFrame.contains(point)
                if state.target == nil {
                    let local = localPoint(point)
                    withAnimation(reduceMotion ? nil : .spring(response: 0.2, dampingFraction: 0.6)) {
                        position = CGPoint(x: local.x + 35, y: local.y + 25)
                    }
                }
                do { try await Task.sleep(for: .milliseconds(16)) } catch { return }
            }
        }
        .task(id: state.target) {
            guard let target = state.target, screenFrame.contains(target) else { return }
            let flight = CursorFlight(start: position, end: localPoint(target))
            if reduceMotion {
                position = flight.end
                return
            }
            let start = Date()
            while Task.isCancelled == false {
                let progress = Date().timeIntervalSince(start) / flight.duration
                position = flight.position(at: progress)
                if progress >= 1 {
                    rotation = -35
                    scale = 1
                    return
                }
                rotation = flight.rotation(at: progress)
                scale = flight.scale(at: progress)
                do { try await Task.sleep(for: .milliseconds(16)) } catch { return }
            }
        }
    }

    private func localPoint(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x - screenFrame.minX, y: screenFrame.maxY - point.y)
    }
}
