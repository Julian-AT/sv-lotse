import Foundation

public struct ImportCopy {
    public var english = false
    public init(english: Bool = false) { self.english = english }
    private func text(_ de: String, _ en: String) -> String { english ? en : de }
    public var title: String { text("Dokument importieren", "Import document") }
    public var dropHint: String { text("PDF oder Bild hier ablegen · Import öffnen", "Drop a PDF or image here · Open import") }
    var choose: String { text("Datei auswählen …", "Choose file …") }
    var camera: String { text("iPhone-Scan: Rechtsklick in die Vorschau", "iPhone scan: right-click the preview") }
    var preview: String { text("Vorschau vor dem Speichern", "Preview before saving") }
    var ownContext: String {
        text("Nach Ihrer Bestätigung wird dieses Dokument in Ihrem eigenen Kontext gespeichert. "
             + "Fakten werden erst im Arbeitsbereich gesondert bestätigt.",
             "After confirmation this document is saved to your own context. Facts are confirmed separately in the workspace.")
    }
    var confirm: String { text("Speichern und hochladen", "Save and upload") }
    var cancel: String { text("Verwerfen", "Discard") }
    var capture: String { text("Bildschirmseite aufnehmen", "Capture screen page") }
    var nextPage: String { text("Nächste Seite aufnehmen", "Capture next page") }
    var finish: String { text("Seiten als PDF übernehmen", "Use pages as PDF") }
    var captureHint: String {
        text("Öffnen Sie das Dokument auf dem gewählten Bildschirm. Scrollen Sie selbst zur nächsten Seite und klicken Sie erneut. "
             + "Es wird nur nach Ihrem Klick aufgenommen. Prüfen Sie jede Seite vor dem Hochladen.",
             "Open the document on the selected screen. Scroll to the next page yourself and click again. "
             + "Capture runs only after your click. Review every page before uploading.")
    }
    var saved: String { text("Dokument bestätigt. Der Upload wird versucht.", "Document confirmed. Attempting upload.") }
    var invalid: String { text("Import nicht möglich. Bitte ein unverschlüsseltes PDF oder Bild bis 20 MB wählen.",
                               "Cannot import. Choose an unlocked PDF or image up to 20 MB.") }
    var captureFailed: String { text("Aufnahme nicht möglich. Bildschirmfreigabe und Ausschlussliste in den Einstellungen prüfen.",
                                     "Capture unavailable. Check Screen Recording permission and the configured exclusion list.") }
    public func pages(_ count: Int) -> String { text("\(count) Seiten aufgenommen", "\(count) pages captured") }
    public func status(_ status: UploadQueueStatus, count: Int) -> String {
        switch status {
        case .ready: text("Upload-Warteschlange: \(count)", "Upload queue: \(count)")
        case .uploading: text("Dokumente werden hochgeladen (\(count))", "Uploading documents (\(count))")
        case .offline: text("Lotse nicht erreichbar. \(count) Dokumente verschlüsselt vorgemerkt; neuer Versuch folgt.",
                            "Lotse unavailable. \(count) documents queued encrypted; retry follows.")
        case .needsSession: text("\(count) Dokumente warten auf die ursprüngliche Sitzung. Import öffnen und erneut bestätigen.",
                                 "\(count) documents await the original session. Open import and confirm again.")
        case .rejected: text("Upload nicht bestätigt. \(count) Dokumente bleiben verschlüsselt gespeichert.",
                             "Upload not confirmed. \(count) documents remain encrypted.")
        case .storageError: text("Verschlüsselte Warteschlange nicht lesbar. Es wurde nichts gelöscht.",
                                 "Encrypted queue cannot be read. Nothing was deleted.")
        }
    }
}
