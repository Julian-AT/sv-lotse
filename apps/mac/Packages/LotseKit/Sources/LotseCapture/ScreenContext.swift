import CoreGraphics
import CoreML
import Foundation
import LotseProtocol
import Vision

public struct ScreenFocus: Sendable {
    public let displayID: CGDirectDisplayID
    public let globalRect: CGRect

    public init(displayID: CGDirectDisplayID, globalRect: CGRect) {
        self.displayID = displayID
        self.globalRect = globalRect
    }
}

public struct CapturedScreenContext: Sendable {
    public let capture: CompanionScreenCapture
    public let lines: [OcrLine]
}

public enum ScreenOCR {
    public static func recognize(imageData: Data) async throws -> [OcrLine] {
        let task = Task.detached(priority: .userInitiated) {
            try Task.checkCancellation()
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = CaptureConfiguration.recognitionLanguages
            request.usesLanguageCorrection = false
            try perform(request, imageData: imageData)
            try Task.checkCancellation()
            return (request.results ?? []).compactMap { observation -> OcrLine? in
                guard let candidate = observation.topCandidates(1).first else { return nil }
                return OcrLine(bbox: normalizedTopLeftBox(observation.boundingBox), text: candidate.string)
            }.sorted { left, right in
                left.bbox.y == right.bbox.y ? left.bbox.x < right.bbox.x : left.bbox.y < right.bbox.y
            }
        }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }

    public static func normalizedTopLeftBox(_ visionRect: CGRect) -> BoundingBox {
        let rect = visionRect.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard rect.isNull == false else { return BoundingBox(height: 0, width: 0, x: 0, y: 0) }
        return BoundingBox(height: rect.height, width: rect.width, x: rect.minX, y: 1 - rect.maxY)
    }

    private static func perform(_ request: VNRecognizeTextRequest, imageData: Data) throws {
        do {
            try VNImageRequestHandler(data: imageData).perform([request])
        } catch {
            try Task.checkCancellation()
            // A GPU/Neural Engine may be unavailable in a remote session. Retry on a supported CPU.
            let devicesByStage = try request.supportedComputeStageDevices
            var configuredCPU = false
            for (stage, devices) in devicesByStage {
                if let cpu = devices.first(where: { if case .cpu = $0 { return true }; return false }) {
                    request.setComputeDevice(cpu, for: stage)
                    configuredCPU = true
                }
            }
            guard configuredCPU else { throw error }
            try VNImageRequestHandler(data: imageData).perform([request])
        }
    }
}

public enum ScreenContextBuilder {
    public static func capsule(screens: [CapturedScreenContext], focus: ScreenFocus?, language: String) throws -> ContextCapsule {
        let selected: CapturedScreenContext?
        if let focus {
            selected = screens.first { $0.capture.displayID == focus.displayID }
        } else {
            selected = screens.first { $0.capture.isCursorScreen } ?? screens.first
        }
        guard let selected else {
            if focus != nil { throw CaptureError.focusedDisplayUnavailable }
            throw CaptureError.noDisplay
        }
        let region = try focus.map { try focusedBox($0.globalRect, in: selected.capture.displayFrame) }
        let copy = CaptureCopy(english: language.hasPrefix("en"))
        let summary = screens.map { screen in
            let heading = copy.screenHeading(
                screen.capture.screenIndex, selected: screen.capture.screenIndex == selected.capture.screenIndex
            )
            return ([heading] + screen.lines.map(\.text)).joined(separator: "\n")
        }.joined(separator: "\n\n")
        // The frozen v1 capsule has one screen. Other displays retain labeled OCR in summary;
        // structured boxes always belong to the selected screen, never to another monitor.
        return ContextCapsule(
            focusedRegion: region, page: nil,
            screen: Screen(image: nil, ocrLines: selected.lines, screenIndex: selected.capture.screenIndex, summary: summary)
        )
    }

    public static func focusedBox(_ globalRect: CGRect, in frame: CGRect) throws -> BoundingBox {
        let clipped = globalRect.intersection(frame)
        guard frame.width > 0, frame.height > 0, clipped.isNull == false, clipped.isEmpty == false else {
            throw CaptureError.focusedDisplayUnavailable
        }
        return BoundingBox(
            height: clipped.height / frame.height, width: clipped.width / frame.width,
            x: (clipped.minX - frame.minX) / frame.width, y: (frame.maxY - clipped.maxY) / frame.height
        )
    }
}

@MainActor
public enum ScreenContextCapture {
    public static func capture(focus: ScreenFocus? = nil, language: String) async throws -> ContextCapsule {
        try Task.checkCancellation()
        let exclusions = try CaptureConfiguration.excludedBundleIdentifiers()
        let captures = try await CompanionScreenCaptureUtility.captureAllScreensAsJPEG(excludingBundleIdentifiers: exclusions)
        var screens: [CapturedScreenContext] = []
        for capture in captures {
            try Task.checkCancellation()
            let lines = try await ScreenOCR.recognize(imageData: capture.imageData)
            screens.append(CapturedScreenContext(capture: capture, lines: lines))
        }
        try Task.checkCancellation()
        return try ScreenContextBuilder.capsule(screens: screens, focus: focus, language: language)
    }
}
