import Foundation
import Testing

@testable import LotseVoice

@MainActor
private final class FakeTap {
    var granted = false
    var running = false
    var failStart = false
    var starts = 0
    var stops = 0
    var reenables = 0

    lazy var supervisor = PushToTalkMonitorSupervisor(hooks: .init(
        accessGranted: { [unowned self] in granted },
        isRunning: { [unowned self] in running },
        start: { [unowned self] in
            starts += 1
            if failStart { throw ShortcutMonitorError.permissionRequired }
            running = true
        },
        stop: { [unowned self] in
            stops += 1
            running = false
        },
        ensureEnabled: { [unowned self] in reenables += 1 }
    ))
}

@Test("Push-to-talk monitor starts as soon as Input Monitoring becomes granted")
@MainActor
func monitorStartsWhenGranted() {
    let tap = FakeTap()
    tap.supervisor.enabled = true
    tap.supervisor.tick()
    #expect(tap.supervisor.status == .waitingForPermission)
    #expect(tap.starts == 0)
    tap.granted = true
    tap.supervisor.tick()
    #expect(tap.supervisor.status == .running)
    #expect(tap.starts == 1)
    tap.supervisor.tick()
    #expect(tap.starts == 1)
    #expect(tap.reenables == 1)
}

@Test("Push-to-talk monitor retries a failed tap and reports the failure")
@MainActor
func monitorRetriesFailure() {
    let tap = FakeTap()
    tap.granted = true
    tap.failStart = true
    tap.supervisor.enabled = true
    var statuses: [PushToTalkMonitorStatus] = []
    tap.supervisor.onStatusChanged = { statuses.append($0) }
    tap.supervisor.tick()
    guard case .failed = tap.supervisor.status else {
        Issue.record("expected failed status")
        return
    }
    tap.failStart = false
    tap.supervisor.tick()
    #expect(tap.supervisor.status == .running)
    #expect(tap.starts == 2)
    #expect(statuses.count == 2)
}

@Test("Push-to-talk monitor stops when disabled or permission is revoked")
@MainActor
func monitorStopsWhenDisabled() {
    let tap = FakeTap()
    tap.granted = true
    tap.supervisor.enabled = true
    tap.supervisor.tick()
    tap.granted = false
    tap.supervisor.tick()
    #expect(tap.supervisor.status == .waitingForPermission)
    #expect(tap.running == false)
    tap.granted = true
    tap.supervisor.tick()
    tap.supervisor.enabled = false
    tap.supervisor.tick()
    #expect(tap.supervisor.status == .off)
    #expect(tap.running == false)
}

@Test("Microphone level maps RMS to 0...1")
func levelNormalization() {
    #expect(VoiceInputLevel.normalized(rms: 0) == 0)
    #expect(VoiceInputLevel.normalized(rms: 1) == 1)
    #expect(VoiceInputLevel.normalized(rms: 0.001) == 0)
}
