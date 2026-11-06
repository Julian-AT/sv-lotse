import Foundation

typealias AcknowledgementPlayer = @MainActor (Data, Double) async -> Void

enum AcknowledgementCopy {
    static func lines(_ language: String) -> [String] {
        language == "en"
            ? ["Okay, one moment.", "Sure, let me check.", "One moment, please."]
            : ["Okay, Moment.", "Gerne, ich schaue nach.", "Einen Augenblick, bitte."]
    }

    // Mirrors packages/brain/src/pipeline/status-copy.ts, which a voice turn hears as its first sentence.
    private static let statusLines: Set<String> = [
        "Einen Moment, ich schaue das kurz nach", "Ich suche die zuständige Stelle", "Ich prüfe die Unterlagen",
        "One moment, I'm looking that up", "I'm finding the responsible office", "I'm checking the documents"
    ]

    static func isStatusLine(_ text: String) -> Bool {
        statusLines.contains(text.replacingOccurrences(of: "…", with: "").trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

/// Rendered PCM per TTS language, rotated per voice question.
struct AcknowledgementClips {
    private var clips: [String: (voice: String, audio: [Data])] = [:]
    private var played = 0

    func has(_ language: String) -> Bool { clips[language]?.audio.isEmpty == false }
    func voice(_ language: String) -> String? { clips[language]?.voice }
    mutating func store(_ audio: [Data], voice: String, language: String) { clips[language] = (voice, audio) }
    mutating func remove(_ language: String) { clips[language] = nil }

    mutating func next(_ language: String) -> Data? {
        guard let audio = clips[language]?.audio, audio.isEmpty == false else { return nil }
        defer { played += 1 }
        return audio[played % audio.count]
    }
}

@MainActor
func playAcknowledgement(_ audio: Data, speed: Double) async {
    guard Task.isCancelled == false, let player = try? PCMStreamingPlayer(speed: speed) else { return }
    await withTaskCancellationHandler {
        guard (try? player.append(audio)) != nil else { return }
        await player.finish()
    } onCancel: {
        Task { @MainActor in player.stop() }
    }
    player.stop()
}
