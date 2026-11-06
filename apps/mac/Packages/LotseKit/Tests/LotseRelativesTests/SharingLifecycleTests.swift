import CoreGraphics
import Foundation
import LotseOverlay
import Testing

@testable import LotseRelatives

@MainActor
private final class TestTransport: SharingTransport {
    var starts = 0
    var stops = 0
    var lease: SharingLease?
    var onStart: (() -> Void)?
    func start(credentials: RelativesCredentials, displayID: CGDirectDisplayID, lease: SharingLease) async throws {
        starts += 1
        self.lease = lease
        try lease.check()
        onStart?()
    }
    func stop() async { stops += 1 }
}

@Test("FR-R2 requires explicit unexpired consent before even fetching a token")
@MainActor
func consentBeforeToken() async {
    var requests = 0
    let transport = TestTransport()
    let session = SharingSessionController(token: { _ in
        requests += 1
        throw RelativesError.workspaceUnavailable
    }, overlay: OverlayState(), makeTransport: { _, _ in transport })
    session.start(caseID: UUID(), displayID: 1, displayFrame: .zero, consent: SharingConsent())
    await session.waitForStop()
    #expect(requests == 0)
    #expect(transport.starts == 0)
    #expect(session.status == .failed)
}

@Test("FR-R2 pause while the token is pending never starts screen or microphone publishing")
@MainActor
func pauseBeforeCredentials() async throws {
    let transport = TestTransport()
    let (ready, continuation) = AsyncStream<Void>.makeStream()
    var tokenContinuation: CheckedContinuation<RelativesCredentials, Error>?
    let session = SharingSessionController(token: { _ in
        try await withCheckedThrowingContinuation { pending in
            tokenContinuation = pending
            continuation.yield(())
        }
    }, overlay: OverlayState(), makeTransport: { _, _ in transport })
    var consent = SharingConsent()
    consent.approve(until: Date().addingTimeInterval(60))
    session.start(caseID: UUID(), displayID: 1, displayFrame: .zero, consent: consent)
    for await _ in ready { break }
    session.pause()
    tokenContinuation?.resume(returning: try credentials())
    await session.waitForStop()
    #expect(transport.starts == 0)
    #expect(transport.stops > 0)
    #expect(session.status == .idle)
}

@Test("FR-R2 active sharing revokes frame access synchronously and tears down its transport")
@MainActor
func pauseActiveSharing() async throws {
    let transport = TestTransport()
    let (statuses, continuation) = AsyncStream<SharingSessionController.Status>.makeStream()
    let overlay = OverlayState()
    let session = SharingSessionController(token: { _ in try credentials() }, overlay: overlay,
                                           makeTransport: { _, _ in transport })
    session.onStatusChanged = { continuation.yield($0) }
    var consent = SharingConsent()
    consent.approve(until: Date().addingTimeInterval(60))
    session.start(caseID: UUID(), displayID: 1, displayFrame: .zero, consent: consent)
    for await status in statuses where status == .sharing { break }
    overlay.helperCursor = .init(identity: "helper:approved", name: "Test", position: .zero)
    #expect(transport.lease?.permitsSharing() == true)
    session.pause()
    #expect(transport.lease?.permitsSharing() == false)
    #expect(overlay.helperCursor == nil)
    await session.waitForStop()
    #expect(transport.stops > 0)
    #expect(session.status == .idle)
}

@Test("FR-R2 expired leases refuse capture frames even before the expiry task runs")
func leaseDeadline() {
    let expiry = Date(timeIntervalSince1970: 100)
    let lease = SharingLease(expiresAt: expiry)
    #expect(lease.permitsSharing(at: expiry.addingTimeInterval(-1)))
    #expect(lease.permitsSharing(at: expiry) == false)
    lease.limit(to: expiry.addingTimeInterval(-2))
    #expect(lease.permitsSharing(at: expiry.addingTimeInterval(-1)) == false)
    lease.limit(to: expiry.addingTimeInterval(100))
    #expect(lease.expiresAt == expiry.addingTimeInterval(-2))
    lease.revoke()
    #expect(lease.permitsSharing(at: expiry.addingTimeInterval(-1)) == false)
}

private func credentials() throws -> RelativesCredentials {
    try RelativesCredentials(serverUrl: #require(URL(string: "wss://livekit.test")),
                             participantToken: "test-only-token", expiresAt: Date().addingTimeInterval(60))
}
