import Foundation
import os

public enum PushToTalkMonitorStatus: Equatable, Sendable {
    case off, waitingForPermission, running
    case failed(String)
}

/// Keeps the push-to-talk event tap running: starts it as soon as Input Monitoring is granted,
/// re-enables a tap the system disabled and retries a failed start on every tick.
@MainActor
public final class PushToTalkMonitorSupervisor {
    public struct Hooks {
        public var accessGranted: @MainActor () -> Bool
        public var isRunning: @MainActor () -> Bool
        public var start: @MainActor () throws -> Void
        public var stop: @MainActor () -> Void
        public var ensureEnabled: @MainActor () -> Void

        public init(
            accessGranted: @escaping @MainActor () -> Bool, isRunning: @escaping @MainActor () -> Bool,
            start: @escaping @MainActor () throws -> Void, stop: @escaping @MainActor () -> Void,
            ensureEnabled: @escaping @MainActor () -> Void
        ) {
            self.accessGranted = accessGranted
            self.isRunning = isRunning
            self.start = start
            self.stop = stop
            self.ensureEnabled = ensureEnabled
        }
    }

    public static let pollInterval: TimeInterval = 2
    public private(set) var status: PushToTalkMonitorStatus = .off
    public var onStatusChanged: ((PushToTalkMonitorStatus) -> Void)?
    public var enabled = false
    private let hooks: Hooks
    private var timer: Timer?
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")

    public init(hooks: Hooks) { self.hooks = hooks }

    public func startPolling() {
        guard timer == nil else { return }
        timer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) { _ in
            MainActor.assumeIsolated { [weak self] in self?.tick() }
        }
    }

    public func stopPolling() {
        timer?.invalidate()
        timer = nil
    }

    /// One reconciliation step; the shell calls it on every poll and whenever settings change.
    public func tick() {
        guard enabled else {
            if hooks.isRunning() { hooks.stop() }
            update(.off)
            return
        }
        guard hooks.accessGranted() else {
            if hooks.isRunning() { hooks.stop() }
            update(.waitingForPermission)
            return
        }
        if hooks.isRunning() {
            hooks.ensureEnabled()
            update(.running)
            return
        }
        do {
            try hooks.start()
            update(.running)
        } catch {
            hooks.stop()
            update(.failed(String(describing: error)))
        }
    }

    private func update(_ next: PushToTalkMonitorStatus) {
        guard next != status else { return }
        status = next
        log.notice("Push-to-talk monitor: \(String(describing: next), privacy: .public)")
        onStatusChanged?(next)
    }
}
