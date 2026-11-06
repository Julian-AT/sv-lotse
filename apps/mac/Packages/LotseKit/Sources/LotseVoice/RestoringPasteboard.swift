import AppKit

public enum DictationInsertionError: Error {
    case accessibilityRequired, noEditableField, secureField, focusChanged, pasteUnavailable, clipboardUnavailable
}

@MainActor
protocol DictationPasteboard {
    var items: [NSPasteboardItem] { get }
    var changeCount: Int { get }
    func clear()
    func write(_ text: String) -> Bool
    func write(_ items: [NSPasteboardItem]) -> Bool
}

@MainActor
struct SystemDictationPasteboard: DictationPasteboard {
    let pasteboard: NSPasteboard
    var items: [NSPasteboardItem] { pasteboard.pasteboardItems ?? [] }
    var changeCount: Int { pasteboard.changeCount }
    func clear() { pasteboard.clearContents() }
    func write(_ text: String) -> Bool { pasteboard.setString(text, forType: .string) }
    func write(_ items: [NSPasteboardItem]) -> Bool { pasteboard.writeObjects(items) }
}

@MainActor
struct RestoringPasteboard {
    let clipboard: DictationPasteboard
    var waitForPaste: @MainActor () async throws -> Void = {
        try await Task.sleep(for: VoiceConfiguration.pasteConsumptionDelay)
    }

    init(pasteboard: NSPasteboard) { clipboard = SystemDictationPasteboard(pasteboard: pasteboard) }

    init(clipboard: DictationPasteboard, waitForPaste: @escaping @MainActor () async throws -> Void) {
        self.clipboard = clipboard
        self.waitForPaste = waitForPaste
    }

    func insert(_ text: String, validate: () throws -> Void, sendPaste: () throws -> Void) async throws {
        try Task.checkCancellation()
        try validate()
        let originalChangeCount = clipboard.changeCount
        let previousItems = try snapshot()
        guard clipboard.changeCount == originalChangeCount else { throw DictationInsertionError.clipboardUnavailable }
        clipboard.clear()
        let written = clipboard.write(text)
        let ownedChangeCount = clipboard.changeCount
        defer {
            if clipboard.changeCount == ownedChangeCount {
                clipboard.clear()
                if previousItems.isEmpty == false { _ = clipboard.write(previousItems) }
            }
        }
        guard written else { throw DictationInsertionError.clipboardUnavailable }
        try validate()
        try sendPaste()
        try await waitForPaste()
    }

    private func snapshot() throws -> [NSPasteboardItem] {
        try clipboard.items.map { item in
            let copy = NSPasteboardItem()
            for type in item.types {
                guard let data = item.data(forType: type), copy.setData(data, forType: type) else {
                    throw DictationInsertionError.clipboardUnavailable
                }
            }
            return copy
        }
    }
}
