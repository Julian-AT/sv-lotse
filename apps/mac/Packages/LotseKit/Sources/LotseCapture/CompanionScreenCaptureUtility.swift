// Adapted from Clicky. See THIRD_PARTY_NOTICES.md.
import AppKit
import ScreenCaptureKit

public struct CompanionScreenCapture: Sendable {
    public let imageData: Data
    public let screenIndex: Int
    public let isCursorScreen: Bool
    public let displayFrame: CGRect
    public let pixelSize: CGSize
}

public enum CaptureError: Error { case noDisplay, imageEncodingFailed }

public enum CaptureDimensions {
    public static func fitting(width: Int, height: Int) -> CGSize? {
        guard width > 0, height > 0 else { return nil }
        let factor = min(1, 1280 / Double(max(width, height)))
        return CGSize(width: max(1, Int(Double(width) * factor)), height: max(1, Int(Double(height) * factor)))
    }
}

@MainActor
public enum CompanionScreenCaptureUtility {
    /// Only call after a hotkey or explicit user request. Never poll or capture at launch.
    /// Callers supply the configured sensitive-app exclusion list; our own application is always excluded.
    public static func captureAllScreensAsJPEG(excludingBundleIdentifiers excluded: Set<String>) async throws -> [CompanionScreenCapture] {
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
        for (index, display) in content.displays.enumerated() {
            guard let size = CaptureDimensions.fitting(width: display.width, height: display.height) else { continue }
            let configuration = SCStreamConfiguration()
            configuration.width = Int(size.width)
            configuration.height = Int(size.height)
            configuration.showsCursor = false
            let filter = exclusions.makeFilter(applications: content.applications) { applications, windows in
                SCContentFilter(display: display, excludingApplications: applications, exceptingWindows: windows)
            }
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            guard let data = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
                throw CaptureError.imageEncodingFailed
            }
            let frame = frames[display.displayID] ?? display.frame
            captures.append(
                .init(
                    imageData: data, screenIndex: index, isCursorScreen: frame.contains(mouseLocation),
                    displayFrame: frame, pixelSize: size
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
        // Application exclusions also cover windows opened after enumeration. No window may opt back in.
        return build(excluded, [])
    }
}
