import AppKit
import CryptoKit
import Foundation
import PDFKit
import Testing

@testable import LotseImport

@Test("FR-D7 downloaded originals and filenames persist encrypted until upload confirmation")
func encryptedDownloadQueue() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let original = root.appendingPathComponent("original.pdf")
    let payload = Data("%PDF-1.7\nDocument original".utf8)
    try payload.write(to: original)
    let directory = root.appendingPathComponent("queue")
    let key = SymmetricKey(size: .bits256)
    let queue = try EncryptedUploadQueue(directory: directory, encryptionKey: key)

    let id = try await queue.enqueue(ImportDocument(url: original), filename: "private-filename.pdf", mimeType: "application/pdf")
    try FileManager.default.removeItem(at: original)
    let storedURL = directory.appendingPathComponent(id.uuidString).appendingPathExtension("sealed")
    let sealed = try Data(contentsOf: storedURL)
    #expect(sealed.range(of: payload) == nil)
    #expect(sealed.range(of: Data("private-filename.pdf".utf8)) == nil)

    let reopened = try EncryptedUploadQueue(directory: directory, encryptionKey: key)
    #expect(try await reopened.pendingIDs() == [id])
    let entry = try await reopened.read(id)
    #expect(entry.data == payload)
    #expect(entry.filename == "private-filename.pdf")
    #expect(entry.mimeType == "application/pdf")
    try await reopened.acknowledgeUpload(id)
    #expect(try await reopened.pendingIDs().isEmpty)
    #expect(FileManager.default.fileExists(atPath: storedURL.path) == false)
}

@Test("FR-D7 a changed ciphertext or a different key cannot recover a queued document")
func authenticatedDownloadQueue() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let queue = try EncryptedUploadQueue(directory: root, encryptionKey: SymmetricKey(size: .bits256))
    let source = root.appendingPathComponent("source")
    try Data("%PDF-1.7\n".utf8).write(to: source)
    let id = try await queue.enqueue(ImportDocument(url: source), filename: "file.pdf", mimeType: "application/pdf")
    let wrongKey = try EncryptedUploadQueue(directory: root, encryptionKey: SymmetricKey(size: .bits256))
    await #expect(throws: UploadQueueError.self) { try await wrongKey.read(id) }
    let location = root.appendingPathComponent(id.uuidString).appendingPathExtension("sealed")
    var ciphertext = try Data(contentsOf: location)
    ciphertext[ciphertext.startIndex] ^= 1
    try ciphertext.write(to: location)
    await #expect(throws: UploadQueueError.self) { try await queue.read(id) }
}

private func temporaryQueueDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
}

private func payload() throws -> ImportPayload {
    try ImportPayload(filename: "private-document.pdf", mimeType: "application/pdf", data: Data("%PDF-private-content".utf8))
}

@Test("FR-D7 guided downloads coexist with confirmed imports without entering the session-bound retry flow")
func downloadAndImportCoexist() async throws {
    let root = temporaryQueueDirectory()
    defer { try? FileManager.default.removeItem(at: root) }
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let source = root.appendingPathComponent("original")
    let data = Data("downloaded original".utf8)
    try data.write(to: source)
    let directory = root.appendingPathComponent("queue")
    let key = SymmetricKey(size: .bits256)
    let queue = try EncryptedUploadQueue(directory: directory, encryptionKey: key)
    let downloadID = try await queue.enqueue(
        ImportDocument(url: source), filename: "original.bin", mimeType: "application/octet-stream"
    )
    let importID = try await queue.enqueue(payload(), workspaceOrigin: "https://lotse.test", sessionID: "session")

    let reopened = try EncryptedUploadQueue(directory: directory, key: key)
    #expect(try await reopened.pendingIDs() == [downloadID])
    #expect(try await reopened.pending().map(\.id) == [importID])
    #expect(try await reopened.count() == 1)
    let download = try await reopened.read(downloadID)
    #expect(download.data == data)
    #expect(download.filename == "original.bin")
    #expect(download.mimeType == "application/octet-stream")
    try await reopened.remove(importID)
    #expect(try await reopened.pendingIDs() == [downloadID])
    try await reopened.acknowledgeUpload(downloadID)
    #expect(try await reopened.pendingIDs().isEmpty)
    #expect(try await reopened.pending().isEmpty)
}

@MainActor
private func pageImage() throws -> Data {
    let bitmap = try #require(NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: 8, pixelsHigh: 12, bitsPerSample: 8, samplesPerPixel: 3,
        hasAlpha: false, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 24, bitsPerPixel: 24
    ))
    return try #require(bitmap.representation(using: .png, properties: [:]))
}

@Test("NFR-3 encrypted queue survives restart without plaintext metadata or document bytes")
func queueRestart() async throws {
    let directory = temporaryQueueDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let key = SymmetricKey(size: .bits256)
    let queue = try EncryptedUploadQueue(directory: directory, key: key)
    let document = try payload()
    let id = try await queue.enqueue(document, workspaceOrigin: "https://lotse.test", sessionID: "private-session")
    let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    let ciphertext = try Data(contentsOf: #require(files.first))
    for value in [document.filename, "private-content", "private-session", "https://lotse.test"] {
        #expect(ciphertext.range(of: Data(value.utf8)) == nil)
    }
    let reopened = try EncryptedUploadQueue(directory: directory, key: key)
    let pending = try await reopened.pending()
    #expect(pending.count == 1)
    #expect(pending.first?.id == id)
    #expect(pending.first?.payload.data == document.data)
    #expect(pending.first?.sessionID == "private-session")
    let attributes = try FileManager.default.attributesOfItem(atPath: #require(files.first).path)
    #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
}

@Test("NFR-3 authentication rejects a changed ciphertext and leaves it on disk")
func queueTamper() async throws {
    let directory = temporaryQueueDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let queue = try EncryptedUploadQueue(directory: directory, key: SymmetricKey(size: .bits256))
    try await queue.enqueue(payload(), workspaceOrigin: "https://lotse.test", sessionID: nil)
    let file = try #require(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
    var bytes = try Data(contentsOf: file)
    bytes[bytes.count / 2] ^= 1
    try bytes.write(to: file)
    await #expect(throws: DocumentImportError.self) { try await queue.pending() }
    #expect(FileManager.default.fileExists(atPath: file.path))
}

@MainActor
private final class UploadTestClient: DocumentUploading {
    let origin = "https://lotse.test"
    var currentSession: String? = "original-session"
    var failure: DocumentImportError? = .unavailable
    var uploaded: [UUID] = []
    func sessionID() async -> String? { currentSession }
    func upload(_ record: QueuedUpload) async throws {
        guard record.sessionID == currentSession else { throw DocumentImportError.sessionChanged }
        if let failure { throw failure }
        uploaded.append(record.id)
    }
}

@Test("NFR-3 outage queues on disk; retry deletes only after an acknowledged upload") @MainActor
func offlineRetry() async throws {
    let directory = temporaryQueueDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let queue = try EncryptedUploadQueue(directory: directory, key: SymmetricKey(size: .bits256))
    let client = UploadTestClient()
    let coordinator = DocumentUploadCoordinator(queue: queue, client: client)
    try await coordinator.enqueue(payload())
    await coordinator.flush()
    #expect(coordinator.status == .offline)
    #expect(coordinator.pendingCount == 1)
    #expect(try await queue.pending().count == 1)
    client.failure = .uploadRejected
    await coordinator.flush()
    #expect(coordinator.status == .rejected)
    #expect(try await queue.pending().count == 1)
    client.failure = nil
    await coordinator.flush()
    #expect(coordinator.status == .ready)
    #expect(coordinator.pendingCount == 0)
    #expect(client.uploaded.count == 1)
    #expect(try await queue.pending().isEmpty)
}

@Test("FR-D1 a changed session retains uploads until the user previews and confirms them again") @MainActor
func changedSession() async throws {
    let directory = temporaryQueueDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let queue = try EncryptedUploadQueue(directory: directory, key: SymmetricKey(size: .bits256))
    let client = UploadTestClient()
    let coordinator = DocumentUploadCoordinator(queue: queue, client: client)
    try await coordinator.enqueue(payload())
    await coordinator.flush()
    let record = try #require(await queue.pending().first)
    client.failure = nil
    client.currentSession = "new-session"
    await coordinator.flush()
    #expect(coordinator.status == .needsSession)
    #expect(client.uploaded.isEmpty)
    try await coordinator.confirmSession(record.id)
    #expect(client.uploaded == [record.id])
    #expect(try await queue.pending().isEmpty)
}

@Test("FR-D1 scan pages become one ordered PDF and reset discards only the capture session") @MainActor
func multiplePages() throws {
    let image = try pageImage()
    let session = ScreenDocumentSession()
    try session.append(image)
    try session.append(image)
    let result = try session.document()
    #expect(result.mimeType == "application/pdf")
    #expect(PDFDocument(data: result.data)?.pageCount == 2)
    session.reset()
    #expect(throws: DocumentImportError.self) { try session.document() }
    #expect(PDFDocument(data: result.data)?.pageCount == 2)
}

@Test("FR-D1 Continuity Camera responder accepts PDF services and consumes scan bytes through the common preview boundary") @MainActor
func continuityResponder() throws {
    let board = NSPasteboard.withUniqueName()
    defer { board.releaseGlobally() }
    let document = PDFDocument()
    let image = try #require(NSImage(data: pageImage()))
    let page = try #require(PDFPage(image: image))
    document.insert(page, at: 0)
    let data = try #require(document.dataRepresentation())
    try #require(board.setData(data, forType: .pdf), "Requires the logged-in macOS pasteboard service")
    let view = ImportDropView(title: "Import")
    var received: [ImportPayload] = []
    view.receive = { pasteboard in
        received = (try? ImportPasteboard.payloads(from: pasteboard)) ?? []
        return received.isEmpty == false
    }
    #expect(view.validRequestor(forSendType: nil, returnType: .pdf) as? ImportDropView === view)
    #expect(view.readSelection(from: board))
    #expect(received.count == 1)
    #expect(received.first?.mimeType == "application/pdf")
}

@Test("NFR-3 cookie rotation retains the stable session binding")
func cookieBinding() throws {
    let id = UUID().uuidString.lowercased()
    let body = Data("{\"sessionId\":\"\(id)\",\"issuedAt\":1,\"v\":1}".utf8).base64EncodedString()
    let encoded = body.replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    #expect(DocumentUploadClient.sessionIdentifier(encoded + ".signature") == id)
    #expect(DocumentUploadClient.sessionIdentifier("broken") == nil)
}

@Test("NFR-3 only a matching persisted-document acknowledgement authorizes local deletion")
func matchingAcknowledgement() throws {
    let id = UUID()
    let valid = Data("{\"documentId\":\"\(UUID().uuidString)\",\"uploadId\":\"\(id.uuidString)\"}".utf8)
    try UploadAcknowledgement.validate(data: valid, status: 201, uploadID: id)
    #expect(throws: DocumentImportError.self) {
        try UploadAcknowledgement.validate(data: valid, status: 201, uploadID: UUID())
    }
    for status in [302, 401, 403, 409, 429, 500, 503] {
        #expect(throws: DocumentImportError.self) {
            try UploadAcknowledgement.validate(data: valid, status: status, uploadID: id)
        }
    }
    #expect(throws: DocumentImportError.self) {
        try UploadAcknowledgement.validate(data: Data("OK".utf8), status: 200, uploadID: id)
    }
}

@Test("FR-D1 import capture loads its bundled exclusions and extends the baseline")
func importCaptureExclusions() throws {
    let baseline = try ImportCapturePolicy.excludedApplications(environment: [:])
    let extended = try ImportCapturePolicy.excludedApplications(environment: [
        "LOTSE_CAPTURE_EXCLUDED_BUNDLE_IDS": " test.extra-sensitive-app "
    ])
    #expect(baseline.isEmpty == false)
    #expect(extended.isSuperset(of: baseline))
    #expect(extended.contains("test.extra-sensitive-app"))
}

@Test("FR-D1 a guided-window download produces an import preview and then an upload to the user context") @MainActor
func guidedDownloadPreviewAndUpload() async throws {
    let directory = temporaryQueueDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let queue = try EncryptedUploadQueue(directory: directory, key: SymmetricKey(size: .bits256))
    let client = UploadTestClient()
    client.failure = nil
    let coordinator = DocumentUploadCoordinator(queue: queue, client: client)
    let image = try #require(NSImage(data: pageImage()))
    let page = try #require(PDFPage(image: image))
    let document = PDFDocument()
    document.insert(page, at: 0)
    let pdf = try #require(document.dataRepresentation())

    let id = try await queue.enqueueDownload(filename: "Bescheid.pdf", mimeType: "application/pdf", data: pdf)
    // The sealed download is what the preview shows; nothing is uploaded before confirmation.
    let downloads = try await coordinator.pendingDownloads()
    #expect(downloads.map(\.id) == [id])
    let payload = try #require(downloads.first).payload()
    #expect(payload.filename == "Bescheid.pdf")
    #expect(DocumentImportPanel.pdf(payload)?.pageCount == 1)
    await coordinator.flush()
    #expect(client.uploaded.isEmpty)

    try await coordinator.acceptDownload(id)
    #expect(try await queue.pendingIDs().isEmpty)
    await coordinator.flush()
    #expect(client.uploaded.count == 1)
    #expect(coordinator.status == .ready)
    #expect(try await queue.pending().isEmpty)
}

@Test("FR-D1 a discarded or unreadable guided download is never uploaded") @MainActor
func guidedDownloadDiscard() async throws {
    let directory = temporaryQueueDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let queue = try EncryptedUploadQueue(directory: directory, key: SymmetricKey(size: .bits256))
    let client = UploadTestClient()
    client.failure = nil
    let coordinator = DocumentUploadCoordinator(queue: queue, client: client)
    let id = try await queue.enqueueDownload(filename: "x.bin", mimeType: "application/octet-stream", data: Data("binary".utf8))
    await #expect(throws: (any Error).self) { try await coordinator.acceptDownload(id) }
    #expect(try await queue.pendingIDs() == [id])
    try await coordinator.discardDownload(id)
    await coordinator.flush()
    #expect(try await queue.pendingIDs().isEmpty)
    #expect(client.uploaded.isEmpty)
}
