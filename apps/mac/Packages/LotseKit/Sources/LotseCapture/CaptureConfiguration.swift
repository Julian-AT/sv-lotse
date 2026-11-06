import Foundation

public enum CaptureConfiguration {
    public static let maximumImageDimension = 1280.0
    public static let jpegQuality = 0.8
    public static let recognitionLanguages = ["de-DE", "en-GB"]
    public static let additionalExclusionsKey = "screenCaptureExcludedBundleIdentifiers"

    public static func excludedBundleIdentifiers(preferences: UserDefaults = .standard) throws -> Set<String> {
        guard let url = Bundle.module.url(forResource: "screen-capture-exclusions", withExtension: "json", subdirectory: "Resources") else {
            throw CaptureError.exclusionPolicyUnavailable
        }
        let policy = try JSONDecoder().decode(ExclusionPolicy.self, from: Data(contentsOf: url))
        guard policy.bundleIdentifiers.isEmpty == false else { throw CaptureError.exclusionPolicyUnavailable }
        return Set(policy.bundleIdentifiers + (preferences.stringArray(forKey: additionalExclusionsKey) ?? []))
    }
}

private struct ExclusionPolicy: Decodable {
    let bundleIdentifiers: [String]
}
