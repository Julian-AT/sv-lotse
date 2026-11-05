import Foundation
import Testing

@testable import LotseRelatives

@Test("NFR-11 screen sharing requires unexpired consent and supports pause")
func sharingConsent() {
    var consent = SharingConsent()
    let now = Date(timeIntervalSince1970: 100)
    #expect(consent.canShare(at: now) == false)
    consent.approve(until: now.addingTimeInterval(60))
    #expect(consent.canShare(at: now))
    #expect(consent.canShare(at: now.addingTimeInterval(60)) == false)
    consent.pause()
    #expect(consent.canShare(at: now) == false)
}
