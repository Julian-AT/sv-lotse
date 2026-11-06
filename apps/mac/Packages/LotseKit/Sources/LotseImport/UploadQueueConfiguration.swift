import Foundation

public enum UploadQueueConfiguration {
    public static let maximumDocumentBytes = 50 * 1024 * 1024
    public static let keychainService = "dev.svkilotse.mac.upload-queue"
    public static let keychainAccount = "document-encryption-v1"
    public static let directoryName = "SVKILotse/UploadQueue"
}

public enum UploadQueueError: Error {
    case keyUnavailable, invalidDocument, invalidEntry, storageUnavailable
}
