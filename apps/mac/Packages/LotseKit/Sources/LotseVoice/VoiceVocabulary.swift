import Foundation

public struct VoiceAlias: Decodable, Sendable {
    public let from: String
    public let to: String
}

public struct VoiceVocabulary: Decodable, Sendable {
    public let keyterms: [String]
    public let spellingAliases: [VoiceAlias]
    public let pronunciationAliases: [VoiceAlias]

    /// Generated from the knowledge catalog so offline Apple dictation has the same spellings.
    static let bundled: VoiceVocabulary = {
        guard let url = Bundle.module.url(forResource: "voice-vocabulary", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let catalog = try? JSONDecoder().decode(Catalog.self, from: data)
        else { return VoiceVocabulary(keyterms: [], spellingAliases: [], pronunciationAliases: []) }
        return VoiceVocabulary(
            keyterms: Array(catalog.terms.map(\.canonical).filter {
                $0.count <= VoiceConfiguration.maximumKeytermCharacters
            }.prefix(VoiceConfiguration.maximumKeyterms)),
            spellingAliases: catalog.terms.flatMap { term in
                ([term.canonical] + term.variants).map { VoiceAlias(from: $0, to: term.canonical) }
            },
            pronunciationAliases: []
        )
    }()

    static func replacing(_ text: String, aliases: [VoiceAlias]) -> String {
        guard aliases.isEmpty == false else { return text }
        let sorted = aliases.sorted { $0.from.count > $1.from.count }
        let alternatives = sorted.map { NSRegularExpression.escapedPattern(for: $0.from) }.joined(separator: "|")
        let pattern = "(?<![\\p{L}\\p{N}_])(?:" + alternatives + ")(?![\\p{L}\\p{N}_])"
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return text }
        var result = text
        for match in expression.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            guard let range = Range(match.range, in: result), let original = Range(match.range, in: text),
                  let alias = sorted.first(where: { $0.from.caseInsensitiveCompare(String(text[original])) == .orderedSame })
            else { continue }
            result.replaceSubrange(range, with: alias.to)
        }
        return result
    }

    private struct Catalog: Decodable {
        let terms: [Term]
    }
    private struct Term: Decodable {
        let canonical: String
        let variants: [String]
    }
}
