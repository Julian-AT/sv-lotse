import LotseBridge
import LotseCapture
import LotseImport

@MainActor
struct DocumentImportSetup {
    let uploads: DocumentUploadCoordinator
    let panel: DocumentImportPanel

    init(
        workspace: WorkspaceWindowController, menu: MenuBarController, language: CompanionLanguage,
        portal: GuidedPortalCapability
    ) throws {
        let client = try DocumentUploadClient(
            workspaceURL: workspace.configuration.url,
            cookies: workspace.webView.configuration.websiteDataStore.httpCookieStore
        )
        let queue = try EncryptedUploadQueue()
        let coordinator = DocumentUploadCoordinator(queue: queue, client: client)
        let panel = DocumentImportPanel(uploads: coordinator, copy: ImportCopy(english: language == .english))
        panel.capturePage = { displayID in
            let excluded = try ImportCapturePolicy.excludedApplications()
            let captures = try await CompanionScreenCaptureUtility.captureAllScreensAsJPEG(
                excludingBundleIdentifiers: excluded, displayID: displayID, fullResolution: true
            )
            guard let capture = captures.first else { throw CaptureError.noDisplay }
            return capture.imageData
        }
        coordinator.onChange = { [weak coordinator, weak menu, weak panel] in
            guard let coordinator else { return }
            menu?.updateUploadStatus(coordinator.status, count: coordinator.pendingCount)
            panel?.refreshStatus()
        }
        uploads = coordinator
        self.panel = panel
        menu.openImport = { [weak panel] in panel?.showImport() }
        menu.importDocuments = { [weak panel] in panel?.receive($0) ?? false }
        workspace.onDocumentImport = { [weak panel] in panel?.receive($0) ?? false }
        // Guided-window downloads share this queue, preview and coordinator (FR-D1).
        portal.connectImports(queue: queue) { [weak panel] id in panel?.receiveDownload(id) }
    }
}
