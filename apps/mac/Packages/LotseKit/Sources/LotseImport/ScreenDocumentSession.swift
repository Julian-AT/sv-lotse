import AppKit
import PDFKit

@MainActor
public final class ScreenDocumentSession {
    public private(set) var pages: [Data] = []
    public init() {}

    public func append(_ imageData: Data) throws {
        guard pages.count < ImportConfiguration.maximumPages,
            pages.reduce(0, { $0 + $1.count }) + imageData.count <= ImportConfiguration.maximumBytes,
            NSImage(data: imageData) != nil
        else { throw DocumentImportError.tooLarge }
        pages.append(imageData)
    }

    public func reset() { pages.removeAll() }

    public func document() throws -> ImportPayload {
        guard pages.isEmpty == false else { throw DocumentImportError.invalidDocument }
        let pdf = PDFDocument()
        for data in pages {
            guard let image = NSImage(data: data), let page = PDFPage(image: image) else {
                throw DocumentImportError.invalidDocument
            }
            pdf.insert(page, at: pdf.pageCount)
        }
        guard let data = pdf.dataRepresentation() else { throw DocumentImportError.invalidDocument }
        return try ImportPayload(filename: "screen-document.pdf", mimeType: "application/pdf", data: data)
    }
}
