import Foundation
import LotseImport
import WebKit

@MainActor
public final class GuidedDownloadHandler: NSObject, WKDownloadDelegate {
    /// Receives the sealed download id; the owner shows it in the import preview.
    public var onQueued: ((UUID) -> Void)?
    public var onFailure: (() -> Void)?
    private let queue: EncryptedUploadQueue
    private let policy: GuidedOriginPolicy
    private var downloads: [ObjectIdentifier: WKDownload] = [:]
    private var destinations: [ObjectIdentifier: Destination] = [:]

    private struct Destination {
        let url: URL
        let filename: String
        let mimeType: String
    }

    public init(queue: EncryptedUploadQueue, policy: GuidedOriginPolicy) {
        self.queue = queue
        self.policy = policy
        super.init()
    }

    public func track(_ download: WKDownload) {
        downloads[ObjectIdentifier(download)] = download
        download.delegate = self
    }

    public func download(
        _ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String
    ) async -> URL? {
        guard downloads[ObjectIdentifier(download)] != nil,
            let url = response.url, policy.allowsDownload(url.absoluteString),
            response.expectedContentLength <= Int64(ImportConfiguration.maximumBytes)
        else { onFailure?(); return nil }
        do {
            // The page-provided filename is metadata only, never a filesystem path.
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700]
            )
            let destination = directory.appendingPathComponent(UUID().uuidString)
            destinations[ObjectIdentifier(download)] = Destination(
                url: destination, filename: (suggestedFilename as NSString).lastPathComponent,
                mimeType: response.mimeType ?? "application/octet-stream"
            )
            return destination
        } catch { onFailure?(); return nil }
    }

    public func downloadDidFinish(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        downloads.removeValue(forKey: id)
        guard let destination = destinations.removeValue(forKey: id) else { onFailure?(); return }
        Task {
            defer { try? FileManager.default.removeItem(at: destination.url.deletingLastPathComponent()) }
            do {
                // Only a previewable document is kept; it waits sealed for the import preview (FR-D1).
                let document = try ImportDocument(url: destination.url)
                guard document.byteCount <= ImportConfiguration.maximumBytes else { throw DocumentImportError.tooLarge }
                let payload = try ImportPayload(documentData: Data(contentsOf: document.url), filename: destination.filename)
                let queued = try await queue.enqueueDownload(
                    filename: payload.filename, mimeType: payload.mimeType, data: payload.data
                )
                onQueued?(queued)
            } catch { onFailure?() }
        }
    }

    public func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        remove(download)
        onFailure?()
    }

    public func download(
        _ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        decisionHandler: @escaping @MainActor (WKDownload.RedirectPolicy) -> Void
    ) {
        decisionHandler(request.url.map { policy.allows($0.absoluteString) } == true ? .allow : .cancel)
    }

    public func cancelAll() {
        for download in Array(downloads.values) {
            // Remove partial plaintext only once WebKit has stopped writing it.
            download.cancel { [self] _ in remove(download) }
        }
    }

    private func remove(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        downloads.removeValue(forKey: id)
        if let destination = destinations.removeValue(forKey: id) {
            try? FileManager.default.removeItem(at: destination.url.deletingLastPathComponent())
        }
    }
}
