import Foundation

public enum GuidedWindowError: Error {
    case missingBundle, notReady, navigationChanged, invalidResult, approvalDeclined, approvalRequired, busy,
        unsupportedAction
}

public enum GuidedWindowResources {
    public static func guideSource() throws -> String {
        guard let url = Bundle.module.url(forResource: "guide", withExtension: "deflate", subdirectory: "Resources/generated") else {
            throw GuidedWindowError.missingBundle
        }
        let source = try NSData(contentsOf: url).decompressed(using: .zlib)
        guard source.count <= GuidedWindowConfiguration.maximumGuideBytes,
            let script = String(data: source as Data, encoding: .utf8)
        else { throw GuidedWindowError.missingBundle }
        return script
    }

    /// Generated from packages/knowledge/allowlist.yaml; no portal domain is coded in Swift.
    public static func originPolicy() throws -> GuidedOriginPolicy {
        guard let url = Bundle.module.url(forResource: "origins", withExtension: "json", subdirectory: "Resources/generated") else {
            throw GuidedWindowError.missingBundle
        }
        return try GuidedOriginPolicy(origins: JSONDecoder().decode([String].self, from: Data(contentsOf: url)))
    }
}
