import Foundation
import LotseOverlay
import Testing

@testable import LotseRelatives

@Test("FR-R3 maps normalized helper video coordinates onto the selected secondary display")
@MainActor
func helperPointerCoordinates() throws {
    let overlay = OverlayState()
    let receiver = HelperPointerReceiver(overlay: overlay)
    receiver.begin(displayFrame: CGRect(x: -1920, y: 200, width: 1920, height: 1080))
    receiver.receive(data: Data(#"{"kind":"cursor","sequence":1,"x":0.25,"y":0.75}"#.utf8),
                     identity: "helper:approved", name: "Daniel", topic: RelativesConfiguration.eventTopic)
    #expect(overlay.helperCursor?.position == CGPoint(x: -1440, y: 470))
    #expect(overlay.helperCursor?.name == "Daniel")
    #expect(overlay.target == nil)
    receiver.disconnect(identity: "helper:approved")
    #expect(overlay.helperCursor == nil)
    receiver.receive(data: Data(#"{"kind":"cursor","sequence":1,"x":1,"y":0}"#.utf8),
                     identity: "helper:approved", name: "Daniel", topic: RelativesConfiguration.eventTopic)
    #expect(CGRect(x: -1920, y: 200, width: 1920, height: 1080).contains(try #require(overlay.helperCursor?.position)))
}

@Test("FR-R3 rejects wrong sender, topic, invalid coordinates and stale data")
@MainActor
func helperPointerValidation() {
    let overlay = OverlayState()
    let receiver = HelperPointerReceiver(overlay: overlay)
    receiver.begin(displayFrame: CGRect(x: 0, y: 0, width: 100, height: 100))
    let valid = Data(#"{"kind":"cursor","sequence":2,"x":0.5,"y":0.5}"#.utf8)
    receiver.receive(data: valid, identity: "subject:owner", name: "", topic: RelativesConfiguration.eventTopic)
    receiver.receive(data: valid, identity: "helper:approved", name: "", topic: "other")
    #expect(overlay.helperCursor == nil)
    receiver.receive(data: valid, identity: "helper:approved", name: "Name\n", topic: RelativesConfiguration.eventTopic)
    let position = overlay.helperCursor?.position
    for json in [
        #"{"kind":"cursor","sequence":1,"x":0,"y":0}"#,
        #"{"kind":"cursor","sequence":3,"x":1.1,"y":0}"#,
        #"{"kind":"cursor","sequence":3,"x":0}"#,
        #"{"kind":"cursor","sequence":3,"x":-0.1,"y":0}"#
    ] {
        receiver.receive(data: Data(json.utf8), identity: "helper:approved", name: "", topic: RelativesConfiguration.eventTopic)
    }
    #expect(overlay.helperCursor?.position == position)
    #expect(overlay.helperCursor?.name == "Name")
    #expect(HelperPointerEvent.decode(Data(repeating: 32, count: RelativesConfiguration.maximumEventBytes + 1)) == nil)
    receiver.clear()
    #expect(overlay.helperCursor == nil)
}

@Test("FR-R3 bounds annotations and clears them without touching the pilot cursor")
@MainActor
func helperAnnotations() {
    let overlay = OverlayState()
    let receiver = HelperPointerReceiver(overlay: overlay)
    receiver.begin(displayFrame: CGRect(x: 0, y: 0, width: 200, height: 100))
    overlay.target = CGPoint(x: 22, y: 33)
    for sequence in 0...RelativesConfiguration.maximumAnnotations {
        let json = """
        {"kind":"annotation","sequence":\(sequence),"points":[{"x":0,"y":0},{"x":1,"y":1}]}
        """
        receiver.receive(data: Data(json.utf8), identity: "helper:approved", name: "", topic: RelativesConfiguration.eventTopic)
    }
    #expect(overlay.helperAnnotations.count == RelativesConfiguration.maximumAnnotations)
    #expect(overlay.helperAnnotations.first?.points == [CGPoint(x: 0, y: 100), CGPoint(x: 200, y: 0)])
    receiver.receive(data: Data(#"{"kind":"clear","sequence":99}"#.utf8),
                     identity: "helper:approved", name: "", topic: RelativesConfiguration.eventTopic)
    #expect(overlay.helperAnnotations.isEmpty)
    #expect(overlay.target == CGPoint(x: 22, y: 33))
}
