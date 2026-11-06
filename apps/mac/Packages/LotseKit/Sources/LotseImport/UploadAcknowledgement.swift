import Foundation

enum UploadAcknowledgement {
    static func validate(data: Data, status: Int, uploadID: UUID) throws {
        guard (200..<300).contains(status) else {
            if status == 401 { throw DocumentImportError.sessionRequired }
            if status >= 500 || status == 429 { throw DocumentImportError.unavailable }
            throw DocumentImportError.uploadRejected
        }
        struct Confirmation: Decodable { let documentId: UUID; let uploadId: UUID }
        guard let confirmation = try? JSONDecoder().decode(Confirmation.self, from: data), confirmation.uploadId == uploadID else {
            throw DocumentImportError.uploadRejected
        }
    }
}
