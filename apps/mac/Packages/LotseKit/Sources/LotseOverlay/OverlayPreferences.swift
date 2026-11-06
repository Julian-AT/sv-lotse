import Foundation

public enum OverlayPreferenceKey {
    public static let cursorSize = "lotseCursorSize"
    public static let cursorSpeed = "lotseCursorSpeed"
    public static let reducedMotion = "lotseReducedMotion"
}

public enum CursorSize: String, CaseIterable, Sendable {
    case standard, large, extraLarge

    public var scale: Double {
        switch self {
        case .standard: 1
        case .large: 1.5
        case .extraLarge: 2
        }
    }
}

public enum CursorSpeed: String, CaseIterable, Sendable {
    case slow, standard, fast

    public var multiplier: Double {
        switch self {
        case .slow: 0.5
        case .standard: 1
        case .fast: 1.5
        }
    }
}

public enum OverlayCopy {
    public static let sizeTitle = "Zeigergröße"
    public static let speedTitle = "Zeigergeschwindigkeit"
    public static let reducedMotion = "Weniger Zeigerbewegung"
    public static let sizes: [CursorSize: String] = [.standard: "Normal", .large: "Groß", .extraLarge: "Sehr groß"]
    public static let speeds: [CursorSpeed: String] = [.slow: "Langsam", .standard: "Normal", .fast: "Schnell"]
}
