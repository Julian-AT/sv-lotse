import Foundation

/// Recognises the activation phrase „Meine SV“ in on-device speech transcripts.
public enum WakeWordMatcher {
    /// Spoken spellings of „SV“ after the words are joined: "SV", "S V", "es vau", "esvau", "ess vau" …
    static let abbreviations: Set<String> = [
        "sv", "esvau", "essvau", "esvauh", "esfau", "essfau", "eswau", "esv", "svau", "sfau", "esvi",
        "esvee", "svee", "esve", "svs"
    ]
    /// German spellings plus what the English on-device fallback hears for „Meine“.
    static let leadWords: Set<String> = ["meine", "maine", "mein", "mine", "mina", "myna", "meina"]
    static let maximumAbbreviationWords = 3

    /// True when the transcript contains the activation phrase.
    public static func matches(_ text: String) -> Bool { match(in: words(text)) != nil }

    /// The transcript without its first activation phrase and the punctuation that followed it.
    public static func strip(_ text: String) -> String {
        let parts = words(text)
        guard let range = match(in: parts) else { return text.trimmingCharacters(in: .whitespacesAndNewlines) }
        let remaining = Array(parts[..<range.lowerBound]) + Array(parts[range.upperBound...])
        let joined = remaining.map(\.original).joined(separator: " ")
        return String(joined.drop { $0.isPunctuation || $0.isWhitespace }).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    struct Word {
        let original: String
        let normalized: String
    }

    static func words(_ text: String) -> [Word] {
        text.split(whereSeparator: { $0.isWhitespace }).compactMap { piece in
            let original = String(piece)
            let folded = original.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
                .lowercased()
            let normalized = String(folded.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.map(Character.init))
            return Word(original: original, normalized: normalized)
        }
    }

    /// Word range covering "meine" plus the spoken abbreviation, if present.
    static func match(in words: [Word]) -> Range<Int>? {
        for index in words.indices where leadWords.contains(words[index].normalized) {
            var joined = ""
            var end = index + 1
            while end < words.count, end - index <= maximumAbbreviationWords {
                joined += words[end].normalized
                end += 1
                if abbreviations.contains(joined) { return index..<end }
                if joined.count > 6 { break }
            }
        }
        return nil
    }
}

/// Why the wake-word listener is currently not listening.
public enum WakeWordPauseReason: Hashable, Sendable {
    case speechOutput, pushToTalk, capture, companionPaused
}

public enum WakeWordState: Equatable, Sendable { case off, listening, paused }

/// Pure pause/resume state: listening only while enabled and nothing else holds the microphone.
public struct WakeWordGate: Equatable, Sendable {
    public var enabled: Bool
    public private(set) var reasons: Set<WakeWordPauseReason> = []

    public init(enabled: Bool) { self.enabled = enabled }

    public var shouldListen: Bool { enabled && reasons.isEmpty }
    public var state: WakeWordState { enabled == false ? .off : (reasons.isEmpty ? .listening : .paused) }

    public mutating func set(_ reason: WakeWordPauseReason, paused: Bool) {
        if paused { reasons.insert(reason) } else { reasons.remove(reason) }
    }
}

public enum WakeWordPreferences {
    public static let enabledKey = "wakeWordEnabled"
    /// On by default (owner request); the user can turn it off in Settings or the menu bar.
    public static func enabled(in preferences: UserDefaults = .standard) -> Bool {
        preferences.object(forKey: enabledKey) as? Bool ?? true
    }
    public static func title(german: Bool) -> String { german ? "Aktivierungswort „Meine SV“" : "Wake word “Meine SV”" }
    public static func waiting(german: Bool) -> String { german ? "Wartet auf „Meine SV“" : "Waiting for “Meine SV”" }
    public static func hint(german: Bool) -> String {
        german
            ? "Sagen Sie „Meine SV“ und dann Ihre Frage. Erkannt wird nur auf diesem Mac; "
                + "bis zum Aktivierungswort wird nichts gesendet oder gespeichert."
            : "Say “Meine SV”, then your question. Detection runs on this Mac only; nothing is sent or stored before the wake word."
    }
}
