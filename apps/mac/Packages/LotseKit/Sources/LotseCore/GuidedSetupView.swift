import SwiftUI

@MainActor
struct GuidedSetupView: View {
    let model: GuidedSetupModel
    let openWorkspace: () -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    private var copy: GuidedSetupCopy { GuidedSetupCopy(language: model.settings.language) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            HStack(alignment: .top, spacing: 24) {
                ScrollView { steps }.frame(width: 230)
                ScrollView { detail }.frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider()
            footer
        }
        .padding(28)
        .frame(minWidth: 800, minHeight: 680)
        .background(Color(nsColor: .windowBackgroundColor))
        .tint(.lotseBrandText)
    }

    private var header: some View {
        HStack(spacing: 16) {
            if let image = LotseBrand.image(size: 52, description: model.settings.copy.appName) {
                Image(nsImage: image).resizable().frame(width: 52, height: 52).accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(copy.title).font(.title2.bold()).accessibilityAddTraits(.isHeader)
                Text(copy.subtitle).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var steps: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(copy.progress(model.state.verifiedCount)).font(.caption).foregroundStyle(.secondary).padding(.bottom, 8)
            ForEach(GuidedSetupStep.allCases) { step in
                Button { model.select(step) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: model.state.status(for: step).isSatisfied ? "checkmark.circle.fill" : copy.symbol(for: step))
                            .frame(width: 20)
                        Text(copy.title(for: step)).font(.callout).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(model.state.current == step ? Color.lotseBrandText : Color.primary)
                    .padding(.horizontal, 10).frame(minHeight: 44)
                    .background(
                        model.state.current == step ? Color.primary.opacity(0.07) : .clear,
                        in: .rect(cornerRadius: 10)
                    )
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(copy.title(for: step)): \(copy.status(model.state.status(for: step)))")
                .accessibilityAddTraits(model.state.current == step ? [.isSelected] : [])
            }
        }
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 20) {
            languagePicker
            if model.requestingAll {
                HStack(spacing: 10) {
                    ProgressView().controlSize(.small)
                    Text(copy.requestingAll).font(.callout)
                }
            }
            glassCard
            Text(copy.optional).font(.callout).foregroundStyle(.secondary)
            if model.settings.settingsError { Text(model.settings.copy.settingsFailed).foregroundStyle(.red) }
            Spacer(minLength: 0)
        }
    }

    private var languagePicker: some View {
        @Bindable var settings = model.settings
        return Picker(settings.copy.languageTitle, selection: $settings.language) {
            ForEach(CompanionLanguage.allCases, id: \.self) { language in Text(language.title).tag(language) }
        }
        .pickerStyle(.segmented)
        .frame(minHeight: 44)
    }

    @ViewBuilder private var glassCard: some View {
        // Large content stays on a solid card; Liquid Glass is reserved for floating controls.
        stepContent
            .background(Color(nsColor: .controlBackgroundColor), in: .rect(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.primary.opacity(reduceTransparency ? 0.3 : 0.08))
                    .accessibilityHidden(true)
            }
    }

    private var stepContent: some View {
        let step = model.state.current
        let status = model.state.status(for: step)
        return VStack(alignment: .leading, spacing: 18) {
            Image(systemName: copy.symbol(for: step)).font(.system(size: 36)).foregroundStyle(Color.lotseBrandText)
                .accessibilityHidden(true)
            Text(copy.title(for: step)).font(.title2.bold()).accessibilityAddTraits(.isHeader)
            Text(copy.reason(for: step)).fixedSize(horizontal: false, vertical: true)
            Label(copy.status(status), systemImage: status.isSatisfied ? "checkmark.seal.fill" : "exclamationmark.circle")
                .font(.headline).foregroundStyle(status.isSatisfied ? Color.lotseBrandText : Color.primary)
            if let permission = step.permission {
                permissionActions(permission)
                Text(copy.autoCheck).font(.caption).foregroundStyle(.secondary)
            } else {
                if status == .checking { ProgressView().controlSize(.small) }
                Button(model.settings.copy.recheck) { model.retryConnection() }.frame(minHeight: 44)
                Text(copy.connectionHint).font(.caption).foregroundStyle(.secondary)
                if step == .voiceProvider {
                    VoiceProviderStatusView(language: model.settings.language)
                    voicePreview
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, minHeight: 340, alignment: .topLeading)
    }

    private func permissionActions(_ permission: CompanionPermission) -> some View {
        @Bindable var settings = model.settings
        let status = model.settings.permissions[permission]
        return VStack(alignment: .leading) {
            if permission.needsSettingsToggle, status != .granted {
                Text(copy.toggleHint).font(.callout).foregroundStyle(.secondary)
            }
            if permission == .screenRecording, model.restartSuggested {
                Button(copy.restart) { model.relaunch() }.buttonStyle(.borderedProminent).frame(minHeight: 44)
                Text(copy.restartHint).font(.caption).foregroundStyle(.secondary)
            }
            if permission == .inputMonitoring {
                Toggle(settings.copy.enableVoice, isOn: $settings.voiceEnabled).frame(minHeight: 44)
            }
            HStack {
                if model.state.status(for: model.state.current).isSatisfied == false, status?.canRequest != false {
                    Button(copy.fix) { Task { await model.fixCurrentPermission() } }
                        .buttonStyle(.borderedProminent).disabled(model.settings.requesting != nil).frame(minHeight: 44)
                }
                Button(copy.openSystemSettings) { model.settings.openSettings(for: permission) }.frame(minHeight: 44)
                if model.settings.requesting == permission { ProgressView().controlSize(.small) }
            }
        }
    }

    private var voicePreview: some View {
        @Bindable var settings = model.settings
        return VStack(alignment: .leading, spacing: 8) {
            Picker(settings.copy.voiceTitle, selection: $settings.voiceIdentifier) {
                Text(settings.copy.voiceDefault).tag("")
                ForEach(settings.voices, id: \.identifier) { voice in Text(voice.name).tag(voice.identifier) }
            }
            Button(settings.copy.voiceSample) { settings.playSample() }
                .disabled(settings.voices.isEmpty).frame(minHeight: 44)
            Text(settings.copy.voiceScope).font(.caption).foregroundStyle(.secondary)
        }
    }

    private var footer: some View {
        HStack {
            Button(copy.later, action: openWorkspace).frame(minHeight: 44)
            Spacer()
            if model.state.canComplete {
                Button(copy.finish) { if model.complete() { openWorkspace() } }
                    .buttonStyle(.borderedProminent).frame(minHeight: 44).keyboardShortcut(.defaultAction)
            } else if model.state.current != .voiceProvider {
                Button(copy.next) { model.next() }
                    .buttonStyle(.borderedProminent).frame(minHeight: 44).keyboardShortcut(.defaultAction)
            }
        }
    }
}
