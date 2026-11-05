import AppKit
import Testing

@testable import LotseOverlay

@Test("FR-C2 cursor flight starts and lands at the requested points")
func flightEndpoints() {
    let flight = CursorFlight(start: CGPoint(x: 10, y: 20), end: CGPoint(x: 400, y: 300))
    #expect(flight.position(at: 0) == flight.start)
    #expect(flight.position(at: 1) == flight.end)
    #expect(flight.position(at: 0.5).y < 160)
    #expect((0.6...1.4).contains(flight.duration))
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
    window.setDrawMode(true)
    #expect(window.ignoresMouseEvents == false)
    window.setDrawMode(false)
    #expect(window.ignoresMouseEvents)
}
