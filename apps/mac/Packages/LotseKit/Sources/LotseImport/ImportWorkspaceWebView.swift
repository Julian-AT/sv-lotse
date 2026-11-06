import AppKit
import WebKit

@MainActor
public final class ImportWorkspaceWebView: WKWebView, @MainActor NSServicesMenuRequestor {
    public var importDocuments: ((NSPasteboard) -> Bool)?

    public override func draggingEntered(_ sender: any NSDraggingInfo) -> NSDragOperation {
        accepts(sender) ? .copy : super.draggingEntered(sender)
    }

    public override func draggingUpdated(_ sender: any NSDraggingInfo) -> NSDragOperation {
        accepts(sender) ? .copy : super.draggingUpdated(sender)
    }

    public override func prepareForDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        accepts(sender) || super.prepareForDragOperation(sender)
    }

    public override func performDragOperation(_ sender: any NSDraggingInfo) -> Bool {
        if accepts(sender) { return importDocuments?(sender.draggingPasteboard) ?? false }
        return super.performDragOperation(sender)
    }

    private func accepts(_ sender: any NSDraggingInfo) -> Bool {
        importDocuments != nil && sender.draggingPasteboard.availableType(from: ImportPasteboard.types) != nil
    }

    public override func validRequestor(
        forSendType sendType: NSPasteboard.PasteboardType?, returnType: NSPasteboard.PasteboardType?
    ) -> Any? {
        if let returnType, ImportPasteboard.types.contains(returnType), importDocuments != nil { return self }
        return super.validRequestor(forSendType: sendType, returnType: returnType)
    }

    public func readSelection(from pboard: NSPasteboard) -> Bool { importDocuments?(pboard) ?? false }
}
