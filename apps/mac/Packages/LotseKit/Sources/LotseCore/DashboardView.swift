import AppKit
import LotseBridge
import LotseImport
import LotseOverlay
import SwiftUI
import WebKit

extension Notification.Name {
    static let openCompanionSettings = Notification.Name("lotse.openCompanionSettings")
    static let selectSettingsTab = Notification.Name("lotse.selectSettingsTab")
}

@MainActor
struct DashboardView: View {
    @Bindable var model: DashboardModel
    let settings: CompanionSettingsModel
    var openImport: () -> Void
    @Environment(\.openSettings) private var openSettings
    @State private var renaming: DashboardCase?
    @State private var deleting: DashboardCase?
    @State private var title = ""
    private var copy: ChromeCopy { ChromeCopy(language: settings.language) }

    var body: some View {
        NavigationSplitView {
            sidebar.navigationSplitViewColumnWidth(min: 220, ideal: 270, max: 360)
        } detail: {
            WorkspaceContent(webView: model.workspace.webView)
                .frame(minWidth: 500, minHeight: 500)
                // The chat page is transparent; this is its background, the same colour as the window and toolbar.
                .background(Color(nsColor: .windowBackgroundColor).ignoresSafeArea())
                .overlay {
                    // Until the workspace page has loaded, the web view would paint a blank white sheet (also in dark mode).
                    if !model.workspaceReady {
                        VStack(spacing: 12) {
                            ProgressView().controlSize(.large)
                            Text(copy.checking).foregroundStyle(.secondary)
                            Button(copy.retry) { model.workspace.load() }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(nsColor: .windowBackgroundColor))
                    }
                }
                .toolbar {
                    ToolbarItemGroup(placement: .primaryAction) {
                        let importHint = ImportCopy(english: settings.language == .english).dropHint
                        Button(action: openImport) { Label(importHint, systemImage: "paperclip") }.help(importHint)
                        Button { Task { await model.refresh() } } label: { Label(copy.retry, systemImage: "arrow.clockwise") }
                            .help(copy.retry)
                    }
                }
        }
        .navigationTitle(settings.copy.appName)
        .onReceive(NotificationCenter.default.publisher(for: .openCompanionSettings)) { note in
            openSettings()
            NSApp.activate(ignoringOtherApps: true)
            if let tab = note.object as? String {
                // The Settings view may not exist yet; let it subscribe before selecting the tab.
                DispatchQueue.main.async { NotificationCenter.default.post(name: .selectSettingsTab, object: tab) }
            }
        }
        .task {
            while !Task.isCancelled {
                await model.refresh()
                do { try await Task.sleep(for: CompanionConfiguration.dashboardRefreshInterval) } catch { return }
            }
        }
        .sheet(item: $renaming) { conversation in
            VStack(alignment: .leading, spacing: 16) {
                Text(copy.rename).font(.headline)
                TextField(copy.title, text: $title).onSubmit { saveTitle(conversation) }
                HStack {
                    Button(copy.cancel) { renaming = nil }.keyboardShortcut(.cancelAction)
                    Spacer()
                    Button(copy.save) { saveTitle(conversation) }
                        .keyboardShortcut(.defaultAction)
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }.padding(24).frame(width: 360)
        }
        .confirmationDialog(copy.delete, isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button(copy.delete, role: .destructive) {
                if let conversation = deleting { Task { await model.delete(conversation) } }
                deleting = nil
            }
            Button(copy.cancel, role: .cancel) { deleting = nil }
        } message: { Text(copy.deleteHint) }
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            Button { Task { await model.create() } } label: {
                Label(copy.newChat, systemImage: "square.and.pencil")
                    .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain).disabled(model.mutating || !model.workspaceReady)
            .keyboardShortcut("n", modifiers: .command)
            .padding(.horizontal, 18).padding(.vertical, 6)
            List(selection: Binding(get: { model.selectedID }, set: { if let id = $0 { model.select(id) } })) {
                ForEach(ConversationDateGroup.allCases) { group in
                    let conversations = model.visibleCases.filter {
                        ConversationDateGroup.group(for: $0.lastActivity, now: .now) == group
                    }
                    if !conversations.isEmpty {
                        Section(group.title(copy)) {
                            ForEach(conversations) { conversation in
                                conversationRow(conversation).tag(conversation.id)
                                    .contextMenu {
                                        Button(copy.rename, systemImage: "pencil") { title = conversation.title; renaming = conversation }
                                        Button(copy.delete, systemImage: "trash", role: .destructive) { deleting = conversation }
                                    }
                            }
                        }
                    }
                }
            }
            .listStyle(.sidebar)
            .searchable(text: $model.search, placement: .sidebar, prompt: copy.search)
            .overlay {
                if model.loading && model.cases.isEmpty { ProgressView()
                } else if model.visibleCases.isEmpty && !model.failed { Text(copy.empty).foregroundStyle(.secondary) }
            }
            if model.failed {
                VStack(alignment: .leading) {
                    Text(copy.failed).font(.caption)
                    Button(copy.retry) { Task { await model.refresh() } }
                }.padding(12).accessibilityElement(children: .contain)
            }
            Divider()
            Button {
                openSettings()
                NSApp.activate(ignoringOtherApps: true)
            } label: {
                Label(copy.profile, systemImage: "person.crop.circle")
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain).padding(.horizontal, 18).padding(.vertical, 6)
            .keyboardShortcut(",", modifiers: .command)
        }
    }

    private func conversationRow(_ conversation: DashboardCase) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(conversation.title.isEmpty ? copy.untitled : conversation.title).lineLimit(1).truncationMode(.tail)
            Text(conversation.lastActivity, format: .dateTime.day().month().hour().minute())
                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.vertical, 3)
        .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func saveTitle(_ conversation: DashboardCase) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Task { await model.rename(conversation, title: trimmed) }
        renaming = nil
    }
}

@MainActor
private struct WorkspaceContent: NSViewRepresentable {
    let webView: WKWebView
    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
