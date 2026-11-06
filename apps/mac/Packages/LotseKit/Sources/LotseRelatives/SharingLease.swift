import Foundation
import os

final class SharingLease: Sendable {
    private struct State { var expiresAt: Date; var active = true }
    private let state: OSAllocatedUnfairLock<State>
    var expiresAt: Date { state.withLock { $0.expiresAt } }

    init(expiresAt: Date) { state = OSAllocatedUnfairLock(initialState: State(expiresAt: expiresAt)) }

    func revoke() { state.withLock { $0.active = false } }

    func limit(to expiry: Date) { state.withLock { $0.expiresAt = min($0.expiresAt, expiry) } }

    func permitsSharing(at date: Date = Date()) -> Bool {
        state.withLock { $0.active && date < $0.expiresAt }
    }

    func check() throws {
        try Task.checkCancellation()
        guard permitsSharing() else { throw RelativesError.consentRequired }
    }
}
