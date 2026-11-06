import SwiftUI

/// Shared native palette matching @lotse/ui brand tokens in sRGB.
public enum OverlayPalette {
    public static let brand = Color(.sRGB, red: 0, green: 142 / 255, blue: 92 / 255, opacity: 1)
    public static let helper = Color(.sRGB, red: 120 / 255, green: 219 / 255, blue: 173 / 255, opacity: 1)
    /// brand-pressed (#006D47): the companion's speech bubble; white text on it exceeds 4.5:1.
    public static let bubble = Color(.sRGB, red: 0, green: 109 / 255, blue: 71 / 255, opacity: 1)
    /// White on the exact brand green is below AA; this ink exceeds 4.5:1 on both greens.
    public static let onBrand = Color(.sRGB, red: 0, green: 16 / 255, blue: 8 / 255, opacity: 1)
}
