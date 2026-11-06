import AppKit
import Testing

@testable import LotseVoice

@Suite(.serialized) @MainActor
struct PasteboardRestoreTests {
    @Test("FR-C8 paste restores all clipboard items and representations")
    func restoresClipboard() async throws {
        let pasteboard = DictationPasteboardSpy()
        let first = NSPasteboardItem()
        first.setString("Original", forType: .string)
        first.setData(Data([1, 2, 3]), forType: .rtf)
        let second = NSPasteboardItem()
        second.setString("Second", forType: .string)
        #expect(pasteboard.write([first, second]))
        let transaction = RestoringPasteboard(clipboard: pasteboard, waitForPaste: {})
        var pasted: String?
        try await transaction.insert("Diktat", validate: {}, sendPaste: { pasted = pasteboard.text })
        #expect(pasted == "Diktat")
        #expect(pasteboard.items.count == 2)
        #expect(pasteboard.items.first?.data(forType: .rtf) == Data([1, 2, 3]))
        #expect(pasteboard.items.last?.string(forType: .string) == "Second")
    }

    @Test("FR-C8 paste preserves a clipboard copy made during insertion")
    func preservesNewCopy() async throws {
        let pasteboard = DictationPasteboardSpy()
        #expect(pasteboard.write("Original"))
        let transaction = RestoringPasteboard(clipboard: pasteboard, waitForPaste: {
            pasteboard.clear()
            #expect(pasteboard.write("New copy"))
        })
        try await transaction.insert("Diktat", validate: {}, sendPaste: {})
        #expect(pasteboard.text == "New copy")
    }

    @Test("FR-C8 focus change before paste restores clipboard without sending keys")
    func focusChangeBeforePaste() async throws {
        let pasteboard = DictationPasteboardSpy()
        #expect(pasteboard.write("Original"))
        var validations = 0
        var pasted = false
        let transaction = RestoringPasteboard(clipboard: pasteboard, waitForPaste: {})
        await #expect(throws: DictationInsertionError.self) {
            try await transaction.insert("Diktat", validate: {
                validations += 1
                if validations == 2 { throw DictationInsertionError.focusChanged }
            }, sendPaste: { pasted = true })
        }
        #expect(pasted == false)
        #expect(pasteboard.text == "Original")
    }

    @Test("FR-C8 cancellation and paste failures restore the previous clipboard", arguments: [false, true])
    func restoresAfterFailure(cancelled: Bool) async {
        let pasteboard = DictationPasteboardSpy()
        #expect(pasteboard.write("Original"))
        let transaction = RestoringPasteboard(clipboard: pasteboard, waitForPaste: { throw CancellationError() })
        do {
            try await transaction.insert("Diktat", validate: {}, sendPaste: {
                if cancelled == false { throw DictationInsertionError.pasteUnavailable }
            })
            Issue.record("Insertion should fail")
        } catch {
            #expect(pasteboard.text == "Original")
        }
    }
}

/// Isolates clipboard ownership tests from the macOS pasteboard daemon, unavailable in the sandbox.
@MainActor
private final class DictationPasteboardSpy: DictationPasteboard {
    var items: [NSPasteboardItem] = []
    var changeCount = 0
    var text: String? { items.first?.string(forType: .string) }
    func clear() { items = []; changeCount += 1 }
    func write(_ text: String) -> Bool {
        let item = NSPasteboardItem()
        guard item.setString(text, forType: .string) else { return false }
        return write([item])
    }
    func write(_ items: [NSPasteboardItem]) -> Bool {
        self.items = items
        changeCount += 1
        return true
    }
}
