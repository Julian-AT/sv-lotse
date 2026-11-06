import LotseProtocol

struct NativeOverlayAction: Sendable {
    enum Kind { case point, highlight, annotate, caption, typing }
    let id: String
    let sentenceIndex: Int
    let target: Target
    let kind: Kind
    let label: String?
    let style: String?

    init?(_ action: Action) {
        switch action {
        case .point(let value):
            self.init(id: value.id, sentenceIndex: value.sentenceIndex, target: value.target, kind: .point,
                label: value.payload.label, style: value.payload.style)
        case .highlight(let value):
            self.init(id: value.id, sentenceIndex: value.sentenceIndex, target: value.target, kind: .highlight,
                label: value.payload.label, style: value.payload.style)
        case .annotate(let value):
            self.init(id: value.id, sentenceIndex: value.sentenceIndex, target: value.target, kind: .annotate,
                label: value.payload.label, style: value.payload.style)
        case .caption(let value):
            self.init(id: value.id, sentenceIndex: value.sentenceIndex, target: value.target, kind: .caption,
                label: value.payload.label, style: value.payload.style)
        case .type(let value):
            self.init(id: value.id, sentenceIndex: value.sentenceIndex, target: value.target, kind: .typing, label: nil, style: nil)
        default: return nil
        }
    }

    private init(id: String, sentenceIndex: Int, target: Target, kind: Kind, label: String?, style: String?) {
        self.id = id
        self.sentenceIndex = sentenceIndex
        self.target = target
        self.kind = kind
        self.label = label
        self.style = style
    }

    var failureMethod: ResolvedBy {
        switch target {
        case .ui, .form: .ui
        case .dom: .dom
        case .ax: .ax
        case .text: .ocr
        case .point: .vision
        }
    }
}
