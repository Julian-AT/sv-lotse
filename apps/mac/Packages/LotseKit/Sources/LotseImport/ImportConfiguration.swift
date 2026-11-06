import Foundation

public enum ImportConfiguration {
    public static let maximumBytes = 20 * 1024 * 1024
    public static let maximumQueuedBytes = 200 * 1024 * 1024
    public static let maximumPages = 50
    public static let retryInterval: Duration = .seconds(30)
    public static let requestTimeout: TimeInterval = 45
    public static let endpointPath = "/api/documents"
    public static let keychainService = "dev.svkilotse.document-upload"
    public static let keychainAccount = "queue-aes256-v1"
    public static let queueDirectory = "SVKILotse/UploadQueue"
    public static let encryptedExtension = "lotsequeue"

    public static func directory() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true).appendingPathComponent(queueDirectory)
    }
}

public enum DocumentImportError: Error, Sendable {
    case unsupportedType, tooLarge, queueFull, invalidDocument, keychainUnavailable
    case damagedQueue, uploadRejected, unavailable, sessionChanged, sessionRequired, busy
}
