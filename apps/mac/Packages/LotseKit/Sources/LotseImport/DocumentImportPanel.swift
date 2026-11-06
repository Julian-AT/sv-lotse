import AppKit
import PDFKit
import UniformTypeIdentifiers

@MainActor
public final class DocumentImportPanel: NSWindowController {
    public var capturePage: ((CGDirectDisplayID) async throws -> Data)?
    public var copy: ImportCopy {
        didSet {
            if let panel = window as? NSPanel { build(panel); refreshStatus() }
        }
    }
    private let uploads: DocumentUploadCoordinator
    private let preview = PDFView()
    private let status = NSTextField(wrappingLabelWithString: "")
    private let detail = NSTextField(wrappingLabelWithString: "")
    private let screens = NSPopUpButton()
    private let captureSession = ScreenDocumentSession()
    private var staged: [ImportPayload] = []
    private var queuedID: UUID?
    private var downloadID: UUID?
    private var capturing = false
    private var saving = false
    private var confirmButton = NSButton()

    public init(uploads: DocumentUploadCoordinator, copy: ImportCopy = ImportCopy()) {
        self.uploads = uploads
        self.copy = copy
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 740, height: 760),
                            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        panel.isReleasedWhenClosed = false
        super.init(window: panel)
        build(panel)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    public func showImport() {
        window?.title = copy.title
        showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        refreshStatus()
    }

    public func refreshStatus() { status.stringValue = copy.status(uploads.status, count: uploads.pendingCount) }

    public func receive(_ board: NSPasteboard) -> Bool {
        guard saving == false else { return false }
        do {
            let payloads = try ImportPasteboard.payloads(from: board)
            staged.append(contentsOf: payloads)
            showPreview()
            showImport()
            return true
        } catch {
            detail.stringValue = copy.invalid
            showImport()
            return false
        }
    }

    /// A guided-window download is shown here before anything is stored in the user context.
    public func receiveDownload(_ id: UUID) {
        guard saving == false else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do { try await showDownload(id) } catch {
                detail.stringValue = copy.invalid
                showImport()
            }
        }
    }

    private func showDownload(_ id: UUID) async throws {
        let payload = try await uploads.pendingDownloads().first { $0.id == id }?.payload()
        guard let payload, let document = Self.pdf(payload), document.isLocked == false, document.pageCount > 0 else {
            try? await uploads.discardDownload(id)
            throw DocumentImportError.invalidDocument
        }
        queuedID = nil
        downloadID = id
        preview.document = document
        detail.stringValue = payload.filename
        confirmButton.isEnabled = true
        showImport()
    }

    private func build(_ panel: NSPanel) {
        let drop = ImportDropView(title: copy.dropHint)
        drop.receive = { [weak self] in self?.receive($0) ?? false }
        drop.openImport = { [weak self] in self?.chooseFile() }
        let hint = NSTextField(wrappingLabelWithString: copy.camera)
        let context = NSTextField(wrappingLabelWithString: copy.ownContext)
        let captureHint = NSTextField(wrappingLabelWithString: copy.captureHint)
        preview.autoScales = true
        preview.displayMode = .singlePageContinuous
        let actions = NSStackView(views: [makeButton(copy.choose, #selector(chooseFile)),
                                         makeButton(copy.cancel, #selector(discard)),
                                         makeButton(copy.preview, #selector(showQueued))])
        let captureActions = NSStackView(views: [screens, makeButton(copy.nextPage, #selector(captureNext)),
                                                makeButton(copy.finish, #selector(finishCapture))])
        screens.removeAllItems()
        for screen in NSScreen.screens {
            let entry = NSMenuItem(title: screen.localizedName, action: nil, keyEquivalent: "")
            entry.representedObject = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")]
            screens.menu?.addItem(entry)
        }
        screens.selectItem(at: 0)
        screens.setAccessibilityLabel(copy.capture)
        confirmButton = makeButton(copy.confirm, #selector(confirm))
        confirmButton.isEnabled = (queuedID != nil || downloadID != nil || staged.isEmpty == false)
            && preview.document?.isLocked == false
        let stack = NSStackView(views: [drop, hint, context, actions, captureHint, captureActions, detail, preview, confirmButton, status])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        let root = ImportSurfaceView(frame: .zero)
        root.receive = { [weak self] in self?.receive($0) ?? false }
        root.menu = NSMenu()
        root.addSubview(stack)
        panel.contentView = root
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -20),
            stack.topAnchor.constraint(equalTo: root.topAnchor, constant: 20),
            stack.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -20),
            preview.widthAnchor.constraint(equalTo: stack.widthAnchor),
            preview.heightAnchor.constraint(greaterThanOrEqualToConstant: 160),
            drop.widthAnchor.constraint(equalTo: stack.widthAnchor),
            drop.heightAnchor.constraint(equalToConstant: 56)
        ])
        for label in [hint, context, captureHint, detail, status] {
            label.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
        panel.center()
    }

    private func makeButton(_ title: String, _ action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.setAccessibilityLabel(title)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        return button
    }

    @objc private func chooseFile() {
        guard saving == false else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf, .image]
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }
        do {
            staged.append(contentsOf: try panel.urls.map { try ImportPayload(url: $0) })
            showPreview()
        } catch { detail.stringValue = copy.invalid }
    }

    private func showPreview() {
        queuedID = nil
        downloadID = nil
        guard let payload = staged.first else { preview.document = nil; confirmButton.isEnabled = false; return }
        let document = Self.pdf(payload)
        preview.document = document
        detail.stringValue = payload.filename
        confirmButton.isEnabled = document?.isLocked == false && (document?.pageCount ?? 0) > 0
    }

    static func pdf(_ payload: ImportPayload) -> PDFDocument? {
        if payload.mimeType == "application/pdf" { return PDFDocument(data: payload.data) }
        guard let image = NSImage(data: payload.data), let page = PDFPage(image: image) else { return nil }
        let document = PDFDocument()
        document.insert(page, at: 0)
        return document
    }

    @objc private func confirm() {
        guard confirmButton.isEnabled, saving == false else { return }
        saving = true
        confirmButton.isEnabled = false
        let id = queuedID
        let download = downloadID
        let payload = staged.first
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { saving = false }
            do {
                if let download {
                    try await uploads.acceptDownload(download)
                } else if let id {
                    try await uploads.confirmSession(id)
                } else if let payload {
                    try await uploads.enqueue(payload)
                    staged.removeFirst()
                }
                showPreview()
                refreshStatus()
                Task { @MainActor [weak self] in await self?.uploads.flush() }
            } catch { detail.stringValue = copy.invalid; confirmButton.isEnabled = true }
        }
    }

    @objc private func discard() {
        guard saving == false else { return }
        if let id = downloadID {
            Task { @MainActor [weak self] in
                guard let self else { return }
                do { try await uploads.discardDownload(id); showPreview() } catch { detail.stringValue = copy.invalid }
            }
        } else if let id = queuedID {
            Task { @MainActor [weak self] in
                guard let self else { return }
                do { try await uploads.discard(id); showPreview() } catch { detail.stringValue = copy.invalid }
            }
        } else if staged.isEmpty == false { staged.removeFirst(); showPreview() }
        captureSession.reset()
        if staged.isEmpty && queuedID == nil && downloadID == nil { preview.document = nil; confirmButton.isEnabled = false }
    }

    @objc private func showQueued() {
        guard saving == false else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                if let download = try await uploads.pendingDownloads().first {
                    try await showDownload(download.id)
                    return
                }
                guard let record = try await uploads.pending().first else { refreshStatus(); return }
                queuedID = record.id
                downloadID = nil
                preview.document = Self.pdf(record.payload)
                detail.stringValue = record.payload.filename
                confirmButton.isEnabled = true
            } catch { detail.stringValue = copy.invalid }
        }
    }

    @objc private func captureNext() {
        guard capturing == false, saving == false, let capturePage,
            let number = screens.selectedItem?.representedObject as? NSNumber else { return }
        capturing = true
        confirmButton.isEnabled = false
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { capturing = false }
            do {
                try captureSession.append(await capturePage(number.uint32Value))
                let payload = try captureSession.document()
                preview.document = Self.pdf(payload)
                detail.stringValue = copy.pages(captureSession.pages.count)
            } catch { detail.stringValue = copy.captureFailed }
        }
    }

    @objc private func finishCapture() {
        guard capturing == false, saving == false else { return }
        do {
            staged.append(try captureSession.document())
            captureSession.reset()
            showPreview()
        } catch { detail.stringValue = copy.invalid }
    }
}
