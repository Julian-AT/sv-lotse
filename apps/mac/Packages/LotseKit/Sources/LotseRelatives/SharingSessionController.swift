import CoreGraphics
import Foundation
import LotseOverlay
import Observation

@MainActor
@Observable
public final class SharingSessionController {
    public enum Status: Equatable, Sendable { case idle, connecting, sharing, stopping, failed }
    public private(set) var status: Status = .idle
    public var onStatusChanged: ((Status) -> Void)?
    private let token: @MainActor (UUID) async throws -> RelativesCredentials
    private let makeTransport: @MainActor (HelperPointerReceiver, @escaping @MainActor () -> Void) -> SharingTransport
    private let receiver: HelperPointerReceiver
    private var lease: SharingLease?
    private var task: Task<Void, Never>?
    private var expirationTask: Task<Void, Never>?
    private var interruptionTask: Task<Void, Never>?
    private var transport: SharingTransport?
    private var sessionID: UUID?

    init(token: @escaping @MainActor (UUID) async throws -> RelativesCredentials,
         overlay: OverlayState,
         makeTransport: @escaping @MainActor (HelperPointerReceiver, @escaping @MainActor () -> Void) -> SharingTransport) {
        self.token = token
        self.makeTransport = makeTransport
        receiver = HelperPointerReceiver(overlay: overlay)
    }

    public convenience init(client: RelativesTokenClient, overlay: OverlayState,
                            excludedApplications: Set<String> = RelativesConfiguration.excludedApplications()) {
        self.init(token: { try await client.credentials(caseID: $0) }, overlay: overlay, makeTransport: { receiver, end in
            LiveKitSharingTransport(receiver: receiver, excludedApplications: excludedApplications, onEnd: end)
        })
    }

    public func start(caseID: UUID, displayID: CGDirectDisplayID, displayFrame: CGRect, consent: SharingConsent) {
        guard status == .idle || status == .failed else { return }
        guard consent.canShare(), let expiry = consent.expiration else {
            setStatus(.failed)
            return
        }
        let id = UUID()
        let lease = SharingLease(expiresAt: expiry)
        self.lease = lease
        sessionID = id
        receiver.begin(displayFrame: displayFrame)
        setStatus(.connecting)
        scheduleExpiration(at: expiry, id: id)
        task = Task { @MainActor [weak self] in
            await self?.runSession(id: id, caseID: caseID, displayID: displayID, lease: lease)
        }
    }

    private func runSession(id: UUID, caseID: UUID, displayID: CGDirectDisplayID, lease: SharingLease) async {
        let transport = makeTransport(receiver) { [weak self] in
            guard let self, sessionID == id else { return }
            pause()
        }
        self.transport = transport
        var failed = false
        do {
            let credentials = try await token(caseID)
            lease.limit(to: credentials.expiresAt)
            try lease.check()
            scheduleExpiration(at: lease.expiresAt, id: id)
            try await transport.start(credentials: credentials, displayID: displayID, lease: lease)
            try lease.check()
            guard sessionID == id else { throw RelativesError.consentRequired }
            setStatus(.sharing)
            await withTaskCancellationHandler {
                await waitUntilCancelled()
            } onCancel: {
                lease.revoke()
            }
        } catch {
            lease.revoke()
            failed = status != .stopping
        }
        await transport.stop()
        await interruptionTask?.value
        finishSession(id: id, failed: failed)
    }

    private func finishSession(id: UUID, failed: Bool) {
        guard sessionID == id else { return }
        expirationTask?.cancel()
        expirationTask = nil
        receiver.clear()
        lease = nil
        sessionID = nil
        task = nil
        transport = nil
        interruptionTask = nil
        setStatus(failed ? .failed : .idle)
    }

    public func pause() {
        guard sessionID != nil, status != .stopping else { return }
        lease?.revoke()
        receiver.clear()
        expirationTask?.cancel()
        setStatus(.stopping)
        task?.cancel()
        let transport = transport
        interruptionTask = Task { @MainActor in await transport?.stop() }
    }

    func waitForStop() async { await task?.value }

    private func setStatus(_ status: Status) {
        self.status = status
        onStatusChanged?(status)
    }

    private func scheduleExpiration(at expiry: Date, id: UUID) {
        expirationTask?.cancel()
        expirationTask = Task { @MainActor [weak self] in
            do { try await Task.sleep(for: .seconds(max(0, expiry.timeIntervalSinceNow))) } catch { return }
            guard let self, sessionID == id else { return }
            pause()
        }
    }

    private func waitUntilCancelled() async {
        guard let expiry = lease?.expiresAt else { return }
        try? await Task.sleep(for: .seconds(max(0, expiry.timeIntervalSinceNow)))
    }
}
