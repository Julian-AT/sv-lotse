import LotseVoice
import SwiftUI

/// Shows which speech provider served the last voice turn and the exact reason for an Apple fallback.
struct VoiceProviderStatusView: View {
    let language: CompanionLanguage
    private var status: VoiceProviderStatus { .shared }
    private func text(_ german: String, _ english: String) -> String { language == .german ? german : english }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            LabeledContent(text("Aktiver Sprachdienst", "Active voice service")) {
                Label(providerName, systemImage: status.provider == .elevenLabs ? "checkmark.seal.fill" : "speaker.wave.2")
                    .foregroundStyle(status.provider == .apple ? Color.orange : Color.primary)
            }
            if status.provider == .apple, let reason = status.reason {
                Text(text("Grund für Apple-Ersatz: ", "Reason for Apple fallback: ") + reason)
                    .font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if status.provider != .elevenLabs {
                Text(text("ElevenLabs wird bei jeder Sprachausgabe erneut versucht.",
                          "ElevenLabs is tried again for every voice turn."))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var providerName: String {
        switch status.provider {
        case .elevenLabs: "ElevenLabs"
        case .apple: text("Apple (Ersatz)", "Apple (fallback)")
        case .unknown: text("Noch nicht geprüft", "Not checked yet")
        }
    }
}
