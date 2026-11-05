// Adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import AppKit
import ScreenCaptureKit

public struct CompanionScreenCapture: Sendable {
    public let imageData: Data
    public let screenIndex: Int
    public let isCursorScreen: Bool
    public let displayFrame: CGRect
    public let pixelSize: CGSize
    public let displayID: CGDirectDisplayID
}

public enum CaptureError: Error {
    case noDisplay, imageEncodingFailed, exclusionPolicyUnavailable, permissionRequired, focusedDisplayUnavailable
}

public enum CaptureDimensions {
    public static func fitting(width: Int, height: Int) -> CGSize? {
        guard width > 0, height > 0 else { return nil }
        let factor = min(1, CaptureConfiguration.maximumImageDimension / Double(max(width, height)))
        return CGSize(width: max(1, Int(Double(width) * factor)), height: max(1, Int(Double(height) * factor)))
    }
}

@MainActor
public enum CompanionScreenCaptureUtility {
    public static func captureAllScreensAsJPEG(
        excludingBundleIdentifiers excluded: Set<String>, displayID: CGDirectDisplayID? = nil, fullResolution: Bool = false
    ) async throws -> [CompanionScreenCapture] {
        try Task.checkCancellation()
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else { throw CaptureError.permissionRequired }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard content.displays.isEmpty == false else { throw CaptureError.noDisplay }
        let exclusions = CaptureApplicationExclusions(bundleIdentifiers: excluded)
        var frames: [CGDirectDisplayID: CGRect] = [:]
        for screen in NSScreen.screens {
            if let identifier = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID {
                frames[identifier] = screen.frame
            }
        }
        let mouseLocation = NSEvent.mouseLocation
        var captures: [CompanionScreenCapture] = []
        // Deterministic indices also match explicit requests across separate captures.
        let displays = content.displays.sorted { $0.displayID < $1.displayID }
        for (index, display) in displays.enumerated() {
            try Task.checkCancellation()
            if let displayID, display.displayID != displayID { continue }
            guard let size = fullResolution ? CGSize(width: display.width, height: display.height)
                : CaptureDimensions.fitting(width: display.width, height: display.height) else { continue }
            let configuration = SCStreamConfiguration()
            configuration.width = Int(size.width)
            configuration.height = Int(size.height)
            configuration.showsCursor = false
            let filter = exclusions.makeFilter(applications: content.applications) { applications, windows in
                SCContentFilter(display: display, excludingApplications: applications, exceptingWindows: windows)
            }
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            try Task.checkCancellation()
            guard let data = NSBitmapImageRep(cgImage: image).representation(
                using: .jpeg, properties: [.compressionFactor: CaptureConfiguration.jpegQuality]
            ) else {
                throw CaptureError.imageEncodingFailed
            }
            let frame = frames[display.displayID] ?? display.frame
            captures.append(
                .init(
                    imageData: data, screenIndex: index, isCursorScreen: frame.contains(mouseLocation),
                    displayFrame: frame, pixelSize: size, displayID: display.displayID
                ))
        }
        return captures
    }
}

protocol CaptureApplication {
    var bundleIdentifier: String { get }
    var processID: pid_t { get }
}

extension SCRunningApplication: CaptureApplication {}

struct CaptureApplicationExclusions {
    let bundleIdentifiers: Set<String>
    let ownBundleIdentifier: String?
    let ownProcessID: pid_t

    init(
        bundleIdentifiers: Set<String>, ownBundleIdentifier: String? = Bundle.main.bundleIdentifier,
        ownProcessID: pid_t = ProcessInfo.processInfo.processIdentifier
    ) {
        self.bundleIdentifiers = bundleIdentifiers
        self.ownBundleIdentifier = ownBundleIdentifier
        self.ownProcessID = ownProcessID
    }

    func makeFilter<Application: CaptureApplication, Window, Filter>(
        applications: [Application], build: ([Application], [Window]) -> Filter
    ) -> Filter {
        let excluded = applications.filter {
            $0.processID == ownProcessID || $0.bundleIdentifier == ownBundleIdentifier || bundleIdentifiers.contains($0.bundleIdentifier)
        }
        // Application exclusions also cover windows opened after enumeration.
        return build(excluded, [])
    }
}
