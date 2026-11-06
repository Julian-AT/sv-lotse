import AppKit

@MainActor
public enum ImportPasteboard {
    public static let types: [NSPasteboard.PasteboardType] = [.fileURL, .pdf, .tiff, .png]

    public static func payloads(from board: NSPasteboard) throws -> [ImportPayload] {
        if let files = board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL],
            files.isEmpty == false {
            return try files.map { try ImportPayload(url: $0) }
        }
        if let pdf = board.data(forType: .pdf) {
            return [try ImportPayload(filename: "scan.pdf", mimeType: "application/pdf", data: pdf)]
        }
        for type in [NSPasteboard.PasteboardType.png, .tiff] {
            if let data = board.data(forType: type) { return [try ImportPayload(imageData: data)] }
        }
        throw DocumentImportError.unsupportedType
    }
}

@MainActor
public class ImportSurfaceView: NSView, @MainActor NSServicesMenuRequestor {
    public var receive: ((NSPasteboard) -> Bool)?

    public override init(frame: NSRect) {
        super.init(frame: frame)
        registerForDraggedTypes(ImportPasteboard.types)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    public override var acceptsFirstResponder: Bool { true }
    public override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation { .copy }
    public override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool { true }
    public override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        enclosingMenuItem?.menu?.cancelTracking()
        return receive?(sender.draggingPasteboard) ?? false
    }

    public override func validRequestor(
        forSendType sendType: NSPasteboard.PasteboardType?, returnType: NSPasteboard.PasteboardType?
    ) -> Any? {
        if let returnType, ImportPasteboard.types.contains(returnType) { return self }
        return super.validRequestor(forSendType: sendType, returnType: returnType)
    }

    public func readSelection(from pboard: NSPasteboard) -> Bool { receive?(pboard) ?? false }
}

@MainActor
public final class ImportDropView: ImportSurfaceView {
    public var openImport: (() -> Void)?
    private let button: NSButton

    public init(title: String) {
        button = NSButton(title: title, target: nil, action: nil)
        super.init(frame: NSRect(x: 0, y: 0, width: 340, height: 56))
        button.target = self
        button.action = #selector(open)
        button.frame = bounds.insetBy(dx: 8, dy: 8)
        button.autoresizingMask = [.width, .height]
        addSubview(button)
        menu = NSMenu()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    @objc private func open() { enclosingMenuItem?.menu?.cancelTracking(); openImport?() }
}
