import Foundation

public enum VoiceCopy {
    public static let speedMenuTitle = "Sprechtempo"
    public static let speedMenuTitleEnglish = "Speech speed"
    public static func speedTitle(_ speed: Double) -> String { String(format: "%.2g×", speed) }
}
