import CoreGraphics
import Foundation
import Testing

@testable import LotseCapture

@Test("FR-C3 capture preserves aspect ratio within its pixel budget")
func captureDimensions() {
    #expect(CaptureDimensions.fitting(width: 3840, height: 2160) == CGSize(width: 1280, height: 720))
    #expect(CaptureDimensions.fitting(width: 1080, height: 1920) == CGSize(width: 720, height: 1280))
    #expect(CaptureDimensions.fitting(width: 0, height: 0) == nil)
}

@Test("FR-C2 capture excludes sensitive applications without taking a window snapshot")
func captureApplicationFilter() {
    let applications = [
        CaptureTestApplication(bundleIdentifier: "test.sensitive", processID: 10),
        CaptureTestApplication(bundleIdentifier: "test.sensitive", processID: 11),
        CaptureTestApplication(bundleIdentifier: "test.lotse", processID: 20),
        CaptureTestApplication(bundleIdentifier: "test.helper", processID: 21),
        CaptureTestApplication(bundleIdentifier: "test.allowed", processID: 30)
    ]
    let exclusions = CaptureApplicationExclusions(
        bundleIdentifiers: ["test.sensitive"], ownBundleIdentifier: "test.lotse", ownProcessID: 21
    )
    let filter = exclusions.makeFilter(applications: applications) { (excluded: [CaptureTestApplication], exceptions: [UInt32]) in
        (applications: excluded, windows: exceptions)
    }
    #expect(filter.applications.map(\.processID) == [10, 11, 20, 21])
    #expect(filter.windows.isEmpty)
}

@Test("FR-C2 capture always excludes its own process even without a bundle identifier")
func captureOwnProcessFilter() {
    let application = CaptureTestApplication(bundleIdentifier: "test.unbundled", processID: 42)
    let exclusions = CaptureApplicationExclusions(bundleIdentifiers: [], ownBundleIdentifier: nil, ownProcessID: 42)
    let filter = exclusions.makeFilter(applications: [application]) { (excluded: [CaptureTestApplication], exceptions: [UInt32]) in
        (applications: excluded, windows: exceptions)
    }
    #expect(filter.applications.map(\.processID) == [42])
    #expect(filter.windows.isEmpty)
}

private struct CaptureTestApplication: CaptureApplication {
    let bundleIdentifier: String
    let processID: pid_t
}
