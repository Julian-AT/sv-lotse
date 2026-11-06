import Foundation

public enum ImportCapturePolicy {
    public static func excludedApplications(environment: [String: String] = ProcessInfo.processInfo.environment) throws -> Set<String> {
        struct Policy: Decodable { let bundleIdentifiers: [String] }
        guard let url = Bundle.module.url(forResource: "mac-capture-exclusions", withExtension: "json"),
            let policy = try? JSONDecoder().decode(Policy.self, from: Data(contentsOf: url)),
            policy.bundleIdentifiers.isEmpty == false
        else { throw DocumentImportError.invalidDocument }
        let additional = (environment["LOTSE_CAPTURE_EXCLUDED_BUNDLE_IDS"] ?? "").split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { $0.isEmpty == false }
        return Set(policy.bundleIdentifiers + additional)
    }
}
