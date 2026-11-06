import CoreGraphics
import Testing

@testable import LotseOverlay

@Test("Cursor listening state: begin, level, partial, release, hide")
func listeningIndicatorFlow() {
    var indicator = ListeningIndicator()
    #expect(indicator.isVisible == false)
    indicator.update(level: 0.8)
    #expect(indicator.level == 0)
    indicator.begin()
    #expect(indicator.phase == .listening)
    indicator.update(level: 0.8)
    #expect(indicator.level == 0.8)
    indicator.update(partial: "Wie beantrage")
    #expect(indicator.partial == "Wie beantrage")
    indicator.release()
    #expect(indicator.phase == .sending)
    #expect(indicator.level == 0)
    indicator.update(partial: "Wie beantrage ich Pflegegeld")
    #expect(indicator.partial == "Wie beantrage ich Pflegegeld")
    indicator.hide()
    #expect(indicator.isVisible == false)
    #expect(indicator.partial.isEmpty)
}

@Test("Cursor bubble shows errors and a new hold clears them")
func listeningIndicatorError() {
    var indicator = ListeningIndicator()
    indicator.begin()
    indicator.fail("Mikrofon nicht verfügbar")
    #expect(indicator.phase == .error("Mikrofon nicht verfügbar"))
    indicator.release()
    #expect(indicator.phase == .error("Mikrofon nicht verfügbar"))
    indicator.begin()
    #expect(indicator.phase == .listening)
}

@Test("The cursor turns into the waveform, then the spinner, and the first caption brings the triangle back") @MainActor
func cursorModes() {
    let state = OverlayState()
    #expect(state.cursorMode == .pointer)
    state.listening.begin()
    #expect(state.cursorMode == .listening)
    state.caption = "Not yet"
    #expect(state.cursorMode == .listening)
    state.listening.release()
    #expect(state.cursorMode == .processing)
    state.caption = ""
    #expect(state.cursorMode == .processing)
    state.caption = "Den Antrag stellen Sie bei Ihrer Pflegekasse."
    #expect(state.cursorMode == .pointer)
    #expect(state.listening.isVisible == false)
    state.listening.begin()
    state.listening.fail("Mikrofon nicht verfügbar")
    #expect(state.cursorMode == .pointer)
}

@Test("The cursor bubble sits right of and below the cursor and flips at the screen edges")
func cursorBubblePlacement() {
    let bounds = CGSize(width: 640, height: 360)
    let size = CGSize(width: 200, height: 30)
    let gap = CGSize(width: 10, height: 7)
    #expect(cursorBubbleOrigin(cursor: CGPoint(x: 100, y: 100), size: size, gap: gap, in: bounds) == CGPoint(x: 110, y: 107))
    let corner = cursorBubbleOrigin(cursor: CGPoint(x: 600, y: 340), size: size, gap: gap, in: bounds)
    #expect(corner.x + size.width <= 600)
    #expect(corner.y + size.height <= 340)
    let wide = cursorBubbleOrigin(cursor: CGPoint(x: 50, y: 50), size: CGSize(width: 900, height: 30), gap: gap, in: bounds)
    #expect(wide.x == 8)
}
