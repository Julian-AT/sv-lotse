// Adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import AppKit

public enum ShortcutMonitorError: Error { case permissionRequired, runLoopUnavailable }

@MainActor
public final class GlobalPushToTalkShortcutMonitor {
    public var onTransition: ((ShortcutTransition) -> Void)?
    private var shortcut: PushToTalkShortcut
    private var eventTap: CFMachPort?
    private var source: CFRunLoopSource?

    public init(shortcut: PushToTalkShortcut = PushToTalkShortcut()) { self.shortcut = shortcut }

    public func start() throws {
        guard eventTap == nil else { return }
        let mask = [CGEventType.flagsChanged, .keyDown, .keyUp].reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        let callback: CGEventTapCallBack = { _, type, event, context in
            guard let context else { return Unmanaged.passUnretained(event) }
            // The event source is installed exclusively on the main run loop.
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
        else { throw ShortcutMonitorError.permissionRequired }
        guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0) else {
            CFMachPortInvalidate(tap)
            throw ShortcutMonitorError.runLoopUnavailable
        }
        eventTap = tap
        self.source = source
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    public func stop() {
        if shortcut.isPressed { onTransition?(.released) }
        shortcut.reset()
        if let source { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        if let eventTap { CFMachPortInvalidate(eventTap) }
        source = nil
        eventTap = nil
    }

    private func handle(type: CGEventType, event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            if shortcut.isPressed { onTransition?(.released) }
            shortcut.reset()
            return
        }
        let transition = shortcut.update(
            type: type, keyCode: UInt16(event.getIntegerValueField(.keyboardEventKeycode)), flags: event.flags
        )
        if transition != .none { onTransition?(transition) }
    }
}
