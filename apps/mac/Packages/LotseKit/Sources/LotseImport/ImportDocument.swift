import Foundation

public enum ImportError: Error { case unreadableDocument }

/// Validated local input to the upload queue. It stores metadata, never extracted facts.
public struct ImportDocument: Sendable {
    public let url: URL
    public let byteCount: Int

    public init(url: URL) throws {
        guard url.isFileURL,
            let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey]),
            values.isRegularFile == true, let size = values.fileSize, size > 0,
            FileManager.default.isReadableFile(atPath: url.path)
        else { throw ImportError.unreadableDocument }
        self.url = url
        byteCount = size
    }
}
