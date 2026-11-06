import Foundation
import LotseCapture
import LotseProtocol
import Testing

@testable import LotseCore

@Suite(.serialized) @MainActor
struct ScreenTranscriptTests {
    @Test("FR-C2 partials never capture and FR-C6 only the next final consumes focus")
    func nextTranscriptContext() async {
        var capturedFocus: [ScreenFocus?] = []
        var received: [Transcript] = []
        let capsule = ContextCapsule(focusedRegion: nil, page: nil, screen: nil)
        await confirmation(expectedCount: 3) { sent in
            let sender = ScreenTranscriptSender(capture: { focus, _ in
                capturedFocus.append(focus)
                return capsule
            }, send: { transcript in
                received.append(transcript)
                sent()
            })
            sender.focus = ScreenFocus(displayID: 17, globalRect: CGRect(x: -100, y: 20, width: 80, height: 60))
            sender.submit("Partial", final: false, language: "de-AT")
            sender.submit("First final", final: true, language: "de-AT")
            sender.submit("Second final", final: true, language: "de-AT")
            await sender.waitForPendingTranscripts()
        }
        #expect(received.map(\.text) == ["Partial", "First final", "Second final"])
        #expect(received[0].capsule == nil)
        #expect(received[1].capsule == capsule)
        #expect(capturedFocus.count == 2)
        #expect(capturedFocus[0]?.displayID == 17)
        #expect(capturedFocus[1] == nil)
    }

    @Test("FR-C2 capture denial still delivers the final question without invented screen context")
    func deniedCapture() async {
        var failureCount = 0
        var received: [Transcript] = []
        let sender = ScreenTranscriptSender(capture: { _, _ in throw CaptureError.permissionRequired }, send: { received.append($0) })
        sender.captureFailed = { failureCount += 1 }
        sender.submit("A question", final: true, language: "en-GB")
        await sender.waitForPendingTranscripts()
        #expect(failureCount == 1)
        #expect(received.count == 1)
        #expect(received.first?.text == "A question")
        #expect(received.first?.capsule == nil)
    }

    @Test("FR-C2 stop cancels pending delivery and clears a drawn region")
    func cancelPending() async {
        var received = false
        let sender = ScreenTranscriptSender(capture: { _, _ in
            ContextCapsule(focusedRegion: nil, page: nil, screen: nil)
        }, send: { _ in received = true })
        sender.focus = ScreenFocus(displayID: 1, globalRect: .zero)
        sender.submit("Cancelled", final: true, language: "de-AT")
        sender.cancel()
        await sender.waitForPendingTranscripts()
        #expect(received == false)
        #expect(sender.focus == nil)
    }
}
