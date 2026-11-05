import CoreGraphics
import Testing

@testable import LotseResolver

@Test("FR-C2 screen points convert using the selected display origin")
func coordinateConversion() {
    let frame = CGRect(x: -1200, y: 200, width: 1200, height: 900)
    #expect(ScreenCoordinates.localPoint(CGPoint(x: -1100, y: 1000), in: frame) == CGPoint(x: 100, y: 100))
}
