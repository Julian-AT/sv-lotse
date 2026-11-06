import AppKit
import LiveKit
import ScreenCaptureKit

@MainActor
final class RelativesScreenStream {
    private var stream: SCStream?
    private var output: SharedScreenOutput?
    private(set) var track: LocalVideoTrack?

    func start(displayID: CGDirectDisplayID, excluding bundles: Set<String>, lease: SharingLease,
               onFailure: @escaping @Sendable () -> Void) async throws {
        try lease.check()
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        try lease.check()
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else { throw RelativesError.noDisplay }
        let excluded = content.applications.filter {
            $0.processID == ProcessInfo.processInfo.processIdentifier || $0.bundleIdentifier == Bundle.main.bundleIdentifier ||
                bundles.contains($0.bundleIdentifier)
        }
        let filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
        let configuration = SCStreamConfiguration()
        let factor = min(1, Double(RelativesConfiguration.maximumDimension) / Double(max(display.width, display.height)))
        configuration.width = max(2, Int(Double(display.width) * factor) / 2 * 2)
        configuration.height = max(2, Int(Double(display.height) * factor) / 2 * 2)
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: Int32(RelativesConfiguration.framesPerSecond))
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = true
        configuration.capturesAudio = false
        let track = await LocalVideoTrack.createBufferTrack()
        try lease.check()
        guard let capturer = track.capturer as? BufferCapturer else { throw RelativesError.captureFailed }
        let output = SharedScreenOutput(capturer: capturer, lease: lease, onFailure: onFailure)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: output)
        try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: DispatchQueue(label: "dev.svkilotse.relatives.screen"))
        self.track = track
        self.output = output
        self.stream = stream
        try lease.check()
        try await stream.startCapture()
        try lease.check()
    }

    func stop() async {
        // Retain the stream until this transport is released: startup may still be resuming from startCapture.
        // Its final cleanup can then stop a stream that completed starting after an earlier stop request.
        try? await stream?.stopCapture()
        try? await track?.stop()
    }
}

private final class SharedScreenOutput: NSObject, SCStreamOutput, SCStreamDelegate, Sendable {
    let capturer: BufferCapturer
    let lease: SharingLease
    let onFailure: @Sendable () -> Void

    init(capturer: BufferCapturer, lease: SharingLease, onFailure: @escaping @Sendable () -> Void) {
        self.capturer = capturer
        self.lease = lease
        self.onFailure = onFailure
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, lease.permitsSharing(), RelativesScreenFrame.isComplete(sampleBuffer) else { return }
        capturer.capture(sampleBuffer)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        lease.revoke()
        onFailure()
    }
}

enum RelativesScreenFrame {
    static func isComplete(_ sampleBuffer: CMSampleBuffer) -> Bool {
        guard sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false)
                as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int else { return false }
        return status == SCFrameStatus.complete.rawValue
    }
}
