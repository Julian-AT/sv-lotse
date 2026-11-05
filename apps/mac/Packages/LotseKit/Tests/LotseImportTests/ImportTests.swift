import Foundation
import Testing

@testable import LotseImport

@Test("FR-C7 import accepts readable documents and rejects directories")
func documentValidation() throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try Data("%PDF-1.7\n".utf8).write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    #expect(try ImportDocument(url: file).byteCount == 9)
    #expect(throws: ImportError.self) { try ImportDocument(url: file.deletingLastPathComponent()) }
}
