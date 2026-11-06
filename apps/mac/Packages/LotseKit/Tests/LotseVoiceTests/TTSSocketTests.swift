import Foundation
import LotseProtocol
import Testing

@testable import LotseVoice

@Test("Sentences of several turns share one socket; each is flushed and closed right away; barge-in keeps it")
@MainActor
func sentencesShareOneSocket() async throws {
    let harness = SocketHarness()
    let output = harness.output()
    output.prefetch(sentence("a", 0))
    output.prefetch(sentence("a", 1))
    output.prefetch(sentence("b", 0))
    await settle { harness.transports.first?.texts.count == 3 }
    #expect(harness.tokens == 1)
    #expect(harness.transports.count == 1)
    let query = try #require(harness.urls.first?.query)
    #expect(query.contains("auto_mode=true"))
    #expect(query.contains("inactivity_timeout=180"))
    #expect(query.contains("output_format=pcm_24000"))
    let transport = try #require(harness.transports.first)
    #expect(transport.messages.first?["context_id"] as? String == TTSStream.keepaliveContext)
    for text in transport.texts {
        #expect(text["flush"] as? Bool == true)
        let context = text["context_id"] as? String
        #expect(transport.messages.contains { $0["context_id"] as? String == context && $0["close_context"] as? Bool == true })
    }
    output.stop()
    output.prefetch(sentence("c", 0))
    await settle { transport.texts.count == 4 }
    #expect(transport.texts.count == 4)
    #expect(transport.closed == false)
    #expect(harness.transports.count == 1)
}

@Test("A socket that drops mid-conversation is replaced in the background, once per interval")
@MainActor
func droppedSocketReopensInBackground() async throws {
    let harness = SocketHarness()
    let output = harness.output()
    output.prewarm(language: "de-AT")
    await settle { harness.transports.count == 1 }
    harness.transports[0].deliver(.failure(URLError(.networkConnectionLost)))
    await settle { harness.transports.count == 2 }
    #expect(harness.transports.count == 2)
    output.prefetch(sentence("a", 0))
    await settle { harness.transports[1].texts.count == 1 }
    #expect(harness.transports[1].texts.count == 1)
    harness.transports[1].deliver(.failure(URLError(.networkConnectionLost)))
    try await Task.sleep(for: .milliseconds(50))
    #expect(harness.transports.count == 2)
    output.prefetch(sentence("a", 1))
    await settle { harness.transports.count == 3 }
    #expect(harness.transports.count == 3)
}

@Test("Audio is routed by context, buffered until read, and an empty final refuses the voice")
@MainActor
func audioRoutesByContext() async throws {
    let transport = FakeTransport()
    let stream = TTSStream(transport: transport, language: "de", voice: "v", aliases: [],
                           keepaliveInterval: .seconds(60), idleLimit: .seconds(600))
    let first = stream.synthesize("Erster Satz.")
    let second = stream.synthesize("Zweiter Satz.")
    let refused = stream.synthesize("Dritter Satz.")
    transport.audio(second.context, Data([2, 0]), final: true)
    transport.audio(first.context, Data([1, 0]), final: false)
    transport.audio(first.context, Data([3, 0]), final: true)
    transport.deliver(.success(Data(#"{"contextId":"\#(refused.context)","isFinal":true}"#.utf8)))
    var firstAudio = Data()
    for try await chunk in first.audio { firstAudio.append(chunk) }
    var secondAudio = Data()
    for try await chunk in second.audio { secondAudio.append(chunk) }
    #expect(firstAudio == Data([1, 0, 3, 0]))
    #expect(secondAudio == Data([2, 0]))
    #expect(first.firstAudio != nil)
    await #expect(throws: VoiceProviderError.self) { for try await _ in refused.audio {} }
    #expect(stream.isOpen)
}

@Test("The keepalive context holds the socket open and an idle conversation closes it without reopening")
@MainActor
func keepaliveAndIdleClose() async {
    let transport = FakeTransport()
    var closes: [Error?] = []
    let stream = TTSStream(transport: transport, language: "de", voice: "v", aliases: [],
                           keepaliveInterval: .milliseconds(10), idleLimit: .milliseconds(60))
    stream.onClose = { closes.append($0) }
    await settle { transport.messages.contains { $0["text"] as? String == "" } }
    #expect(transport.messages.contains {
        $0["text"] as? String == "" && $0["context_id"] as? String == TTSStream.keepaliveContext
    })
    await settle { transport.closed }
    #expect(transport.closed)
    #expect(stream.isOpen == false)
    #expect(closes.count == 1)
    #expect(closes.first.map { $0 == nil } == true)
}

@MainActor
private final class SocketHarness {
    var tokens = 0
    var urls: [URL] = []
    var transports: [FakeTransport] = []

    func output() -> ElevenLabsSpeechOutput {
        ElevenLabsSpeechOutput(
            loadToken: { [self] _, _ in
                tokens += 1
                return VoiceToken(token: "token", voiceId: "voice", modelId: "eleven_flash_v2_5", vocabulary: nil)
            },
            connect: { [self] url in
                urls.append(url)
                let transport = FakeTransport()
                transports.append(transport)
                return transport
            },
            keepaliveInterval: .seconds(60), idleLimit: .seconds(600)
        )
    }
}

@MainActor
private final class FakeTransport: TTSTransport {
    var messages: [[String: Any]] = []
    var closed = false
    private var pending: [Result<Data, Error>] = []
    private var waiter: CheckedContinuation<Data, Error>?

    var texts: [[String: Any]] {
        messages.filter { ($0["text"] as? String)?.trimmingCharacters(in: .whitespaces).isEmpty == false }
    }

    func send(_ text: String) async throws {
        guard closed == false else { throw URLError(.networkConnectionLost) }
        let object = try JSONSerialization.jsonObject(with: Data(text.utf8))
        messages.append(object as? [String: Any] ?? [:])
    }

    func receive() async throws -> Data {
        if pending.isEmpty == false { return try pending.removeFirst().get() }
        return try await withCheckedThrowingContinuation { waiter = $0 }
    }

    func close() {
        closed = true
        deliver(.failure(CancellationError()))
    }

    func deliver(_ result: Result<Data, Error>) {
        guard let waiter else { return pending.append(result) }
        self.waiter = nil
        waiter.resume(with: result)
    }

    func audio(_ context: String, _ pcm: Data, final: Bool) {
        deliver(.success(Data(#"{"audio":"\#(pcm.base64EncodedString())","contextId":"\#(context)"}"#.utf8)))
        if final { deliver(.success(Data(#"{"contextId":"\#(context)","isFinal":true}"#.utf8))) }
    }
}

private func sentence(_ turn: String, _ index: Int) -> SpeechSegment {
    SpeechSegment(actionIDS: [], citations: [], index: index, language: "de", text: "Satz \(index).", turnID: turn)
}

@MainActor
private func settle(until condition: () -> Bool) async {
    for _ in 0..<100 where condition() == false { try? await Task.sleep(for: .milliseconds(5)) }
}
