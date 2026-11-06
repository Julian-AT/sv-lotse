import AppKit
import SwiftUI
import Testing

@testable import LotseCore

@MainActor
@Test("Brand logo loads from the native resource bundle in full colour")
func brandLogoResource() throws {
    let image = try #require(LotseBrand.image(size: 32, description: "SV KI-Lotse"))
    #expect(image.size == NSSize(width: 32, height: 32))
    #expect(image.isTemplate == false)
    #expect(image.accessibilityDescription == "SV KI-Lotse")
}

@Test("Native brand green matches the official sRGB artwork")
func brandColor() throws {
    let color = try #require(NSColor(Color.lotseBrand).usingColorSpace(.sRGB))
    #expect(abs(color.redComponent) < 0.001)
    #expect(abs(color.greenComponent - 142.0 / 255) < 0.001)
    #expect(abs(color.blueComponent - 92.0 / 255) < 0.001)
}
