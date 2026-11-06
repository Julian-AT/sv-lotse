import AppKit
import SwiftUI
import Testing

@testable import LotseOverlay

@Test("Companion green matches the brand and the helper uses its lighter tint")
func overlayBrandColors() throws {
    let brand = try #require(NSColor(OverlayPalette.brand).usingColorSpace(.sRGB))
    let helper = try #require(NSColor(OverlayPalette.helper).usingColorSpace(.sRGB))
    #expect(abs(brand.redComponent) < 0.001)
    #expect(abs(brand.greenComponent - 142.0 / 255) < 0.001)
    #expect(abs(brand.blueComponent - 92.0 / 255) < 0.001)
    #expect(abs(helper.redComponent - 120.0 / 255) < 0.001)
    #expect(abs(helper.greenComponent - 219.0 / 255) < 0.001)
    #expect(abs(helper.blueComponent - 173.0 / 255) < 0.001)
}

@Test("Companion captions, numbered markers and helper labels keep AA contrast on green")
func overlayLabelContrast() throws {
    let ink = try relativeLuminance(OverlayPalette.onBrand)
    for background in [OverlayPalette.brand, OverlayPalette.helper] {
        let luminance = try relativeLuminance(background)
        #expect((luminance + 0.05) / (ink + 0.05) >= 4.5)
    }
}

private func relativeLuminance(_ color: Color) throws -> Double {
    let rgb = try #require(NSColor(color).usingColorSpace(.sRGB))
    func linear(_ channel: Double) -> Double {
        channel <= 0.04045 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * linear(rgb.redComponent) + 0.7152 * linear(rgb.greenComponent)
        + 0.0722 * linear(rgb.blueComponent)
}
