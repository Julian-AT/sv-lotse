import AVFoundation
import Foundation
import LotseProtocol
import Testing

@testable import LotseVoice

/// Live checks against the running workspace (`LOTSE_LIVE_VOICE_URL=http://localhost:3000`) and ElevenLabs.
/// They synthesize German speech with `say`, stream it through the real Scribe provider like a microphone
/// and report transcript quality and latency. Skipped unless the variable is set.
enum LiveVoice {
    static let base = ProcessInfo.processInfo.environment["LOTSE_LIVE_VOICE_URL"].flatMap(URL.init(string:))

    /// An anonymous workspace session, then the same token route the app calls through the WebView.
    static func loader(base: URL) -> VoiceTokenLoader {
        let session = URLSession(configuration: .ephemeral)
        return { kind, language in
            var hello = URLRequest(url: base.appending(path: "api/session"))
            hello.httpMethod = "POST"
            hello.setValue(base.absoluteString.trimmingCharacters(in: ["/"]), forHTTPHeaderField: "Origin")
            _ = try await session.data(for: hello)
            var request = URLRequest(url: base.appending(path: "api/voice/token"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(base.absoluteString.trimmingCharacters(in: ["/"]), forHTTPHeaderField: "Origin")
            request.httpBody = try JSONEncoder().encode(["type": kind.rawValue, "language": language])
            let (data, response) = try await session.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw VoiceServiceError.unavailable }
            return try JSONDecoder().decode(VoiceToken.self, from: data)
        }
    }

    static func speech(_ text: String, voice: String = "Anna") throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: "lotse-live-\(UUID().uuidString).aiff")
        let say = Process()
        say.executableURL = URL(filePath: "/usr/bin/say")
        say.arguments = ["-v", voice, "-o", url.path, text]
        try say.run()
        say.waitUntilExit()
        return url
    }

    static func normalized(_ text: String) -> String {
        text.lowercased().filter { $0.isLetter || $0 == " " }
    }
}

@Test("Live: Scribe transcribes synthetic German speech accurately and quickly",
      .enabled(if: LiveVoice.base != nil),
      arguments: ["Wo beantrage ich Pflegegeld?", "Ich brauche Hilfe beim Antrag auf Erwerbsminderungsrente."])
@MainActor
func liveScribeTranscript(sentence: String) async throws {
    let base = try #require(LiveVoice.base)
    let audio = try LiveVoice.speech(sentence)
    defer { try? FileManager.default.removeItem(at: audio) }
    let buffers = try FileAudioSource.microphoneBuffers(of: audio)
    let source = try FileAudioSource(buffers: buffers, pace: .milliseconds(42))
    let provider = ScribeRealtimeTranscriptionProvider(
        loadToken: LiveVoice.loader(base: base), language: { "de" }, makeInput: { source }, requestAccess: { true }
    )
    var partials: [String] = []
    var final: String?
    var firstPartial: ContinuousClock.Instant?
    let pressed = ContinuousClock.now
    provider.onTranscript = { text, isFinal in
        if isFinal { final = text } else {
            if firstPartial == nil { firstPartial = .now }
            partials.append(text)
        }
    }
    source.onDrained = { provider.finish() }
    try await provider.start(whileHeld: { true })
    let ready = ContinuousClock.now - pressed
    let deadline = ContinuousClock.now + .seconds(15)
    while final == nil, ContinuousClock.now < deadline { try await Task.sleep(for: .milliseconds(20)) }
    let transcript = try #require(final)
    let release = provider.lastFinalLatency ?? .zero
    print("""
    LIVE SCRIBE "\(sentence)" → "\(transcript)"
      ready after \(ScribeRealtimeTranscriptionProvider.milliseconds(ready)) ms, \
    first partial after \(firstPartial.map { ScribeRealtimeTranscriptionProvider.milliseconds($0 - pressed) } ?? -1) ms, \
    partials \(partials.count), final \(ScribeRealtimeTranscriptionProvider.milliseconds(release)) ms after release
    """)
    #expect(LiveVoice.normalized(transcript) == LiveVoice.normalized(sentence))
    #expect(partials.isEmpty == false)
    #expect(release < .milliseconds(1500))
}
