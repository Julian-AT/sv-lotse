// Adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import AppKit
import IOKit.hid
import os

public enum ShortcutMonitorError: Error { case permissionRequired, runLoopUnavailable }

@MainActor
public final class GlobalPushToTalkShortcutMonitor {
    public var onTransition: ((ShortcutTransition) -> Void)?
    private var shortcut: PushToTalkShortcut
    private var eventTap: CFMachPort?
    private var source: CFRunLoopSource?
    private let name: String
    private var gate = ShortcutHoldGate()
    private var pendingPress: Task<Void, Never>?
    private let log = Logger(subsystem: "dev.svkilotse.mac", category: "voice")

    public init(shortcut: PushToTalkShortcut = PushToTalkShortcut(), name: String = "push-to-talk") {
        self.shortcut = shortcut
        self.name = name
    }

    public var isRunning: Bool { eventTap != nil }

    /// Live Input Monitoring state; the cached settings value can lag behind System Settings.
    public static var inputMonitoringGranted: Bool {
        IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) == kIOHIDAccessTypeGranted
    }

    public func configure(shortcut: PushToTalkShortcut) {
        // The shell cancels the old hold before replacing its shortcut.
        self.shortcut = shortcut
        self.shortcut.reset()
        pendingPress?.cancel()
        pendingPress = nil
        gate = ShortcutHoldGate()
    }

    public func start() throws {
        guard eventTap == nil else { return }
        let mask = [CGEventType.flagsChanged, .keyDown, .keyUp].reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        let callback: CGEventTapCallBack = { _, type, event, context in
            guard let context else { return Unmanaged.passUnretained(event) }
            MainActor.assumeIsolated {
                let monitor = Unmanaged<GlobalPushToTalkShortcutMonitor>.fromOpaque(context).takeUnretainedValue()
                monitor.handle(type: type, event: event)
            }
            return Unmanaged.passUnretained(event)
        }
        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                eventsOfInterest: mask, callback: callback, userInfo: Unmanaged.passUnretained(self).toOpaque()
            )
        else {
            let granted = Self.inputMonitoringGranted
            log.error("\(self.name, privacy: .public) event tap creation failed (input monitoring: \(granted, privacy: .public))")
            throw ShortcutMonitorError.permissionRequired
        }
        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            CFMachPortInvalidate(tap)
            log.error("\(self.name, privacy: .public) event tap run-loop source failed")
            throw ShortcutMonitorError.runLoopUnavailable
        }
        eventTap = tap
        self.source = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        log.notice("\(self.name, privacy: .public) event tap started")
    }

    /// Re-enables a tap that the system disabled. Returns true when it had to.
    @discardableResult
    public func ensureEnabled() -> Bool {
        guard let eventTap, CGEvent.tapIsEnabled(tap: eventTap) == false else { return false }
        CGEvent.tapEnable(tap: eventTap, enable: true)
        log.notice("\(self.name, privacy: .public) event tap re-enabled")
        return true
    }

    public func stop() {
        pendingPress?.cancel()
        pendingPress = nil
        if gate.receive(.cancelled) == .cancelled || (shortcut.keyCode != nil && shortcut.isPressed) {
            onTransition?(.cancelled)
        }
        gate = ShortcutHoldGate()
        shortcut.reset()
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let eventTap {
            CFMachPortInvalidate(eventTap)
            log.notice("\(self.name, privacy: .public) event tap stopped")
        }
        source = nil
        eventTap = nil
    }

    func handle(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            log.notice("\(self.name, privacy: .public) event tap disabled by the system (\(type.rawValue, privacy: .public)); re-enabling")
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            if shortcut.isPressed { deliver(.cancelled) }
            shortcut.reset()
            return
        }
        let transition = shortcut.update(
            type: type, keyCode: UInt16(event.getIntegerValueField(.keyboardEventKeycode)), flags: event.flags,
            isAutorepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0
        )
        deliver(transition)
    }

    private func deliver(_ transition: ShortcutTransition) {
        // A modifier-only chord must be held briefly so quick ⌥⌘ shortcuts never start capture.
        guard shortcut.keyCode == nil else {
            if transition != .none { onTransition?(transition) }
            return
        }
        let output = gate.receive(transition)
        if gate.isPending {
            pendingPress?.cancel()
            pendingPress = Task { @MainActor [weak self] in
                try? await Task.sleep(for: ShortcutHoldGate.holdDelay)
                guard let self, Task.isCancelled == false else { return }
                if gate.confirm() == .pressed { onTransition?(.pressed) }
            }
        } else {
            pendingPress?.cancel()
            pendingPress = nil
        }
        if output != .none { onTransition?(output) }
    }
}

/// Delays a modifier-only press until it has been held for `holdDelay`; a release or another key
/// before then is swallowed, so nothing is captured or sent.
public struct ShortcutHoldGate: Equatable, Sendable {
    public static let holdDelay: Duration = .milliseconds(150)
    public private(set) var isPending = false
    public private(set) var isActive = false

    public init() {}

    /// Returns the transition to deliver now.
    public mutating func receive(_ transition: ShortcutTransition) -> ShortcutTransition {
        switch transition {
        case .pressed:
            isPending = true
            isActive = false
            return .none
        case .released, .cancelled:
            let wasActive = isActive
            isPending = false
            isActive = false
            return wasActive ? transition : .none
        case .none:
            return .none
        }
    }

    /// Called once the hold delay passed; returns `.pressed` when the chord is still held.
    public mutating func confirm() -> ShortcutTransition {
        guard isPending else { return .none }
        isPending = false
        isActive = true
        return .pressed
    }
}
