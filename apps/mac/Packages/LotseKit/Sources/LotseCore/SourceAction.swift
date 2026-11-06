import LotseProtocol

extension Action {
    var sourceActionID: String {
        switch self {
        case .annotate(let value): value.id
        case .caption(let value): value.id
        case .clear(let value): value.id
        case .highlight(let value): value.id
        case .openResource(let value): value.id
        case .point(let value): value.id
        case .type(let value): value.id
        }
    }

    var sourceSentenceIndex: Int {
        switch self {
        case .annotate(let value): value.sentenceIndex
        case .caption(let value): value.sentenceIndex
        case .clear(let value): value.sentenceIndex
        case .highlight(let value): value.sentenceIndex
        case .openResource(let value): value.sentenceIndex
        case .point(let value): value.sentenceIndex
        case .type(let value): value.sentenceIndex
        }
    }

    var sourceText: TargetText? {
        let target: Target
        switch self {
        case .annotate(let value): target = value.target
        case .highlight(let value): target = value.target
        case .point(let value): target = value.target
        default: return nil
        }
        if case .text(let text) = target { return text }
        return nil
    }
}
