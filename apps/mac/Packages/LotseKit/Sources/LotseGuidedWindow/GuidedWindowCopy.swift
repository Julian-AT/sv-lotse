import Foundation

struct GuidedWindowCopy {
    let title: String
    let downloadError: String
    let downloadErrorHint: String

    static let german = GuidedWindowCopy(
        title: "SV KI-Lotse · Geführtes Portal", downloadError: "Das Dokument konnte nicht übernommen werden.",
        downloadErrorHint: "Bitte laden Sie das Dokument erneut herunter."
    )
    static let english = GuidedWindowCopy(
        title: "SV KI-Lotse · Guided portal", downloadError: "The document could not be imported.",
        downloadErrorHint: "Please download the document again."
    )
}
