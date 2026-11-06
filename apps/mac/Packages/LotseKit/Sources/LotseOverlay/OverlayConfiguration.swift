import Foundation

public enum OverlayConfiguration {
    public static let minimumSelectionSize = 4.0
    public static let selectionStrokeWidth = 3.0
    public static let maximumFlightDuration: TimeInterval = 0.48
    public static let minimumFlightDuration: TimeInterval = 0.18
    public static let flightPointsPerSecond = 4000.0
    public static let frameInterval: Duration = .milliseconds(16)
    public static let stepLifetime: Duration = .seconds(8)
    public static let captionWidth = 360.0
}
