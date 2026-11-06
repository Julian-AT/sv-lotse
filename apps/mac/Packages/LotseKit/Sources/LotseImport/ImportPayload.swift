import AppKit
import Foundation
import PDFKit
import UniformTypeIdentifiers

public struct ImportPayload: Codable, Sendable {
    public let filename: String
    public let mimeType: String
    public let data: Data

    public init(filename: String, mimeType: String, data: Data) throws {
        guard data.isEmpty == false else { throw DocumentImportError.invalidDocument }
        guard data.count <= ImportConfiguration.maximumBytes else { throw DocumentImportError.tooLarge }
        guard ["application/pdf", "image/jpeg", "image/png"].contains(mimeType) else {
            throw DocumentImportError.unsupportedType
        }
        self.filename = filename
        self.mimeType = mimeType
        self.data = data
    }

    @MainActor
    public init(url: URL) throws {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let document = try ImportDocument(url: url)
        guard document.byteCount <= ImportConfiguration.maximumBytes else { throw DocumentImportError.tooLarge }
        try self.init(documentData: Data(contentsOf: url), filename: url.lastPathComponent)
    }

    /// A readable PDF stays as is; any image becomes a PNG. The filename is metadata only.
    @MainActor
    public init(documentData data: Data, filename: String) throws {
        guard data.count <= ImportConfiguration.maximumBytes else { throw DocumentImportError.tooLarge }
        let name = (filename as NSString).lastPathComponent
        if data.starts(with: Data("%PDF-".utf8)) {
            guard let pdf = PDFDocument(data: data), pdf.isLocked == false, pdf.pageCount > 0 else {
                throw DocumentImportError.invalidDocument
            }
            try self.init(filename: name.isEmpty ? "document.pdf" : name, mimeType: "application/pdf", data: data)
        } else {
            let base = (name as NSString).deletingPathExtension
            try self.init(imageData: data, filename: (base.isEmpty ? "document" : base) + ".png")
        }
    }

    @MainActor
    public init(imageData: Data, filename: String = "scan.png") throws {
        guard imageData.count <= ImportConfiguration.maximumBytes,
            let image = NSBitmapImageRep(data: imageData),
            let png = image.representation(using: .png, properties: [:])
        else { throw DocumentImportError.invalidDocument }
        try self.init(filename: filename, mimeType: "image/png", data: png)
    }
}
