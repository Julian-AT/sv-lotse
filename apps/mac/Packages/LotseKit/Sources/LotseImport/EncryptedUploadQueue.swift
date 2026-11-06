import CryptoKit
import Foundation

public struct QueuedUpload: Codable, Sendable {
    public let id: UUID
    public let createdAt: Date
    public let payload: ImportPayload
    public let workspaceOrigin: String
    public let sessionID: String?

    public var filename: String { payload.filename }
    public var mimeType: String { payload.mimeType }
    public var data: Data { payload.data }
}

extension QueuedUpload {
    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(UUID.self, forKey: .id)
        if container.contains(.payload) {
            createdAt = try container.decode(Date.self, forKey: .createdAt)
            payload = try container.decode(ImportPayload.self, forKey: .payload)
            workspaceOrigin = try container.decode(String.self, forKey: .workspaceOrigin)
            sessionID = try container.decodeIfPresent(String.self, forKey: .sessionID)
        } else {
            createdAt = .distantPast
            payload = try ImportPayload(from: decoder)
            workspaceOrigin = ""
            sessionID = nil
        }
    }
}

/// A sealed guided-window download that waits for the import preview (FR-D1).
public struct GuidedDownload: Codable, Sendable {
    public let id: UUID
    public let filename: String
    public let mimeType: String
    public let data: Data

    /// The common preview boundary: only readable PDFs and images become an import payload.
    @MainActor
    public func payload() throws -> ImportPayload { try ImportPayload(documentData: data, filename: filename) }
}

public actor EncryptedUploadQueue {
    private let directory: URL
    private let key: SymmetricKey
    private let downloadKey: SymmetricKey

    public init(directory: URL? = nil, encryptionKey: SymmetricKey? = nil) throws {
        self.directory = try directory ?? ImportConfiguration.directory()
        key = try encryptionKey ?? UploadQueueKey.loadOrCreate()
        downloadKey = try encryptionKey ?? UploadQueueKey.load()
        try Self.prepare(self.directory)
    }

    init(directory: URL, key: SymmetricKey) throws {
        self.directory = directory
        self.key = key
        downloadKey = key
        try Self.prepare(directory)
    }

    private static func prepare(_ directory: URL) throws {
        guard directory.isFileURL else { throw UploadQueueError.storageUnavailable }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                attributes: [.posixPermissions: 0o700])
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
        var excluded = directory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try excluded.setResourceValues(values)
    }

    @discardableResult
    public func enqueue(_ payload: ImportPayload, workspaceOrigin: String, sessionID: String?) throws -> UUID {
        let files = try files()
        let used = try files.reduce(0) { try $0 + $1.resourceValues(forKeys: [.fileSizeKey]).fileSize.unwrapSize() }
        // JSON base64 adds one third to the encrypted document size.
        guard used + payload.data.count * 4 / 3 < ImportConfiguration.maximumQueuedBytes else {
            throw DocumentImportError.queueFull
        }
        let record = QueuedUpload(id: UUID(), createdAt: Date(), payload: payload,
                                  workspaceOrigin: workspaceOrigin, sessionID: sessionID)
        let encrypted = try AES.GCM.seal(JSONEncoder().encode(record), using: key, authenticating: Data(record.id.uuidString.utf8))
        guard let bytes = encrypted.combined else { throw DocumentImportError.damagedQueue }
        let destination = file(for: record.id)
        try bytes.write(to: destination, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
        return record.id
    }

    public func pending() throws -> [QueuedUpload] {
        try files().map { url in
            do {
                guard let id = UUID(uuidString: url.deletingPathExtension().lastPathComponent) else {
                    throw DocumentImportError.damagedQueue
                }
                let box = try AES.GCM.SealedBox(combined: Data(contentsOf: url))
                let data = try AES.GCM.open(box, using: key, authenticating: Data(id.uuidString.utf8))
                let record = try JSONDecoder().decode(QueuedUpload.self, from: data)
                guard record.id == id else { throw DocumentImportError.damagedQueue }
                return record
            } catch { throw DocumentImportError.damagedQueue }
        }.sorted { $0.createdAt < $1.createdAt }
    }

    public func remove(_ id: UUID) throws { try FileManager.default.removeItem(at: file(for: id)) }

    public func count() throws -> Int { try files().count }

    public func confirmSession(_ id: UUID, origin: String, sessionID: String) throws {
        guard let old = try pending().first(where: { $0.id == id }), old.workspaceOrigin == origin else {
            throw DocumentImportError.sessionChanged
        }
        let record = QueuedUpload(id: old.id, createdAt: old.createdAt, payload: old.payload,
                                  workspaceOrigin: origin, sessionID: sessionID)
        let sealed = try AES.GCM.seal(JSONEncoder().encode(record), using: key,
                                      authenticating: Data(id.uuidString.utf8))
        guard let bytes = sealed.combined else { throw DocumentImportError.damagedQueue }
        try bytes.write(to: file(for: id), options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file(for: id).path)
    }

    @discardableResult
    public func enqueue(_ document: ImportDocument, filename: String, mimeType: String) throws -> UUID {
        guard document.byteCount <= UploadQueueConfiguration.maximumDocumentBytes else {
            throw UploadQueueError.invalidDocument
        }
        let data: Data
        do { data = try Data(contentsOf: document.url) } catch { throw UploadQueueError.storageUnavailable }
        return try enqueueDownload(filename: filename, mimeType: mimeType, data: data)
    }

    /// Seals a guided download until the user confirms or discards its import preview.
    @discardableResult
    public func enqueueDownload(filename: String, mimeType: String, data: Data) throws -> UUID {
        guard data.isEmpty == false, data.count <= UploadQueueConfiguration.maximumDocumentBytes else {
            throw UploadQueueError.invalidDocument
        }
        do {
            let entry = GuidedDownload(id: UUID(), filename: filename, mimeType: mimeType, data: data)
            let sealed = try AES.GCM.seal(JSONEncoder().encode(entry), using: downloadKey)
            guard let encrypted = sealed.combined else { throw UploadQueueError.storageUnavailable }
            let destination = location(entry.id)
            try encrypted.write(to: destination, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
            return entry.id
        } catch let error as UploadQueueError { throw error } catch { throw UploadQueueError.storageUnavailable }
    }

    public func pendingIDs() throws -> [UUID] {
        do {
            return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                .filter { $0.pathExtension == "sealed" }
                .compactMap { UUID(uuidString: $0.deletingPathExtension().lastPathComponent) }
                .sorted { $0.uuidString < $1.uuidString }
        } catch { throw UploadQueueError.storageUnavailable }
    }

    public func read(_ id: UUID) throws -> GuidedDownload {
        do {
            let encrypted = try Data(contentsOf: location(id))
            let plaintext = try AES.GCM.open(AES.GCM.SealedBox(combined: encrypted), using: downloadKey)
            let entry = try JSONDecoder().decode(GuidedDownload.self, from: plaintext)
            guard entry.id == id else { throw UploadQueueError.invalidEntry }
            return entry
        } catch { throw UploadQueueError.invalidEntry }
    }

    /// Removes a sealed download once its confirmed preview is in the upload queue, or on discard.
    public func acknowledgeUpload(_ id: UUID) throws {
        do { try FileManager.default.removeItem(at: location(id)) } catch { throw UploadQueueError.storageUnavailable }
    }

    private func location(_ id: UUID) -> URL {
        directory.appendingPathComponent(id.uuidString).appendingPathExtension("sealed")
    }

    private func file(for id: UUID) -> URL {
        directory.appendingPathComponent(id.uuidString).appendingPathExtension(ImportConfiguration.encryptedExtension)
    }

    private func files() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
            .filter { $0.pathExtension == ImportConfiguration.encryptedExtension }
    }
}

private extension Optional where Wrapped == Int {
    func unwrapSize() -> Int { self ?? 0 }
}
