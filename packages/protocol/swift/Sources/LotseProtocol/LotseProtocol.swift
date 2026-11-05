// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let lotseProtocolBundle = try? JSONDecoder().decode(LotseProtocolBundle.self, from: jsonData)

import Foundation

// MARK: - LotseProtocolBundle
public struct LotseProtocolBundle: Codable, Equatable, Sendable {
    public let action: Action
    public let actionResult: ActionResult
    public let approvalContext: ApprovalContext
    public let approvalDecision: ApprovalDecision
    public let boundingBox: BoundingBox
    public let bridgeHello: BridgeHello
    public let bridgeToNative: BridgeToNative
    public let bridgeToWorkspace: BridgeToWorkspace
    public let capabilities: Capabilities
    public let caseEvent: CaseEvent
    public let clientHello: ClientHello
    public let contextCapsule: ContextCapsule
    public let fact: Fact
    public let factSource: FactSource
    public let id: String
    public let isoTimestamp: String
    public let jobProgress: JobProgress
    public let jsonValue: JSONValue
    public let languageTag: String
    public let provenance: Provenance
    public let safetyNotice: SafetyNotice
    public let speechControl: SpeechControl
    public let speechSegment: SpeechSegment
    public let target: Target
    public let targetRect: TargetRect
    public let toolInvocation: ToolInvocation
    public let toolOutput: ToolOutput
    public let transcript: Transcript
    public let turnRequest: TurnRequest
    public let windowRect: WindowRect

    public enum CodingKeys: String, CodingKey {
        case action = "Action"
        case actionResult = "ActionResult"
        case approvalContext = "ApprovalContext"
        case approvalDecision = "ApprovalDecision"
        case boundingBox = "BoundingBox"
        case bridgeHello = "BridgeHello"
        case bridgeToNative = "BridgeToNative"
        case bridgeToWorkspace = "BridgeToWorkspace"
        case capabilities = "Capabilities"
        case caseEvent = "CaseEvent"
        case clientHello = "ClientHello"
        case contextCapsule = "ContextCapsule"
        case fact = "Fact"
        case factSource = "FactSource"
        case id = "Id"
        case isoTimestamp = "IsoTimestamp"
        case jobProgress = "JobProgress"
        case jsonValue = "JsonValue"
        case languageTag = "LanguageTag"
        case provenance = "Provenance"
        case safetyNotice = "SafetyNotice"
        case speechControl = "SpeechControl"
        case speechSegment = "SpeechSegment"
        case target = "Target"
        case targetRect = "TargetRect"
        case toolInvocation = "ToolInvocation"
        case toolOutput = "ToolOutput"
        case transcript = "Transcript"
        case turnRequest = "TurnRequest"
        case windowRect = "WindowRect"
    }

    public init(action: Action, actionResult: ActionResult, approvalContext: ApprovalContext, approvalDecision: ApprovalDecision, boundingBox: BoundingBox, bridgeHello: BridgeHello, bridgeToNative: BridgeToNative, bridgeToWorkspace: BridgeToWorkspace, capabilities: Capabilities, caseEvent: CaseEvent, clientHello: ClientHello, contextCapsule: ContextCapsule, fact: Fact, factSource: FactSource, id: String, isoTimestamp: String, jobProgress: JobProgress, jsonValue: JSONValue, languageTag: String, provenance: Provenance, safetyNotice: SafetyNotice, speechControl: SpeechControl, speechSegment: SpeechSegment, target: Target, targetRect: TargetRect, toolInvocation: ToolInvocation, toolOutput: ToolOutput, transcript: Transcript, turnRequest: TurnRequest, windowRect: WindowRect) {
        self.action = action
        self.actionResult = actionResult
        self.approvalContext = approvalContext
        self.approvalDecision = approvalDecision
        self.boundingBox = boundingBox
        self.bridgeHello = bridgeHello
        self.bridgeToNative = bridgeToNative
        self.bridgeToWorkspace = bridgeToWorkspace
        self.capabilities = capabilities
        self.caseEvent = caseEvent
        self.clientHello = clientHello
        self.contextCapsule = contextCapsule
        self.fact = fact
        self.factSource = factSource
        self.id = id
        self.isoTimestamp = isoTimestamp
        self.jobProgress = jobProgress
        self.jsonValue = jsonValue
        self.languageTag = languageTag
        self.provenance = provenance
        self.safetyNotice = safetyNotice
        self.speechControl = speechControl
        self.speechSegment = speechSegment
        self.target = target
        self.targetRect = targetRect
        self.toolInvocation = toolInvocation
        self.toolOutput = toolOutput
        self.transcript = transcript
        self.turnRequest = turnRequest
        self.windowRect = windowRect
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["Action", "ActionResult", "ApprovalContext", "ApprovalDecision", "BoundingBox", "BridgeHello", "BridgeToNative", "BridgeToWorkspace", "Capabilities", "CaseEvent", "ClientHello", "ContextCapsule", "Fact", "FactSource", "Id", "IsoTimestamp", "JobProgress", "JsonValue", "LanguageTag", "Provenance", "SafetyNotice", "SpeechControl", "SpeechSegment", "Target", "TargetRect", "ToolInvocation", "ToolOutput", "Transcript", "TurnRequest", "WindowRect"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown LotseProtocolBundle field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.action = try container.decode(Action.self, forKey: .action)
        self.actionResult = try container.decode(ActionResult.self, forKey: .actionResult)
        self.approvalContext = try container.decode(ApprovalContext.self, forKey: .approvalContext)
        self.approvalDecision = try container.decode(ApprovalDecision.self, forKey: .approvalDecision)
        self.boundingBox = try container.decode(BoundingBox.self, forKey: .boundingBox)
        self.bridgeHello = try container.decode(BridgeHello.self, forKey: .bridgeHello)
        self.bridgeToNative = try container.decode(BridgeToNative.self, forKey: .bridgeToNative)
        self.bridgeToWorkspace = try container.decode(BridgeToWorkspace.self, forKey: .bridgeToWorkspace)
        self.capabilities = try container.decode(Capabilities.self, forKey: .capabilities)
        self.caseEvent = try container.decode(CaseEvent.self, forKey: .caseEvent)
        self.clientHello = try container.decode(ClientHello.self, forKey: .clientHello)
        self.contextCapsule = try container.decode(ContextCapsule.self, forKey: .contextCapsule)
        self.fact = try container.decode(Fact.self, forKey: .fact)
        self.factSource = try container.decode(FactSource.self, forKey: .factSource)
        self.id = try container.decode(String.self, forKey: .id)
        self.isoTimestamp = try container.decode(String.self, forKey: .isoTimestamp)
        self.jobProgress = try container.decode(JobProgress.self, forKey: .jobProgress)
        self.jsonValue = try container.decode(JSONValue.self, forKey: .jsonValue)
        self.languageTag = try container.decode(String.self, forKey: .languageTag)
        self.provenance = try container.decode(Provenance.self, forKey: .provenance)
        self.safetyNotice = try container.decode(SafetyNotice.self, forKey: .safetyNotice)
        self.speechControl = try container.decode(SpeechControl.self, forKey: .speechControl)
        self.speechSegment = try container.decode(SpeechSegment.self, forKey: .speechSegment)
        self.target = try container.decode(Target.self, forKey: .target)
        self.targetRect = try container.decode(TargetRect.self, forKey: .targetRect)
        self.toolInvocation = try container.decode(ToolInvocation.self, forKey: .toolInvocation)
        self.toolOutput = try container.decode(ToolOutput.self, forKey: .toolOutput)
        self.transcript = try container.decode(Transcript.self, forKey: .transcript)
        self.turnRequest = try container.decode(TurnRequest.self, forKey: .turnRequest)
        self.windowRect = try container.decode(WindowRect.self, forKey: .windowRect)
    }
}

// MARK: - Action
public enum Action: Codable, Equatable, Sendable {
    case point(ActionPoint)
    case highlight(ActionHighlight)
    case annotate(ActionAnnotate)
    case caption(ActionCaption)
    case openResource(ActionOpenResource)
    case type(ActionType)
    case clear(ActionClear)

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let tag = try container.decode(String.self, forKey: ProtocolCodingKey("kind"))
        switch tag {
        case "point": self = .point(try ActionPoint(from: decoder))
        case "highlight": self = .highlight(try ActionHighlight(from: decoder))
        case "annotate": self = .annotate(try ActionAnnotate(from: decoder))
        case "caption": self = .caption(try ActionCaption(from: decoder))
        case "openResource": self = .openResource(try ActionOpenResource(from: decoder))
        case "type": self = .type(try ActionType(from: decoder))
        case "clear": self = .clear(try ActionClear(from: decoder))
        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Action tag"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .point(let value): try value.encode(to: encoder)
        case .highlight(let value): try value.encode(to: encoder)
        case .annotate(let value): try value.encode(to: encoder)
        case .caption(let value): try value.encode(to: encoder)
        case .openResource(let value): try value.encode(to: encoder)
        case .type(let value): try value.encode(to: encoder)
        case .clear(let value): try value.encode(to: encoder)
        }
    }
}

// MARK: - ActionAnnotate
public struct ActionAnnotate: Codable, Equatable, Sendable {
    public let id: String
    public let kind: AnnotateKind
    public let payload: AnnotatePayload
    public let sentenceIndex: Int
    public let target: Target

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case payload = "payload"
        case sentenceIndex = "sentenceIndex"
        case target = "target"
    }

    public init(id: String, kind: AnnotateKind, payload: AnnotatePayload, sentenceIndex: Int, target: Target) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.sentenceIndex = sentenceIndex
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "kind", "payload", "sentenceIndex", "target"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionAnnotate field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.kind = try container.decode(AnnotateKind.self, forKey: .kind)
        self.payload = try container.decode(AnnotatePayload.self, forKey: .payload)
        self.sentenceIndex = try container.decode(Int.self, forKey: .sentenceIndex)
        self.target = try container.decode(Target.self, forKey: .target)
    }
}

public enum AnnotateKind: String, Codable, Equatable, Sendable {
    case annotate = "annotate"
}

// MARK: - AnnotatePayload
public struct AnnotatePayload: Codable, Equatable, Sendable {
    public let label: String?
    public let style: String?

    public enum CodingKeys: String, CodingKey {
        case label = "label"
        case style = "style"
    }

    public init(label: String?, style: String?) {
        self.label = label
        self.style = style
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["label", "style"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown AnnotatePayload field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.label), try container.decodeNil(forKey: .label) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null label"))
        }
        self.label = try container.decodeIfPresent(String.self, forKey: .label)
        if container.contains(.style), try container.decodeNil(forKey: .style) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null style"))
        }
        self.style = try container.decodeIfPresent(String.self, forKey: .style)
    }
}

// MARK: - Target
public enum Target: Codable, Equatable, Sendable {
    case ui(TargetUI)
    case form(TargetForm)
    case dom(TargetDOM)
    case ax(TargetAx)
    case text(TargetText)
    case point(TargetPoint)

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let tag = try container.decode(String.self, forKey: ProtocolCodingKey("kind"))
        switch tag {
        case "ui": self = .ui(try TargetUI(from: decoder))
        case "form": self = .form(try TargetForm(from: decoder))
        case "dom": self = .dom(try TargetDOM(from: decoder))
        case "ax": self = .ax(try TargetAx(from: decoder))
        case "text": self = .text(try TargetText(from: decoder))
        case "point": self = .point(try TargetPoint(from: decoder))
        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Target tag"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .ui(let value): try value.encode(to: encoder)
        case .form(let value): try value.encode(to: encoder)
        case .dom(let value): try value.encode(to: encoder)
        case .ax(let value): try value.encode(to: encoder)
        case .text(let value): try value.encode(to: encoder)
        case .point(let value): try value.encode(to: encoder)
        }
    }
}

// MARK: - TargetAx
public struct TargetAx: Codable, Equatable, Sendable {
    public let appBundleID: String
    public let kind: AxKind
    public let label: String
    public let path: [String]
    public let role: String

    public enum CodingKeys: String, CodingKey {
        case appBundleID = "appBundleId"
        case kind = "kind"
        case label = "label"
        case path = "path"
        case role = "role"
    }

    public init(appBundleID: String, kind: AxKind, label: String, path: [String], role: String) {
        self.appBundleID = appBundleID
        self.kind = kind
        self.label = label
        self.path = path
        self.role = role
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["appBundleId", "kind", "label", "path", "role"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TargetAx field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.appBundleID = try container.decode(String.self, forKey: .appBundleID)
        self.kind = try container.decode(AxKind.self, forKey: .kind)
        self.label = try container.decode(String.self, forKey: .label)
        self.path = try container.decode([String].self, forKey: .path)
        self.role = try container.decode(String.self, forKey: .role)
    }
}

public enum AxKind: String, Codable, Equatable, Sendable {
    case ax = "ax"
}

// MARK: - TargetDOM
public struct TargetDOM: Codable, Equatable, Sendable {
    public let handle: String
    public let kind: DOMKind
    public let url: String

    public enum CodingKeys: String, CodingKey {
        case handle = "handle"
        case kind = "kind"
        case url = "url"
    }

    public init(handle: String, kind: DOMKind, url: String) {
        self.handle = handle
        self.kind = kind
        self.url = url
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["handle", "kind", "url"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TargetDOM field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.handle = try container.decode(String.self, forKey: .handle)
        self.kind = try container.decode(DOMKind.self, forKey: .kind)
        self.url = try container.decode(String.self, forKey: .url)
    }
}

public enum DOMKind: String, Codable, Equatable, Sendable {
    case dom = "dom"
}

// MARK: - TargetForm
public struct TargetForm: Codable, Equatable, Sendable {
    public let fieldID: String
    public let formInstanceID: String
    public let kind: FormKind

    public enum CodingKeys: String, CodingKey {
        case fieldID = "fieldId"
        case formInstanceID = "formInstanceId"
        case kind = "kind"
    }

    public init(fieldID: String, formInstanceID: String, kind: FormKind) {
        self.fieldID = fieldID
        self.formInstanceID = formInstanceID
        self.kind = kind
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["fieldId", "formInstanceId", "kind"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TargetForm field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.fieldID = try container.decode(String.self, forKey: .fieldID)
        self.formInstanceID = try container.decode(String.self, forKey: .formInstanceID)
        self.kind = try container.decode(FormKind.self, forKey: .kind)
    }
}

public enum FormKind: String, Codable, Equatable, Sendable {
    case form = "form"
}

// MARK: - TargetPoint
public struct TargetPoint: Codable, Equatable, Sendable {
    public let confidence: Double
    public let kind: PointKind
    public let screenIndex: Int
    public let x: Double
    public let y: Double

    public enum CodingKeys: String, CodingKey {
        case confidence = "confidence"
        case kind = "kind"
        case screenIndex = "screenIndex"
        case x = "x"
        case y = "y"
    }

    public init(confidence: Double, kind: PointKind, screenIndex: Int, x: Double, y: Double) {
        self.confidence = confidence
        self.kind = kind
        self.screenIndex = screenIndex
        self.x = x
        self.y = y
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["confidence", "kind", "screenIndex", "x", "y"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TargetPoint field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.confidence = try container.decode(Double.self, forKey: .confidence)
        self.kind = try container.decode(PointKind.self, forKey: .kind)
        self.screenIndex = try container.decode(Int.self, forKey: .screenIndex)
        self.x = try container.decode(Double.self, forKey: .x)
        self.y = try container.decode(Double.self, forKey: .y)
    }
}

public enum PointKind: String, Codable, Equatable, Sendable {
    case point = "point"
}

// MARK: - TargetText
public struct TargetText: Codable, Equatable, Sendable {
    public let documentID: String?
    public let kind: TextKind
    public let page: Int?
    public let quote: String

    public enum CodingKeys: String, CodingKey {
        case documentID = "documentId"
        case kind = "kind"
        case page = "page"
        case quote = "quote"
    }

    public init(documentID: String?, kind: TextKind, page: Int?, quote: String) {
        self.documentID = documentID
        self.kind = kind
        self.page = page
        self.quote = quote
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["documentId", "kind", "page", "quote"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TargetText field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.documentID), try container.decodeNil(forKey: .documentID) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null documentId"))
        }
        self.documentID = try container.decodeIfPresent(String.self, forKey: .documentID)
        self.kind = try container.decode(TextKind.self, forKey: .kind)
        if container.contains(.page), try container.decodeNil(forKey: .page) {
            throw DecodingError.valueNotFound(Int.self, .init(codingPath: decoder.codingPath, debugDescription: "Null page"))
        }
        self.page = try container.decodeIfPresent(Int.self, forKey: .page)
        self.quote = try container.decode(String.self, forKey: .quote)
    }
}

public enum TextKind: String, Codable, Equatable, Sendable {
    case text = "text"
}

// MARK: - TargetUI
public struct TargetUI: Codable, Equatable, Sendable {
    public let elementID: String
    public let kind: UIKind

    public enum CodingKeys: String, CodingKey {
        case elementID = "elementId"
        case kind = "kind"
    }

    public init(elementID: String, kind: UIKind) {
        self.elementID = elementID
        self.kind = kind
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["elementId", "kind"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TargetUI field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.elementID = try container.decode(String.self, forKey: .elementID)
        self.kind = try container.decode(UIKind.self, forKey: .kind)
    }
}

public enum UIKind: String, Codable, Equatable, Sendable {
    case ui = "ui"
}

// MARK: - ActionCaption
public struct ActionCaption: Codable, Equatable, Sendable {
    public let id: String
    public let kind: CaptionKind
    public let payload: CaptionPayload
    public let sentenceIndex: Int
    public let target: Target

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case payload = "payload"
        case sentenceIndex = "sentenceIndex"
        case target = "target"
    }

    public init(id: String, kind: CaptionKind, payload: CaptionPayload, sentenceIndex: Int, target: Target) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.sentenceIndex = sentenceIndex
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "kind", "payload", "sentenceIndex", "target"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionCaption field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.kind = try container.decode(CaptionKind.self, forKey: .kind)
        self.payload = try container.decode(CaptionPayload.self, forKey: .payload)
        self.sentenceIndex = try container.decode(Int.self, forKey: .sentenceIndex)
        self.target = try container.decode(Target.self, forKey: .target)
    }
}

public enum CaptionKind: String, Codable, Equatable, Sendable {
    case caption = "caption"
}

// MARK: - CaptionPayload
public struct CaptionPayload: Codable, Equatable, Sendable {
    public let label: String?
    public let style: String?

    public enum CodingKeys: String, CodingKey {
        case label = "label"
        case style = "style"
    }

    public init(label: String?, style: String?) {
        self.label = label
        self.style = style
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["label", "style"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown CaptionPayload field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.label), try container.decodeNil(forKey: .label) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null label"))
        }
        self.label = try container.decodeIfPresent(String.self, forKey: .label)
        if container.contains(.style), try container.decodeNil(forKey: .style) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null style"))
        }
        self.style = try container.decodeIfPresent(String.self, forKey: .style)
    }
}

// MARK: - ActionClear
public struct ActionClear: Codable, Equatable, Sendable {
    public let id: String
    public let kind: ClearKind
    public let payload: ClearPayload
    public let sentenceIndex: Int
    public let target: Target

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case payload = "payload"
        case sentenceIndex = "sentenceIndex"
        case target = "target"
    }

    public init(id: String, kind: ClearKind, payload: ClearPayload, sentenceIndex: Int, target: Target) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.sentenceIndex = sentenceIndex
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "kind", "payload", "sentenceIndex", "target"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionClear field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.kind = try container.decode(ClearKind.self, forKey: .kind)
        self.payload = try container.decode(ClearPayload.self, forKey: .payload)
        self.sentenceIndex = try container.decode(Int.self, forKey: .sentenceIndex)
        self.target = try container.decode(Target.self, forKey: .target)
    }
}

public enum ClearKind: String, Codable, Equatable, Sendable {
    case clear = "clear"
}

// MARK: - ClearPayload
public struct ClearPayload: Codable, Equatable, Sendable {
    public let label: String?
    public let style: String?

    public enum CodingKeys: String, CodingKey {
        case label = "label"
        case style = "style"
    }

    public init(label: String?, style: String?) {
        self.label = label
        self.style = style
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["label", "style"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ClearPayload field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.label), try container.decodeNil(forKey: .label) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null label"))
        }
        self.label = try container.decodeIfPresent(String.self, forKey: .label)
        if container.contains(.style), try container.decodeNil(forKey: .style) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null style"))
        }
        self.style = try container.decodeIfPresent(String.self, forKey: .style)
    }
}

// MARK: - ActionHighlight
public struct ActionHighlight: Codable, Equatable, Sendable {
    public let id: String
    public let kind: HighlightKind
    public let payload: HighlightPayload
    public let sentenceIndex: Int
    public let target: Target

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case payload = "payload"
        case sentenceIndex = "sentenceIndex"
        case target = "target"
    }

    public init(id: String, kind: HighlightKind, payload: HighlightPayload, sentenceIndex: Int, target: Target) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.sentenceIndex = sentenceIndex
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "kind", "payload", "sentenceIndex", "target"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionHighlight field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.kind = try container.decode(HighlightKind.self, forKey: .kind)
        self.payload = try container.decode(HighlightPayload.self, forKey: .payload)
        self.sentenceIndex = try container.decode(Int.self, forKey: .sentenceIndex)
        self.target = try container.decode(Target.self, forKey: .target)
    }
}

public enum HighlightKind: String, Codable, Equatable, Sendable {
    case highlight = "highlight"
}

// MARK: - HighlightPayload
public struct HighlightPayload: Codable, Equatable, Sendable {
    public let label: String?
    public let style: String?

    public enum CodingKeys: String, CodingKey {
        case label = "label"
        case style = "style"
    }

    public init(label: String?, style: String?) {
        self.label = label
        self.style = style
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["label", "style"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown HighlightPayload field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.label), try container.decodeNil(forKey: .label) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null label"))
        }
        self.label = try container.decodeIfPresent(String.self, forKey: .label)
        if container.contains(.style), try container.decodeNil(forKey: .style) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null style"))
        }
        self.style = try container.decodeIfPresent(String.self, forKey: .style)
    }
}

// MARK: - ActionOpenResource
public struct ActionOpenResource: Codable, Equatable, Sendable {
    public let id: String
    public let kind: OpenResourceKind
    public let payload: OpenResourcePayload
    public let sentenceIndex: Int
    public let target: Target

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case payload = "payload"
        case sentenceIndex = "sentenceIndex"
        case target = "target"
    }

    public init(id: String, kind: OpenResourceKind, payload: OpenResourcePayload, sentenceIndex: Int, target: Target) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.sentenceIndex = sentenceIndex
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "kind", "payload", "sentenceIndex", "target"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionOpenResource field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.kind = try container.decode(OpenResourceKind.self, forKey: .kind)
        self.payload = try container.decode(OpenResourcePayload.self, forKey: .payload)
        self.sentenceIndex = try container.decode(Int.self, forKey: .sentenceIndex)
        self.target = try container.decode(Target.self, forKey: .target)
    }
}

public enum OpenResourceKind: String, Codable, Equatable, Sendable {
    case openResource = "openResource"
}

// MARK: - OpenResourcePayload
public struct OpenResourcePayload: Codable, Equatable, Sendable {
    public let label: String?
    public let style: String?

    public enum CodingKeys: String, CodingKey {
        case label = "label"
        case style = "style"
    }

    public init(label: String?, style: String?) {
        self.label = label
        self.style = style
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["label", "style"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown OpenResourcePayload field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.label), try container.decodeNil(forKey: .label) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null label"))
        }
        self.label = try container.decodeIfPresent(String.self, forKey: .label)
        if container.contains(.style), try container.decodeNil(forKey: .style) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null style"))
        }
        self.style = try container.decodeIfPresent(String.self, forKey: .style)
    }
}

// MARK: - ActionPoint
public struct ActionPoint: Codable, Equatable, Sendable {
    public let id: String
    public let kind: PointKind
    public let payload: PointPayload
    public let sentenceIndex: Int
    public let target: Target

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case payload = "payload"
        case sentenceIndex = "sentenceIndex"
        case target = "target"
    }

    public init(id: String, kind: PointKind, payload: PointPayload, sentenceIndex: Int, target: Target) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.sentenceIndex = sentenceIndex
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "kind", "payload", "sentenceIndex", "target"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionPoint field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.kind = try container.decode(PointKind.self, forKey: .kind)
        self.payload = try container.decode(PointPayload.self, forKey: .payload)
        self.sentenceIndex = try container.decode(Int.self, forKey: .sentenceIndex)
        self.target = try container.decode(Target.self, forKey: .target)
    }
}

// MARK: - PointPayload
public struct PointPayload: Codable, Equatable, Sendable {
    public let label: String?
    public let style: String?

    public enum CodingKeys: String, CodingKey {
        case label = "label"
        case style = "style"
    }

    public init(label: String?, style: String?) {
        self.label = label
        self.style = style
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["label", "style"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown PointPayload field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.label), try container.decodeNil(forKey: .label) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null label"))
        }
        self.label = try container.decodeIfPresent(String.self, forKey: .label)
        if container.contains(.style), try container.decodeNil(forKey: .style) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null style"))
        }
        self.style = try container.decodeIfPresent(String.self, forKey: .style)
    }
}

// MARK: - ActionType
public struct ActionType: Codable, Equatable, Sendable {
    public let id: String
    public let kind: TypeKind
    public let payload: TypePayload
    public let sentenceIndex: Int
    public let target: Target

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case payload = "payload"
        case sentenceIndex = "sentenceIndex"
        case target = "target"
    }

    public init(id: String, kind: TypeKind, payload: TypePayload, sentenceIndex: Int, target: Target) {
        self.id = id
        self.kind = kind
        self.payload = payload
        self.sentenceIndex = sentenceIndex
        self.target = target
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "kind", "payload", "sentenceIndex", "target"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionType field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.kind = try container.decode(TypeKind.self, forKey: .kind)
        self.payload = try container.decode(TypePayload.self, forKey: .payload)
        self.sentenceIndex = try container.decode(Int.self, forKey: .sentenceIndex)
        self.target = try container.decode(Target.self, forKey: .target)
    }
}

public enum TypeKind: String, Codable, Equatable, Sendable {
    case type = "type"
}

// MARK: - TypePayload
public struct TypePayload: Codable, Equatable, Sendable {
    public let pace: Double
    public let provenance: Provenance
    public let value: String

    public enum CodingKeys: String, CodingKey {
        case pace = "pace"
        case provenance = "provenance"
        case value = "value"
    }

    public init(pace: Double, provenance: Provenance, value: String) {
        self.pace = pace
        self.provenance = provenance
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["pace", "provenance", "value"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TypePayload field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.pace = try container.decode(Double.self, forKey: .pace)
        self.provenance = try container.decode(Provenance.self, forKey: .provenance)
        self.value = try container.decode(String.self, forKey: .value)
    }
}

// MARK: - Provenance
public struct Provenance: Codable, Equatable, Sendable {
    public let factID: String?
    public let source: FactSource

    public enum CodingKeys: String, CodingKey {
        case factID = "factId"
        case source = "source"
    }

    public init(factID: String?, source: FactSource) {
        self.factID = factID
        self.source = source
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["factId", "source"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Provenance field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.factID), try container.decodeNil(forKey: .factID) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null factId"))
        }
        self.factID = try container.decodeIfPresent(String.self, forKey: .factID)
        self.source = try container.decode(FactSource.self, forKey: .source)
    }
}

// MARK: - FactSource
public struct FactSource: Codable, Equatable, Sendable {
    public let bbox: BoundingBox?
    public let documentID: String?
    public let kind: FactSourceKind
    public let page: Int?
    public let quote: String?
    public let turnID: String?

    public enum CodingKeys: String, CodingKey {
        case bbox = "bbox"
        case documentID = "documentId"
        case kind = "kind"
        case page = "page"
        case quote = "quote"
        case turnID = "turnId"
    }

    public init(bbox: BoundingBox?, documentID: String?, kind: FactSourceKind, page: Int?, quote: String?, turnID: String?) {
        self.bbox = bbox
        self.documentID = documentID
        self.kind = kind
        self.page = page
        self.quote = quote
        self.turnID = turnID
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["bbox", "documentId", "kind", "page", "quote", "turnId"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown FactSource field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.bbox), try container.decodeNil(forKey: .bbox) {
            throw DecodingError.valueNotFound(BoundingBox.self, .init(codingPath: decoder.codingPath, debugDescription: "Null bbox"))
        }
        self.bbox = try container.decodeIfPresent(BoundingBox.self, forKey: .bbox)
        if container.contains(.documentID), try container.decodeNil(forKey: .documentID) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null documentId"))
        }
        self.documentID = try container.decodeIfPresent(String.self, forKey: .documentID)
        self.kind = try container.decode(FactSourceKind.self, forKey: .kind)
        if container.contains(.page), try container.decodeNil(forKey: .page) {
            throw DecodingError.valueNotFound(Int.self, .init(codingPath: decoder.codingPath, debugDescription: "Null page"))
        }
        self.page = try container.decodeIfPresent(Int.self, forKey: .page)
        if container.contains(.quote), try container.decodeNil(forKey: .quote) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null quote"))
        }
        self.quote = try container.decodeIfPresent(String.self, forKey: .quote)
        if container.contains(.turnID), try container.decodeNil(forKey: .turnID) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null turnId"))
        }
        self.turnID = try container.decodeIfPresent(String.self, forKey: .turnID)
    }
}

// MARK: - BoundingBox
public struct BoundingBox: Codable, Equatable, Sendable {
    public let height: Double
    public let width: Double
    public let x: Double
    public let y: Double

    public enum CodingKeys: String, CodingKey {
        case height = "height"
        case width = "width"
        case x = "x"
        case y = "y"
    }

    public init(height: Double, width: Double, x: Double, y: Double) {
        self.height = height
        self.width = width
        self.x = x
        self.y = y
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["height", "width", "x", "y"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BoundingBox field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.height = try container.decode(Double.self, forKey: .height)
        self.width = try container.decode(Double.self, forKey: .width)
        self.x = try container.decode(Double.self, forKey: .x)
        self.y = try container.decode(Double.self, forKey: .y)
    }
}

public enum FactSourceKind: String, Codable, Equatable, Sendable {
    case document = "document"
    case statement = "statement"
}

// MARK: - ActionResult
public struct ActionResult: Codable, Equatable, Sendable {
    public let actionID: String
    public let confidence: Double
    public let failureReason: String?
    public let resolvedBy: ResolvedBy
    public let success: Bool

    public enum CodingKeys: String, CodingKey {
        case actionID = "actionId"
        case confidence = "confidence"
        case failureReason = "failureReason"
        case resolvedBy = "resolvedBy"
        case success = "success"
    }

    public init(actionID: String, confidence: Double, failureReason: String?, resolvedBy: ResolvedBy, success: Bool) {
        self.actionID = actionID
        self.confidence = confidence
        self.failureReason = failureReason
        self.resolvedBy = resolvedBy
        self.success = success
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["actionId", "confidence", "failureReason", "resolvedBy", "success"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ActionResult field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.actionID = try container.decode(String.self, forKey: .actionID)
        self.confidence = try container.decode(Double.self, forKey: .confidence)
        if container.contains(.failureReason), try container.decodeNil(forKey: .failureReason) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null failureReason"))
        }
        self.failureReason = try container.decodeIfPresent(String.self, forKey: .failureReason)
        self.resolvedBy = try container.decode(ResolvedBy.self, forKey: .resolvedBy)
        self.success = try container.decode(Bool.self, forKey: .success)
    }
}

public enum ResolvedBy: String, Codable, Equatable, Sendable {
    case ax = "ax"
    case dom = "dom"
    case ocr = "ocr"
    case ui = "ui"
    case vision = "vision"
}

// MARK: - ApprovalContext
public struct ApprovalContext: Codable, Equatable, Sendable {
    public let approvalID: String
    public let caseID: String
    public let inputHash: String
    public let provenance: [Provenance]
    public let summary: String
    public let toolCallID: String
    public let toolName: String

    public enum CodingKeys: String, CodingKey {
        case approvalID = "approvalId"
        case caseID = "caseId"
        case inputHash = "inputHash"
        case provenance = "provenance"
        case summary = "summary"
        case toolCallID = "toolCallId"
        case toolName = "toolName"
    }

    public init(approvalID: String, caseID: String, inputHash: String, provenance: [Provenance], summary: String, toolCallID: String, toolName: String) {
        self.approvalID = approvalID
        self.caseID = caseID
        self.inputHash = inputHash
        self.provenance = provenance
        self.summary = summary
        self.toolCallID = toolCallID
        self.toolName = toolName
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["approvalId", "caseId", "inputHash", "provenance", "summary", "toolCallId", "toolName"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ApprovalContext field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.approvalID = try container.decode(String.self, forKey: .approvalID)
        self.caseID = try container.decode(String.self, forKey: .caseID)
        self.inputHash = try container.decode(String.self, forKey: .inputHash)
        self.provenance = try container.decode([Provenance].self, forKey: .provenance)
        self.summary = try container.decode(String.self, forKey: .summary)
        self.toolCallID = try container.decode(String.self, forKey: .toolCallID)
        self.toolName = try container.decode(String.self, forKey: .toolName)
    }
}

// MARK: - ApprovalDecision
public struct ApprovalDecision: Codable, Equatable, Sendable {
    public let approvalID: String
    public let approved: Bool
    public let reason: String?
    public let via: Via

    public enum CodingKeys: String, CodingKey {
        case approvalID = "approvalId"
        case approved = "approved"
        case reason = "reason"
        case via = "via"
    }

    public init(approvalID: String, approved: Bool, reason: String?, via: Via) {
        self.approvalID = approvalID
        self.approved = approved
        self.reason = reason
        self.via = via
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["approvalId", "approved", "reason", "via"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ApprovalDecision field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.approvalID = try container.decode(String.self, forKey: .approvalID)
        self.approved = try container.decode(Bool.self, forKey: .approved)
        if container.contains(.reason), try container.decodeNil(forKey: .reason) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null reason"))
        }
        self.reason = try container.decodeIfPresent(String.self, forKey: .reason)
        self.via = try container.decode(Via.self, forKey: .via)
    }
}

public enum Via: String, Codable, Equatable, Sendable {
    case click = "click"
    case key = "key"
    case voice = "voice"
}

// MARK: - BridgeHello
public struct BridgeHello: Codable, Equatable, Sendable {
    public let appVersion: String
    public let capabilities: Capabilities
    public let protocolVersion: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case appVersion = "appVersion"
        case capabilities = "capabilities"
        case protocolVersion = "protocolVersion"
    }

    public init(appVersion: String, capabilities: Capabilities, protocolVersion: ProtocolVersion) {
        self.appVersion = appVersion
        self.capabilities = capabilities
        self.protocolVersion = protocolVersion
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["appVersion", "capabilities", "protocolVersion"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeHello field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.appVersion = try container.decode(String.self, forKey: .appVersion)
        self.capabilities = try container.decode(Capabilities.self, forKey: .capabilities)
        self.protocolVersion = try container.decode(ProtocolVersion.self, forKey: .protocolVersion)
    }
}

// MARK: - Capabilities
public struct Capabilities: Codable, Equatable, Sendable {
    public let accessibility: Bool
    public let ocr: Bool
    public let onDeviceContextSize: Int
    public let onDeviceModel: Bool
    public let overlay: Bool

    public enum CodingKeys: String, CodingKey {
        case accessibility = "accessibility"
        case ocr = "ocr"
        case onDeviceContextSize = "onDeviceContextSize"
        case onDeviceModel = "onDeviceModel"
        case overlay = "overlay"
    }

    public init(accessibility: Bool, ocr: Bool, onDeviceContextSize: Int, onDeviceModel: Bool, overlay: Bool) {
        self.accessibility = accessibility
        self.ocr = ocr
        self.onDeviceContextSize = onDeviceContextSize
        self.onDeviceModel = onDeviceModel
        self.overlay = overlay
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["accessibility", "ocr", "onDeviceContextSize", "onDeviceModel", "overlay"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Capabilities field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.accessibility = try container.decode(Bool.self, forKey: .accessibility)
        self.ocr = try container.decode(Bool.self, forKey: .ocr)
        self.onDeviceContextSize = try container.decode(Int.self, forKey: .onDeviceContextSize)
        self.onDeviceModel = try container.decode(Bool.self, forKey: .onDeviceModel)
        self.overlay = try container.decode(Bool.self, forKey: .overlay)
    }
}

public enum ProtocolVersion: String, Codable, Equatable, Sendable {
    case the100 = "1.0.0"
}

// MARK: - BridgeToNative
public enum BridgeToNative: Codable, Equatable, Sendable {
    case speechSegment(BridgeToNativeSpeechSegment)
    case action(BridgeToNativeAction)
    case targetRect(BridgeToNativeTargetRect)
    case toolInvocation(BridgeToNativeToolInvocation)
    case approvalContext(BridgeToNativeApprovalContext)
    case jobProgress(BridgeToNativeJobProgress)
    case safetyNotice(BridgeToNativeSafetyNotice)
    case speechControl(BridgeToNativeSpeechControl)

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let tag = try container.decode(String.self, forKey: ProtocolCodingKey("type"))
        switch tag {
        case "SpeechSegment": self = .speechSegment(try BridgeToNativeSpeechSegment(from: decoder))
        case "Action": self = .action(try BridgeToNativeAction(from: decoder))
        case "TargetRect": self = .targetRect(try BridgeToNativeTargetRect(from: decoder))
        case "ToolInvocation": self = .toolInvocation(try BridgeToNativeToolInvocation(from: decoder))
        case "ApprovalContext": self = .approvalContext(try BridgeToNativeApprovalContext(from: decoder))
        case "JobProgress": self = .jobProgress(try BridgeToNativeJobProgress(from: decoder))
        case "SafetyNotice": self = .safetyNotice(try BridgeToNativeSafetyNotice(from: decoder))
        case "SpeechControl": self = .speechControl(try BridgeToNativeSpeechControl(from: decoder))
        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNative tag"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .speechSegment(let value): try value.encode(to: encoder)
        case .action(let value): try value.encode(to: encoder)
        case .targetRect(let value): try value.encode(to: encoder)
        case .toolInvocation(let value): try value.encode(to: encoder)
        case .approvalContext(let value): try value.encode(to: encoder)
        case .jobProgress(let value): try value.encode(to: encoder)
        case .safetyNotice(let value): try value.encode(to: encoder)
        case .speechControl(let value): try value.encode(to: encoder)
        }
    }
}

// MARK: - BridgeToNativeAction
public struct BridgeToNativeAction: Codable, Equatable, Sendable {
    public let id: String
    public let payload: Action
    public let type: ActionTypeEnum
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: Action, type: ActionTypeEnum, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeAction field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(Action.self, forKey: .payload)
        self.type = try container.decode(ActionTypeEnum.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

public enum ActionTypeEnum: String, Codable, Equatable, Sendable {
    case action = "Action"
}

// MARK: - BridgeToNativeApprovalContext
public struct BridgeToNativeApprovalContext: Codable, Equatable, Sendable {
    public let id: String
    public let payload: ApprovalContext
    public let type: ApprovalContextType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: ApprovalContext, type: ApprovalContextType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeApprovalContext field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(ApprovalContext.self, forKey: .payload)
        self.type = try container.decode(ApprovalContextType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

public enum ApprovalContextType: String, Codable, Equatable, Sendable {
    case approvalContext = "ApprovalContext"
}

// MARK: - BridgeToNativeJobProgress
public struct BridgeToNativeJobProgress: Codable, Equatable, Sendable {
    public let id: String
    public let payload: JobProgress
    public let type: JobProgressType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: JobProgress, type: JobProgressType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeJobProgress field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(JobProgress.self, forKey: .payload)
        self.type = try container.decode(JobProgressType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - JobProgress
public struct JobProgress: Codable, Equatable, Sendable {
    public let jobID: String
    public let message: String
    public let progress: Double
    public let state: String

    public enum CodingKeys: String, CodingKey {
        case jobID = "jobId"
        case message = "message"
        case progress = "progress"
        case state = "state"
    }

    public init(jobID: String, message: String, progress: Double, state: String) {
        self.jobID = jobID
        self.message = message
        self.progress = progress
        self.state = state
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["jobId", "message", "progress", "state"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown JobProgress field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.jobID = try container.decode(String.self, forKey: .jobID)
        self.message = try container.decode(String.self, forKey: .message)
        self.progress = try container.decode(Double.self, forKey: .progress)
        self.state = try container.decode(String.self, forKey: .state)
    }
}

public enum JobProgressType: String, Codable, Equatable, Sendable {
    case jobProgress = "JobProgress"
}

// MARK: - BridgeToNativeSafetyNotice
public struct BridgeToNativeSafetyNotice: Codable, Equatable, Sendable {
    public let id: String
    public let payload: SafetyNotice
    public let type: SafetyNoticeType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: SafetyNotice, type: SafetyNoticeType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeSafetyNotice field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(SafetyNotice.self, forKey: .payload)
        self.type = try container.decode(SafetyNoticeType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - SafetyNotice
public struct SafetyNotice: Codable, Equatable, Sendable {
    public let numbers: [Number]
    public let scopeAfter: ScopeAfter
    public let text: String

    public enum CodingKeys: String, CodingKey {
        case numbers = "numbers"
        case scopeAfter = "scopeAfter"
        case text = "text"
    }

    public init(numbers: [Number], scopeAfter: ScopeAfter, text: String) {
        self.numbers = numbers
        self.scopeAfter = scopeAfter
        self.text = text
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["numbers", "scopeAfter", "text"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown SafetyNotice field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.numbers = try container.decode([Number].self, forKey: .numbers)
        self.scopeAfter = try container.decode(ScopeAfter.self, forKey: .scopeAfter)
        self.text = try container.decode(String.self, forKey: .text)
    }
}

// MARK: - Number
public struct Number: Codable, Equatable, Sendable {
    public let label: String
    public let number: String

    public enum CodingKeys: String, CodingKey {
        case label = "label"
        case number = "number"
    }

    public init(label: String, number: String) {
        self.label = label
        self.number = number
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["label", "number"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Number field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try container.decode(String.self, forKey: .label)
        self.number = try container.decode(String.self, forKey: .number)
    }
}

public enum ScopeAfter: String, Codable, Equatable, Sendable {
    case administrativeOnly = "administrative_only"
}

public enum SafetyNoticeType: String, Codable, Equatable, Sendable {
    case safetyNotice = "SafetyNotice"
}

// MARK: - BridgeToNativeSpeechControl
public struct BridgeToNativeSpeechControl: Codable, Equatable, Sendable {
    public let id: String
    public let payload: SpeechControl
    public let type: SpeechControlType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: SpeechControl, type: SpeechControlType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeSpeechControl field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(SpeechControl.self, forKey: .payload)
        self.type = try container.decode(SpeechControlType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - SpeechControl
public struct SpeechControl: Codable, Equatable, Sendable {
    public let segmentIndex: Int
    public let state: State
    public let stop: Bool

    public enum CodingKeys: String, CodingKey {
        case segmentIndex = "segmentIndex"
        case state = "state"
        case stop = "stop"
    }

    public init(segmentIndex: Int, state: State, stop: Bool) {
        self.segmentIndex = segmentIndex
        self.state = state
        self.stop = stop
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["segmentIndex", "state", "stop"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown SpeechControl field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.segmentIndex = try container.decode(Int.self, forKey: .segmentIndex)
        self.state = try container.decode(State.self, forKey: .state)
        self.stop = try container.decode(Bool.self, forKey: .stop)
    }
}

public enum State: String, Codable, Equatable, Sendable {
    case idle = "idle"
    case speaking = "speaking"
}

public enum SpeechControlType: String, Codable, Equatable, Sendable {
    case speechControl = "SpeechControl"
}

// MARK: - BridgeToNativeSpeechSegment
public struct BridgeToNativeSpeechSegment: Codable, Equatable, Sendable {
    public let id: String
    public let payload: SpeechSegment
    public let type: SpeechSegmentType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: SpeechSegment, type: SpeechSegmentType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeSpeechSegment field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(SpeechSegment.self, forKey: .payload)
        self.type = try container.decode(SpeechSegmentType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - SpeechSegment
public struct SpeechSegment: Codable, Equatable, Sendable {
    public let actionIDS: [String]
    public let citations: [Citation]
    public let index: Int
    public let language: String
    public let text: String
    public let turnID: String

    public enum CodingKeys: String, CodingKey {
        case actionIDS = "actionIds"
        case citations = "citations"
        case index = "index"
        case language = "language"
        case text = "text"
        case turnID = "turnId"
    }

    public init(actionIDS: [String], citations: [Citation], index: Int, language: String, text: String, turnID: String) {
        self.actionIDS = actionIDS
        self.citations = citations
        self.index = index
        self.language = language
        self.text = text
        self.turnID = turnID
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["actionIds", "citations", "index", "language", "text", "turnId"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown SpeechSegment field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.actionIDS = try container.decode([String].self, forKey: .actionIDS)
        self.citations = try container.decode([Citation].self, forKey: .citations)
        self.index = try container.decode(Int.self, forKey: .index)
        self.language = try container.decode(String.self, forKey: .language)
        self.text = try container.decode(String.self, forKey: .text)
        self.turnID = try container.decode(String.self, forKey: .turnID)
    }
}

// MARK: - Citation
public struct Citation: Codable, Equatable, Sendable {
    public let passageID: String
    public let quote: String
    public let url: String

    public enum CodingKeys: String, CodingKey {
        case passageID = "passageId"
        case quote = "quote"
        case url = "url"
    }

    public init(passageID: String, quote: String, url: String) {
        self.passageID = passageID
        self.quote = quote
        self.url = url
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["passageId", "quote", "url"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Citation field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.passageID = try container.decode(String.self, forKey: .passageID)
        self.quote = try container.decode(String.self, forKey: .quote)
        self.url = try container.decode(String.self, forKey: .url)
    }
}

public enum SpeechSegmentType: String, Codable, Equatable, Sendable {
    case speechSegment = "SpeechSegment"
}

// MARK: - BridgeToNativeTargetRect
public struct BridgeToNativeTargetRect: Codable, Equatable, Sendable {
    public let id: String
    public let payload: TargetRect
    public let type: TargetRectType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: TargetRect, type: TargetRectType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeTargetRect field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(TargetRect.self, forKey: .payload)
        self.type = try container.decode(TargetRectType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - TargetRect
public struct TargetRect: Codable, Equatable, Sendable {
    public let rect: WindowRect
    public let scale: Double
    public let targetID: String
    public let visible: Bool

    public enum CodingKeys: String, CodingKey {
        case rect = "rect"
        case scale = "scale"
        case targetID = "targetId"
        case visible = "visible"
    }

    public init(rect: WindowRect, scale: Double, targetID: String, visible: Bool) {
        self.rect = rect
        self.scale = scale
        self.targetID = targetID
        self.visible = visible
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["rect", "scale", "targetId", "visible"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TargetRect field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.rect = try container.decode(WindowRect.self, forKey: .rect)
        self.scale = try container.decode(Double.self, forKey: .scale)
        self.targetID = try container.decode(String.self, forKey: .targetID)
        self.visible = try container.decode(Bool.self, forKey: .visible)
    }
}

// MARK: - WindowRect
public struct WindowRect: Codable, Equatable, Sendable {
    public let height: Double
    public let width: Double
    public let x: Double
    public let y: Double

    public enum CodingKeys: String, CodingKey {
        case height = "height"
        case width = "width"
        case x = "x"
        case y = "y"
    }

    public init(height: Double, width: Double, x: Double, y: Double) {
        self.height = height
        self.width = width
        self.x = x
        self.y = y
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["height", "width", "x", "y"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown WindowRect field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.height = try container.decode(Double.self, forKey: .height)
        self.width = try container.decode(Double.self, forKey: .width)
        self.x = try container.decode(Double.self, forKey: .x)
        self.y = try container.decode(Double.self, forKey: .y)
    }
}

public enum TargetRectType: String, Codable, Equatable, Sendable {
    case targetRect = "TargetRect"
}

// MARK: - BridgeToNativeToolInvocation
public struct BridgeToNativeToolInvocation: Codable, Equatable, Sendable {
    public let id: String
    public let payload: ToolInvocation
    public let type: ToolInvocationType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: ToolInvocation, type: ToolInvocationType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToNativeToolInvocation field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(ToolInvocation.self, forKey: .payload)
        self.type = try container.decode(ToolInvocationType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - ToolInvocation
public struct ToolInvocation: Codable, Equatable, Sendable {
    public let input: [String: JSONValue]
    public let toolCallID: String
    public let toolName: ToolName

    public enum CodingKeys: String, CodingKey {
        case input = "input"
        case toolCallID = "toolCallId"
        case toolName = "toolName"
    }

    public init(input: [String: JSONValue], toolCallID: String, toolName: ToolName) {
        self.input = input
        self.toolCallID = toolCallID
        self.toolName = toolName
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["input", "toolCallId", "toolName"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ToolInvocation field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.input = try container.decode([String: JSONValue].self, forKey: .input)
        self.toolCallID = try container.decode(String.self, forKey: .toolCallID)
        self.toolName = try container.decode(ToolName.self, forKey: .toolName)
    }
}

public enum JSONValue: Codable, Equatable, Sendable {
    case bool(Bool)
    case double(Double)
    case string(String)
    case unionArray([JSONValue])
    case unionMap([String: JSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let x = try? container.decode(Bool.self) {
            self = .bool(x)
            return
        }
        if let x = try? container.decode([JSONValue].self) {
            self = .unionArray(x)
            return
        }
        if let x = try? container.decode(Double.self) {
            self = .double(x)
            return
        }
        if let x = try? container.decode([String: JSONValue].self) {
            self = .unionMap(x)
            return
        }
        if let x = try? container.decode(String.self) {
            self = .string(x)
            return
        }
        if container.decodeNil() {
            self = .null
            return
        }
        throw DecodingError.typeMismatch(JSONValue.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for JSONValue"))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .bool(let x):
            try container.encode(x)
        case .double(let x):
            try container.encode(x)
        case .string(let x):
            try container.encode(x)
        case .unionArray(let x):
            try container.encode(x)
        case .unionMap(let x):
            try container.encode(x)
        case .null:
            try container.encodeNil()
        }
    }
}

public enum ToolName: String, Codable, Equatable, Sendable {
    case calendarCreateEvent = "calendar.createEvent"
    case contextReadScreen = "context.readScreen"
    case sessionShareWithHelper = "session.shareWithHelper"
    case uiFill = "ui.fill"
}

public enum ToolInvocationType: String, Codable, Equatable, Sendable {
    case toolInvocation = "ToolInvocation"
}

// MARK: - BridgeToWorkspace
public enum BridgeToWorkspace: Codable, Equatable, Sendable {
    case bridgeHello(BridgeToWorkspaceBridgeHello)
    case transcript(BridgeToWorkspaceTranscript)
    case toolOutput(BridgeToWorkspaceToolOutput)
    case approvalDecision(BridgeToWorkspaceApprovalDecision)
    case actionResult(BridgeToWorkspaceActionResult)
    case speechControl(BridgeToWorkspaceSpeechControl)

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let tag = try container.decode(String.self, forKey: ProtocolCodingKey("type"))
        switch tag {
        case "BridgeHello": self = .bridgeHello(try BridgeToWorkspaceBridgeHello(from: decoder))
        case "Transcript": self = .transcript(try BridgeToWorkspaceTranscript(from: decoder))
        case "ToolOutput": self = .toolOutput(try BridgeToWorkspaceToolOutput(from: decoder))
        case "ApprovalDecision": self = .approvalDecision(try BridgeToWorkspaceApprovalDecision(from: decoder))
        case "ActionResult": self = .actionResult(try BridgeToWorkspaceActionResult(from: decoder))
        case "SpeechControl": self = .speechControl(try BridgeToWorkspaceSpeechControl(from: decoder))
        default: throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToWorkspace tag"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .bridgeHello(let value): try value.encode(to: encoder)
        case .transcript(let value): try value.encode(to: encoder)
        case .toolOutput(let value): try value.encode(to: encoder)
        case .approvalDecision(let value): try value.encode(to: encoder)
        case .actionResult(let value): try value.encode(to: encoder)
        case .speechControl(let value): try value.encode(to: encoder)
        }
    }
}

// MARK: - BridgeToWorkspaceActionResult
public struct BridgeToWorkspaceActionResult: Codable, Equatable, Sendable {
    public let id: String
    public let payload: ActionResult
    public let type: ActionResultType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: ActionResult, type: ActionResultType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToWorkspaceActionResult field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(ActionResult.self, forKey: .payload)
        self.type = try container.decode(ActionResultType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

public enum ActionResultType: String, Codable, Equatable, Sendable {
    case actionResult = "ActionResult"
}

// MARK: - BridgeToWorkspaceApprovalDecision
public struct BridgeToWorkspaceApprovalDecision: Codable, Equatable, Sendable {
    public let id: String
    public let payload: ApprovalDecision
    public let type: ApprovalDecisionType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: ApprovalDecision, type: ApprovalDecisionType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToWorkspaceApprovalDecision field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(ApprovalDecision.self, forKey: .payload)
        self.type = try container.decode(ApprovalDecisionType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

public enum ApprovalDecisionType: String, Codable, Equatable, Sendable {
    case approvalDecision = "ApprovalDecision"
}

// MARK: - BridgeToWorkspaceBridgeHello
public struct BridgeToWorkspaceBridgeHello: Codable, Equatable, Sendable {
    public let id: String
    public let payload: BridgeHello
    public let type: BridgeHelloType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: BridgeHello, type: BridgeHelloType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToWorkspaceBridgeHello field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(BridgeHello.self, forKey: .payload)
        self.type = try container.decode(BridgeHelloType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

public enum BridgeHelloType: String, Codable, Equatable, Sendable {
    case bridgeHello = "BridgeHello"
}

// MARK: - BridgeToWorkspaceSpeechControl
public struct BridgeToWorkspaceSpeechControl: Codable, Equatable, Sendable {
    public let id: String
    public let payload: SpeechControl
    public let type: SpeechControlType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: SpeechControl, type: SpeechControlType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToWorkspaceSpeechControl field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(SpeechControl.self, forKey: .payload)
        self.type = try container.decode(SpeechControlType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - BridgeToWorkspaceToolOutput
public struct BridgeToWorkspaceToolOutput: Codable, Equatable, Sendable {
    public let id: String
    public let payload: ToolOutput
    public let type: ToolOutputType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: ToolOutput, type: ToolOutputType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToWorkspaceToolOutput field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(ToolOutput.self, forKey: .payload)
        self.type = try container.decode(ToolOutputType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - ToolOutput
public struct ToolOutput: Codable, Equatable, Sendable {
    public let error: String?
    public let output: ToolOutputOutput
    public let toolCallID: String

    public enum CodingKeys: String, CodingKey {
        case error = "error"
        case output = "output"
        case toolCallID = "toolCallId"
    }

    public init(error: String?, output: ToolOutputOutput, toolCallID: String) {
        self.error = error
        self.output = output
        self.toolCallID = toolCallID
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["error", "output", "toolCallId"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ToolOutput field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.error), try container.decodeNil(forKey: .error) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null error"))
        }
        self.error = try container.decodeIfPresent(String.self, forKey: .error)
        self.output = try container.decode(ToolOutputOutput.self, forKey: .output)
        self.toolCallID = try container.decode(String.self, forKey: .toolCallID)
    }
}

// MARK: - ToolOutputOutput
public enum ToolOutputOutput: Codable, Equatable, Sendable {
    case actionResult(ActionResult)
    case contextCapsule(ContextCapsule)

    public init(from decoder: Decoder) throws {
        if let value = try? ActionResult(from: decoder) {
            self = .actionResult(value)
            return
        }
        if let value = try? ContextCapsule(from: decoder) {
            self = .contextCapsule(value)
            return
        }
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Invalid ToolOutputOutput"))
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .actionResult(let value): try value.encode(to: encoder)
        case .contextCapsule(let value): try value.encode(to: encoder)
        }
    }
}

// MARK: - ContextCapsule
public struct ContextCapsule: Codable, Equatable, Sendable {
    public let focusedRegion: BoundingBox?
    public let page: Page?
    public let screen: Screen?

    public enum CodingKeys: String, CodingKey {
        case focusedRegion = "focusedRegion"
        case page = "page"
        case screen = "screen"
    }

    public init(focusedRegion: BoundingBox?, page: Page?, screen: Screen?) {
        self.focusedRegion = focusedRegion
        self.page = page
        self.screen = screen
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["focusedRegion", "page", "screen"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ContextCapsule field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.focusedRegion), try container.decodeNil(forKey: .focusedRegion) {
            throw DecodingError.valueNotFound(BoundingBox.self, .init(codingPath: decoder.codingPath, debugDescription: "Null focusedRegion"))
        }
        self.focusedRegion = try container.decodeIfPresent(BoundingBox.self, forKey: .focusedRegion)
        if container.contains(.page), try container.decodeNil(forKey: .page) {
            throw DecodingError.valueNotFound(Page.self, .init(codingPath: decoder.codingPath, debugDescription: "Null page"))
        }
        self.page = try container.decodeIfPresent(Page.self, forKey: .page)
        if container.contains(.screen), try container.decodeNil(forKey: .screen) {
            throw DecodingError.valueNotFound(Screen.self, .init(codingPath: decoder.codingPath, debugDescription: "Null screen"))
        }
        self.screen = try container.decodeIfPresent(Screen.self, forKey: .screen)
    }
}

// MARK: - Page
public struct Page: Codable, Equatable, Sendable {
    public let handles: [Handle]
    public let url: String

    public enum CodingKeys: String, CodingKey {
        case handles = "handles"
        case url = "url"
    }

    public init(handles: [Handle], url: String) {
        self.handles = handles
        self.url = url
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["handles", "url"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Page field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.handles = try container.decode([Handle].self, forKey: .handles)
        self.url = try container.decode(String.self, forKey: .url)
    }
}

// MARK: - Handle
public struct Handle: Codable, Equatable, Sendable {
    public let bbox: BoundingBox
    public let id: String
    public let label: String
    public let role: String
    public let value: String

    public enum CodingKeys: String, CodingKey {
        case bbox = "bbox"
        case id = "id"
        case label = "label"
        case role = "role"
        case value = "value"
    }

    public init(bbox: BoundingBox, id: String, label: String, role: String, value: String) {
        self.bbox = bbox
        self.id = id
        self.label = label
        self.role = role
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["bbox", "id", "label", "role", "value"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Handle field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.bbox = try container.decode(BoundingBox.self, forKey: .bbox)
        self.id = try container.decode(String.self, forKey: .id)
        self.label = try container.decode(String.self, forKey: .label)
        self.role = try container.decode(String.self, forKey: .role)
        self.value = try container.decode(String.self, forKey: .value)
    }
}

// MARK: - Screen
public struct Screen: Codable, Equatable, Sendable {
    public let image: String?
    public let ocrLines: [OcrLine]
    public let screenIndex: Int
    public let summary: String

    public enum CodingKeys: String, CodingKey {
        case image = "image"
        case ocrLines = "ocrLines"
        case screenIndex = "screenIndex"
        case summary = "summary"
    }

    public init(image: String?, ocrLines: [OcrLine], screenIndex: Int, summary: String) {
        self.image = image
        self.ocrLines = ocrLines
        self.screenIndex = screenIndex
        self.summary = summary
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["image", "ocrLines", "screenIndex", "summary"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Screen field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.image), try container.decodeNil(forKey: .image) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null image"))
        }
        self.image = try container.decodeIfPresent(String.self, forKey: .image)
        self.ocrLines = try container.decode([OcrLine].self, forKey: .ocrLines)
        self.screenIndex = try container.decode(Int.self, forKey: .screenIndex)
        self.summary = try container.decode(String.self, forKey: .summary)
    }
}

// MARK: - OcrLine
public struct OcrLine: Codable, Equatable, Sendable {
    public let bbox: BoundingBox
    public let text: String

    public enum CodingKeys: String, CodingKey {
        case bbox = "bbox"
        case text = "text"
    }

    public init(bbox: BoundingBox, text: String) {
        self.bbox = bbox
        self.text = text
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["bbox", "text"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown OcrLine field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.bbox = try container.decode(BoundingBox.self, forKey: .bbox)
        self.text = try container.decode(String.self, forKey: .text)
    }
}

public enum ToolOutputType: String, Codable, Equatable, Sendable {
    case toolOutput = "ToolOutput"
}

// MARK: - BridgeToWorkspaceTranscript
public struct BridgeToWorkspaceTranscript: Codable, Equatable, Sendable {
    public let id: String
    public let payload: Transcript
    public let type: TranscriptType
    public let v: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case payload = "payload"
        case type = "type"
        case v = "v"
    }

    public init(id: String, payload: Transcript, type: TranscriptType, v: ProtocolVersion) {
        self.id = id
        self.payload = payload
        self.type = type
        self.v = v
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["id", "payload", "type", "v"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown BridgeToWorkspaceTranscript field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.payload = try container.decode(Transcript.self, forKey: .payload)
        self.type = try container.decode(TranscriptType.self, forKey: .type)
        self.v = try container.decode(ProtocolVersion.self, forKey: .v)
    }
}

// MARK: - Transcript
public struct Transcript: Codable, Equatable, Sendable {
    public let capsule: ContextCapsule?
    public let language: String?
    public let text: String
    public let transcriptFinal: Bool

    public enum CodingKeys: String, CodingKey {
        case capsule = "capsule"
        case language = "language"
        case text = "text"
        case transcriptFinal = "final"
    }

    public init(capsule: ContextCapsule?, language: String?, text: String, transcriptFinal: Bool) {
        self.capsule = capsule
        self.language = language
        self.text = text
        self.transcriptFinal = transcriptFinal
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["capsule", "language", "text", "final"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Transcript field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if container.contains(.capsule), try container.decodeNil(forKey: .capsule) {
            throw DecodingError.valueNotFound(ContextCapsule.self, .init(codingPath: decoder.codingPath, debugDescription: "Null capsule"))
        }
        self.capsule = try container.decodeIfPresent(ContextCapsule.self, forKey: .capsule)
        if container.contains(.language), try container.decodeNil(forKey: .language) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null language"))
        }
        self.language = try container.decodeIfPresent(String.self, forKey: .language)
        self.text = try container.decode(String.self, forKey: .text)
        self.transcriptFinal = try container.decode(Bool.self, forKey: .transcriptFinal)
    }
}

public enum TranscriptType: String, Codable, Equatable, Sendable {
    case transcript = "Transcript"
}

// MARK: - CaseEvent
public struct CaseEvent: Codable, Equatable, Sendable {
    public let caseID: String
    public let kind: CaseEventKind
    public let payload: [String: JSONValue]

    public enum CodingKeys: String, CodingKey {
        case caseID = "caseId"
        case kind = "kind"
        case payload = "payload"
    }

    public init(caseID: String, kind: CaseEventKind, payload: [String: JSONValue]) {
        self.caseID = caseID
        self.kind = kind
        self.payload = payload
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["caseId", "kind", "payload"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown CaseEvent field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.caseID = try container.decode(String.self, forKey: .caseID)
        self.kind = try container.decode(CaseEventKind.self, forKey: .kind)
        self.payload = try container.decode([String: JSONValue].self, forKey: .payload)
    }
}

public enum CaseEventKind: String, Codable, Equatable, Sendable {
    case artefactReady = "artefact_ready"
    case goalConfirmed = "goal_confirmed"
    case reminderCreated = "reminder_created"
    case stepCompleted = "step_completed"
    case stepCreated = "step_created"
}

// MARK: - ClientHello
public struct ClientHello: Codable, Equatable, Sendable {
    public let appVersion: String
    public let capabilities: Capabilities
    public let clientKind: ClientKind
    public let locale: String
    public let protocolVersion: ProtocolVersion

    public enum CodingKeys: String, CodingKey {
        case appVersion = "appVersion"
        case capabilities = "capabilities"
        case clientKind = "clientKind"
        case locale = "locale"
        case protocolVersion = "protocolVersion"
    }

    public init(appVersion: String, capabilities: Capabilities, clientKind: ClientKind, locale: String, protocolVersion: ProtocolVersion) {
        self.appVersion = appVersion
        self.capabilities = capabilities
        self.clientKind = clientKind
        self.locale = locale
        self.protocolVersion = protocolVersion
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["appVersion", "capabilities", "clientKind", "locale", "protocolVersion"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown ClientHello field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.appVersion = try container.decode(String.self, forKey: .appVersion)
        self.capabilities = try container.decode(Capabilities.self, forKey: .capabilities)
        self.clientKind = try container.decode(ClientKind.self, forKey: .clientKind)
        self.locale = try container.decode(String.self, forKey: .locale)
        self.protocolVersion = try container.decode(ProtocolVersion.self, forKey: .protocolVersion)
    }
}

public enum ClientKind: String, Codable, Equatable, Sendable {
    case helper = "helper"
    case mac = "mac"
    case web = "web"
}

// MARK: - Fact
public struct Fact: Codable, Equatable, Sendable {
    public let confidence: Double
    public let confirmed: Bool
    public let id: String
    public let source: FactSource
    public let subjectID: String
    public let type: String
    public let value: JSONValue

    public enum CodingKeys: String, CodingKey {
        case confidence = "confidence"
        case confirmed = "confirmed"
        case id = "id"
        case source = "source"
        case subjectID = "subjectId"
        case type = "type"
        case value = "value"
    }

    public init(confidence: Double, confirmed: Bool, id: String, source: FactSource, subjectID: String, type: String, value: JSONValue) {
        self.confidence = confidence
        self.confirmed = confirmed
        self.id = id
        self.source = source
        self.subjectID = subjectID
        self.type = type
        self.value = value
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["confidence", "confirmed", "id", "source", "subjectId", "type", "value"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown Fact field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.confidence = try container.decode(Double.self, forKey: .confidence)
        self.confirmed = try container.decode(Bool.self, forKey: .confirmed)
        self.id = try container.decode(String.self, forKey: .id)
        self.source = try container.decode(FactSource.self, forKey: .source)
        self.subjectID = try container.decode(String.self, forKey: .subjectID)
        self.type = try container.decode(String.self, forKey: .type)
        self.value = try container.decode(JSONValue.self, forKey: .value)
    }
}

// MARK: - TurnRequest
public struct TurnRequest: Codable, Equatable, Sendable {
    public let actionResults: [ActionResult]
    public let capsule: ContextCapsule
    public let caseID: String?
    public let inputKind: InputKind
    public let language: String?
    public let subjectID: String?

    public enum CodingKeys: String, CodingKey {
        case actionResults = "actionResults"
        case capsule = "capsule"
        case caseID = "caseId"
        case inputKind = "inputKind"
        case language = "language"
        case subjectID = "subjectId"
    }

    public init(actionResults: [ActionResult], capsule: ContextCapsule, caseID: String?, inputKind: InputKind, language: String?, subjectID: String?) {
        self.actionResults = actionResults
        self.capsule = capsule
        self.caseID = caseID
        self.inputKind = inputKind
        self.language = language
        self.subjectID = subjectID
    }

    public init(from decoder: Decoder) throws {
        let keys = try decoder.container(keyedBy: ProtocolCodingKey.self)
        let allowed: Set<String> = ["actionResults", "capsule", "caseId", "inputKind", "language", "subjectId"]
        guard keys.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown TurnRequest field"))
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.actionResults = try container.decode([ActionResult].self, forKey: .actionResults)
        self.capsule = try container.decode(ContextCapsule.self, forKey: .capsule)
        if container.contains(.caseID), try container.decodeNil(forKey: .caseID) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null caseId"))
        }
        self.caseID = try container.decodeIfPresent(String.self, forKey: .caseID)
        self.inputKind = try container.decode(InputKind.self, forKey: .inputKind)
        if container.contains(.language), try container.decodeNil(forKey: .language) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null language"))
        }
        self.language = try container.decodeIfPresent(String.self, forKey: .language)
        if container.contains(.subjectID), try container.decodeNil(forKey: .subjectID) {
            throw DecodingError.valueNotFound(String.self, .init(codingPath: decoder.codingPath, debugDescription: "Null subjectId"))
        }
        self.subjectID = try container.decodeIfPresent(String.self, forKey: .subjectID)
    }
}

public enum InputKind: String, Codable, Equatable, Sendable {
    case text = "text"
    case transcript = "transcript"
}

// Internal keys used by the generated strict-object and tagged-union decoders.
private struct ProtocolCodingKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ value: String) { stringValue = value }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
}
