import AppKit
import Testing

@testable import LotseOverlay

@Test("FR-C2 cursor flight starts and lands at the requested points")
func flightEndpoints() {
    let flight = CursorFlight(start: CGPoint(x: 10, y: 20), end: CGPoint(x: 400, y: 300))
    #expect(flight.position(at: 0) == flight.start)
    #expect(flight.position(at: 1) == flight.end)
    #expect(flight.position(at: 0.5).y < 160)
    #expect((OverlayConfiguration.minimumFlightDuration...OverlayConfiguration.maximumFlightDuration).contains(flight.duration))
    #expect(flight.scale(at: 0) == 1)
    #expect(flight.scale(at: 0.5) == 1.3)
    #expect(flight.rotation(at: 0.5).isFinite)
}

@Test("FR-C2 overlay is click-through except during draw mode") @MainActor
func clickThrough() throws {
    _ = NSApplication.shared
    let screen = try #require(NSScreen.main)
    let window = OverlayWindow(screen: screen)
    #expect(window.ignoresMouseEvents)
    #expect(window.canBecomeKey == false)
    #expect(window.isOpaque == false && window.hasShadow == false && window.backgroundColor == .clear)
    #expect(window.frame.maxY <= screen.visibleFrame.maxY)
    window.setDrawMode(true)
    #expect(window.ignoresMouseEvents == false)
    window.setDrawMode(false)
    #expect(window.ignoresMouseEvents)
}

@Test("NFR-2 even inter-display cursor flights arrive within 600 milliseconds")
func interDisplayFlightBudget() {
    let flight = CursorFlight(start: CGPoint(x: -6000, y: -2000), end: CGPoint(x: 6000, y: 4000))
    #expect(flight.duration < 0.6)
    #expect(flight.position(at: 1) == flight.end)
}

@Test("FR-C5 clearing a step removes its caption, target and annotation") @MainActor
func clearStep() {
    let state = OverlayState()
    state.caption = "Visible sentence"
    state.target = CGPoint(x: 30, y: 50)
    state.annotation = .init(rect: CGRect(x: 10, y: 20, width: 40, height: 30), style: .numbered, label: nil, number: 2)
    state.clear()
    #expect(state.caption.isEmpty)
    #expect(state.target == nil)
    #expect(state.annotation == nil)
}

@Test("FR-C6 scribble bounds include every point and clip to the selected screen")
func scribbleBounds() {
    var selection = CircleSelectionBounds()
    let frame = CGRect(x: 0, y: 0, width: 100, height: 100)
    #expect(selection.selection(in: frame) == nil)
    selection.append(CGPoint(x: 50, y: 50))
    #expect(selection.selection(in: frame) == nil)
    selection.append(CGPoint(x: -10, y: 20))
    selection.append(CGPoint(x: 80, y: 90))
    #expect(selection.selection(in: frame) == CGRect(x: 0, y: 20, width: 80, height: 70))
}

@Test("FR-C6 cancel and hide always release drawing windows without taking keyboard focus") @MainActor
func drawingLifecycle() throws {
    _ = NSApplication.shared
    let manager = OverlayWindowManager()
    manager.showOverlay(on: [try #require(NSScreen.main)])
    manager.beginDrawing(instruction: "Test drawing")
    #expect(manager.isDrawing)
    let windows = NSApplication.shared.windows.compactMap { $0 as? OverlayWindow }
    #expect(windows.contains { $0.ignoresMouseEvents == false })
    #expect(windows.allSatisfy { $0.canBecomeKey == false })
    manager.cancelDrawing()
    #expect(manager.isDrawing == false)
    #expect(windows.allSatisfy { $0.ignoresMouseEvents })
    manager.beginDrawing(instruction: "Test drawing")
    manager.hideOverlay()
    #expect(manager.isDrawing == false)
    #expect(windows.allSatisfy { $0.ignoresMouseEvents })
}

@Test("FR-L4 companion cursor offers bounded size and speed choices")
func cursorPreferences() {
    #expect(CursorSize.standard.scale == 1)
    #expect(CursorSize.extraLarge.scale == 2)
    #expect(CursorSpeed.slow.multiplier == 0.5)
    #expect(CursorSpeed.fast.multiplier == 1.5)
    #expect(CursorSize(rawValue: "unsupported") == nil)
    #expect(CursorSpeed(rawValue: "unsupported") == nil)
}

@Test("FR-C2 overlay leaves the menu bar and its status items uncovered")
func overlaySkipsMenuBar() {
    let screen = CGRect(x: 0, y: 0, width: 1728, height: 1117)
    let notched = OverlayWindow.frame(screen: screen, visible: CGRect(x: 0, y: 0, width: 1728, height: 1080),
                                      topInset: 32, menuBarThickness: 24)
    #expect(notched.maxY == 1080)
    let hidden = OverlayWindow.frame(screen: screen, visible: screen, topInset: 0, menuBarThickness: 24)
    #expect(hidden.maxY == 1093)
    #expect(hidden.minY == 0 && hidden.width == 1728)
}
