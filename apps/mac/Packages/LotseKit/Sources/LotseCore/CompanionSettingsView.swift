import LotseOverlay
import LotseVoice
import SwiftUI

@MainActor
struct CompanionSettingsView: View {
    @Bindable var model: CompanionSettingsModel
    var openSetup: () -> Void
    var openWorkspace: () -> Void
    private var copy: CompanionCopy { model.copy }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Text(model.onboardingReviewed ? copy.settingsTitle : copy.welcome).font(.title2).bold()
                    .accessibilityAddTraits(.isHeader)
                Text(copy.introduction).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28).padding(.top, 20).padding(.bottom, 4)
            Form {
                Section {
                    Button(GuidedSetupCopy(language: model.language).setup, action: openSetup)
                }
                Section(copy.voiceTitle) { voiceSettings }
                Section {
                    ForEach(CompanionPermission.allCases) { permission in
                        PermissionRow(model: model, permission: permission)
                    }
                    if model.settingsError { Text(copy.settingsFailed).foregroundStyle(.red) }
                } header: {
                    Text(copy.permissions)
                } footer: {
                    Text(copy.permissionHint).foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                Button(copy.recheck) { model.refreshPermissions() }
                Spacer()
                Button(copy.openWorkspace) {
                    model.finishOnboarding()
                    openWorkspace()
                }
                .buttonStyle(.borderedProminent)
                .tint(.lotseBrand)
                .keyboardShortcut(.defaultAction)
            }
            .controlSize(.large)
            .padding(.horizontal, 20).padding(.vertical, 14)
        }
        .frame(minWidth: 620, minHeight: 600)
        .tint(.lotseBrandText)
    }

    private var voiceSettings: some View {
        Group {
            Picker(copy.languageTitle, selection: $model.language) {
                ForEach(CompanionLanguage.allCases, id: \.self) { language in Text(language.title).tag(language) }
            }
            Picker(copy.voiceTitle, selection: $model.voiceIdentifier) {
                Text(copy.voiceDefault).tag("")
                ForEach(model.voices, id: \.identifier) { voice in Text(voice.name).tag(voice.identifier) }
            }
            if model.voices.isEmpty { Text(copy.voiceUnavailable).foregroundStyle(.secondary) }
            LabeledContent {
                Button(copy.voiceSample) { model.playSample() }.disabled(model.voices.isEmpty)
            } label: {
                Text(copy.voiceScope).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Toggle(isOn: $model.voiceEnabled) {
                Text(copy.enableVoice)
                Text(copy.holdHint)
            }
            .toggleStyle(.switch)
            LabeledContent(copy.shortcutStatusTitle) {
                let running = model.shortcutStatus == .running
                Label(shortcutStatusText, systemImage: running ? "checkmark.circle.fill" : "exclamationmark.circle")
                    .foregroundStyle(running ? Color.green : Color.secondary)
            }
        }
    }

    private var shortcutStatusText: String {
        switch model.shortcutStatus {
        case .running: copy.shortcutRunning
        case .waitingForPermission: copy.shortcutWaiting
        case .off: copy.shortcutOff
        case .failed(let reason): copy.shortcutFailed(reason)
        }
    }
}

@MainActor
struct PermissionRow: View {
    let model: CompanionSettingsModel
    let permission: CompanionPermission
    private var copy: CompanionCopy { model.copy }
    private var status: CompanionPermissionStatus { model.permissions[permission] ?? .notGranted }

    var body: some View {
        LabeledContent {
            HStack(spacing: 8) {
                if model.requesting == permission { ProgressView().controlSize(.small) }
                if status.canRequest {
                    Button(copy.allow) { Task { await model.request(permission) } }
                        .disabled(model.requesting != nil)
                        .accessibilityLabel("\(copy.allow): \(copy.title(for: permission))")
                }
                Button(copy.systemSettings) { model.openSettings(for: permission) }
                    .accessibilityLabel("\(copy.systemSettings): \(copy.title(for: permission))")
            }
            .fixedSize()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Image(systemName: status == .granted ? "checkmark.circle.fill" : "lock.circle")
                    .foregroundStyle(status == .granted ? Color.lotseBrandText : Color.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(copy.title(for: permission))
                    Text(copy.reason(for: permission)).font(.callout).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(copy.status(status)).font(.callout.weight(.semibold))
                        .foregroundStyle(status == .granted ? Color.lotseBrandText : Color.primary)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}
