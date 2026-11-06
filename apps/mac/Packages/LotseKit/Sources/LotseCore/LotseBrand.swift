import AppKit
import CoreImage
import LotseOverlay
import SwiftUI

public extension Color {
    /// Exact modal green from the official SV raster: #008E5C (sRGB).
    static let lotseBrand = OverlayPalette.brand
    static let lotseBrandHover = Color(.sRGB, red: 0, green: 123 / 255, blue: 80 / 255, opacity: 1)
    static let lotseBrandPressed = Color(.sRGB, red: 0, green: 109 / 255, blue: 71 / 255, opacity: 1)
    /// Adaptive AA text; the original green has only 4.18:1 contrast on white.
    static let lotseBrandText = Color(nsColor: NSColor(name: nil) { appearance in
        let dark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        return dark
            ? NSColor(srgbRed: 120 / 255, green: 219 / 255, blue: 173 / 255, alpha: 1)
            : NSColor(srgbRed: 0, green: 109 / 255, blue: 71 / 255, alpha: 1)
    })
}

@MainActor
enum LotseBrand {
    static func statusImage(description: String) -> NSImage? {
        guard let source = image(size: 18, description: description),
              let data = source.tiffRepresentation, let input = CIImage(data: data),
              let filter = CIFilter(name: "CIColorMatrix") else { return nil }
        filter.setValue(input, forKey: kCIInputImageKey)
        // Knock the white SV lettering out of the green silhouette for a legible template.
        filter.setValue(CIVector(x: 0, y: 0, z: 0, w: 0), forKey: "inputRVector")
        filter.setValue(CIVector(x: 0, y: 0, z: 0, w: 0), forKey: "inputGVector")
        filter.setValue(CIVector(x: 0, y: 0, z: 0, w: 0), forKey: "inputBVector")
        filter.setValue(CIVector(x: -2, y: 2, z: 0, w: 0), forKey: "inputAVector")
        guard let output = filter.outputImage else { return nil }
        let result = NSImage(size: NSSize(width: 18, height: 18))
        result.addRepresentation(NSCIImageRep(ciImage: output))
        result.isTemplate = true
        result.accessibilityDescription = description
        return result
    }

    static func image(size: CGFloat, description: String) -> NSImage? {
        guard let url = Bundle.module.url(forResource: "sv-logo", withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return nil }
        image.size = NSSize(width: size, height: size)
        image.isTemplate = false
        image.accessibilityDescription = description
        return image
    }
}
