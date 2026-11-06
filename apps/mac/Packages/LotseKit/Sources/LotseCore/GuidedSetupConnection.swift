import AVFoundation
import Foundation
import LotseBridge
import LotseVoice
import Speech

@MainActor
protocol GuidedSetupConnectionAccess {
    var connectionID: UUID { get }
    func reconnect()
    func checkConnection() async throws -> WorkspaceSetupDiagnostics
    func checkVoice(language: CompanionLanguage, speechGranted: Bool) async -> GuidedSetupStatus
}

@MainActor
final class SystemGuidedSetupConnection: GuidedSetupConnectionAccess {
    private let workspace: WorkspaceWindowController
    var connectionID: UUID { workspace.connectionID }

    init(workspace: WorkspaceWindowController) { self.workspace = workspace }

    func reconnect() { workspace.load() }
    func checkConnection() async throws -> WorkspaceSetupDiagnostics { try await workspace.checkSetupConnection() }

    func checkVoice(language: CompanionLanguage, speechGranted: Bool) async -> GuidedSetupStatus {
        do {
            for kind in [VoiceTokenKind.realtimeScribe, .ttsWebsocket] {
                let data = try await workspace.requestVoiceToken(type: kind.rawValue, language: language.providerLanguage)
                let token = try JSONDecoder().decode(VoiceToken.self, from: data)
                guard token.token.isEmpty == false else { throw VoiceServiceError.invalidResponse }
                if kind == .ttsWebsocket {
                    guard token.voiceId?.isEmpty == false, token.modelId?.isEmpty == false else {
                        throw VoiceServiceError.invalidResponse
                    }
                }
                try Task.checkCancellation()
            }
            VoiceProviderStatus.shared.usingElevenLabs()
            return .verified
        } catch {
            VoiceProviderStatus.shared.fellBack(error)
            guard Task.isCancelled == false, speechGranted,
                  let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language.rawValue)),
                  recognizer.isAvailable, recognizer.supportsOnDeviceRecognition,
                  AVSpeechSynthesisVoice(language: language.rawValue) != nil else { return .missing }
            return .appleFallback
        }
    }
}
