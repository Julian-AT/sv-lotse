import AppKit
import AVFoundation
import LiveKit

@MainActor
protocol SharingTransport: AnyObject {
    func start(credentials: RelativesCredentials, displayID: CGDirectDisplayID, lease: SharingLease) async throws
    func stop() async
}

@MainActor
final class LiveKitSharingTransport: SharingTransport {
    private let screen = RelativesScreenStream()
    private let receiver: HelperPointerReceiver
    private let excludedApplications: Set<String>
    private let onEnd: @MainActor () -> Void
    private var delegate: RelativesRoomDelegate?
    private var room: Room?
    private var lease: SharingLease?

    init(receiver: HelperPointerReceiver, excludedApplications: Set<String>, onEnd: @escaping @MainActor () -> Void) {
        self.receiver = receiver
        self.excludedApplications = excludedApplications
        self.onEnd = onEnd
    }

    func start(credentials: RelativesCredentials, displayID: CGDirectDisplayID, lease: SharingLease) async throws {
        self.lease = lease
        try lease.check()
        LiveKitSDK.disableLogging()
        let microphoneAllowed = await AVCaptureDevice.requestAccess(for: .audio)
        try lease.check()
        guard microphoneAllowed, CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            throw RelativesError.captureFailed
        }
        let delegate = RelativesRoomDelegate(receiver: receiver, lease: lease, onEnd: onEnd)
        let room = Room(delegate: delegate)
        self.delegate = delegate
        self.room = room
        try await room.connect(url: credentials.serverUrl.absoluteString, token: credentials.participantToken)
        try lease.check()
        guard room.isRecording == false else { throw RelativesError.recordingNotAllowed }
        try await screen.start(displayID: displayID, excluding: excludedApplications, lease: lease) { [weak self] in
            Task { @MainActor [weak self] in self?.onEnd() }
        }
        try lease.check()
        guard let track = screen.track else { throw RelativesError.captureFailed }
        try await room.localParticipant.publish(videoTrack: track)
        try lease.check()
        try await room.localParticipant.setMicrophone(enabled: true)
        try lease.check()
    }

    func stop() async {
        lease?.revoke()
        receiver.clear()
        // Disconnect unpublishes all local tracks with stopLocalTrackOnUnpublish enabled.
        await room?.disconnect()
        await screen.stop()
    }
}

private final class RelativesRoomDelegate: NSObject, RoomDelegate, Sendable {
    let receiver: HelperPointerReceiver
    let lease: SharingLease
    let onEnd: @MainActor @Sendable () -> Void

    init(receiver: HelperPointerReceiver, lease: SharingLease, onEnd: @escaping @MainActor @Sendable () -> Void) {
        self.receiver = receiver
        self.lease = lease
        self.onEnd = onEnd
    }

    func room(_ room: Room, participant: RemoteParticipant?, didReceiveData data: Data, forTopic topic: String,
              encryptionType: EncryptionType) {
        guard lease.permitsSharing(), let participant, let identity = participant.identity?.stringValue else { return }
        let name = participant.name ?? ""
        Task { @MainActor [receiver, lease] in
            guard lease.permitsSharing() else { return }
            receiver.receive(data: data, identity: identity, name: name, topic: topic)
        }
    }

    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        guard let identity = participant.identity?.stringValue else { return }
        Task { @MainActor [receiver, lease] in
            guard lease.permitsSharing() else { return }
            receiver.disconnect(identity: identity)
        }
    }

    func room(_ room: Room, didUpdateIsRecording isRecording: Bool) {
        if isRecording { end() }
    }

    func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) {
        if connectionState == .disconnected || connectionState == .reconnecting { end() }
    }

    private func end() {
        lease.revoke()
        Task { @MainActor [onEnd] in onEnd() }
    }
}
