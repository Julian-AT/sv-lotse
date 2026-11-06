import LotseProtocol

@MainActor
public final class SentenceActionScheduler {
    public var onAction: ((Action) -> Void)?
    private var pending: [String: Action] = [:]
    private var fired: Set<String> = []
    private var sentence: SpeechSegment?

    public init() {}
    public func enqueue(_ action: Action) {
        guard fired.contains(action.voiceID) == false else { return }
        pending[action.voiceID] = action
        fireReady()
    }
    public func start(_ sentence: SpeechSegment) {
        self.sentence = sentence
        fireReady()
    }
    public func beginTurn() { fired.removeAll(); sentence = nil }
    public func reset() { pending.removeAll(); fired.removeAll(); sentence = nil }
    private func fireReady() {
        guard let sentence else { return }
        let ready = pending.values.filter { $0.voiceSentenceIndex == sentence.index && sentence.actionIDS.contains($0.voiceID) }
        for action in ready {
            pending.removeValue(forKey: action.voiceID)
            fired.insert(action.voiceID)
            onAction?(action)
        }
    }
}
private extension Action {
    var voiceID: String {
        switch self {
        case .point(let value): value.id
        case .highlight(let value): value.id
        case .annotate(let value): value.id
        case .caption(let value): value.id
        case .openResource(let value): value.id
        case .type(let value): value.id
        case .clear(let value): value.id
        }
    }
    var voiceSentenceIndex: Int {
        switch self {
        case .point(let value): value.sentenceIndex
        case .highlight(let value): value.sentenceIndex
        case .annotate(let value): value.sentenceIndex
        case .caption(let value): value.sentenceIndex
        case .openResource(let value): value.sentenceIndex
        case .type(let value): value.sentenceIndex
        case .clear(let value): value.sentenceIndex
        }
    }
}
