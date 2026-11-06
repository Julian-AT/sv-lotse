import AppKit
import SwiftUI

@MainActor
struct RelativesSharingView: View {
    private struct Display: Identifiable {
        let id: CGDirectDisplayID
        let name: String
    }
    let session: SharingSessionController
    let client: RelativesTokenClient
    let copy: RelativesCopy
    @State private var cases: [ShareableCase] = []
    @State private var caseID: UUID?
    @State private var displayID: CGDirectDisplayID = CGMainDisplayID()
    @State private var consent = false
    @State private var loadFailed = false
    private var busy: Bool { [.connecting, .sharing, .stopping].contains(session.status) }
    private var displays: [Display] {
        NSScreen.screens.compactMap { screen in
            guard let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID else { return nil }
            return Display(id: id, name: screen.localizedName)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(copy.title, systemImage: "person.2.fill").font(.title2)
            Label(statusText, systemImage: session.status == .sharing ? "record.circle.fill" : "lock.shield")
                .foregroundStyle(session.status == .sharing ? .red : .primary)
                .accessibilityAddTraits(.updatesFrequently)
            Text(copy.explanation)
            Picker(copy.caseTitle, selection: $caseID) {
                ForEach(cases) { entry in
                    Text(verbatim: "\(entry.subjectName): \(entry.title)").tag(Optional(entry.id))
                }
            }.disabled(busy)
            Picker(copy.displayTitle, selection: $displayID) {
                ForEach(displays) { display in
                    Text(verbatim: display.name).tag(display.id)
                }
            }.disabled(busy)
            Text(copy.scope).font(.callout)
            Toggle(copy.consent, isOn: $consent).disabled(busy).frame(minHeight: 44)
            if busy {
                Button(copy.stop, role: .destructive) { consent = false; session.pause() }
                    .keyboardShortcut(.cancelAction)
                    .frame(minHeight: 44)
                    .disabled(session.status == .stopping)
            } else {
                Button(copy.start, action: start)
                    .disabled(consent == false || caseID == nil)
                    .frame(minHeight: 44)
                Button(copy.reload) { Task { await loadCases() } }.frame(minHeight: 44)
            }
            if cases.isEmpty { Text(copy.noCases) }
            if loadFailed || session.status == .failed { Text(copy.failure).foregroundStyle(.red) }
        }
        .padding(24)
        .frame(width: 540)
        .task { await loadCases() }
        .onChange(of: session.status) { _, status in
            if status == .idle || status == .failed { consent = false }
        }
    }

    private var statusText: String {
        switch session.status {
        case .idle, .failed: copy.inactive
        case .connecting: copy.connecting
        case .sharing: copy.active
        case .stopping: copy.stopping
        }
    }

    private func start() {
        guard consent, let caseID,
              let screen = NSScreen.screens.first(where: {
                  ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) == displayID
              }) else { return }
        var approval = SharingConsent()
        approval.approve(until: Date().addingTimeInterval(RelativesConfiguration.consentDuration))
        session.start(caseID: caseID, displayID: displayID, displayFrame: screen.frame, consent: approval)
    }

    private func loadCases() async {
        do {
            cases = try await client.cases()
            if cases.contains(where: { $0.id == caseID }) == false { caseID = cases.first?.id }
            loadFailed = false
        } catch { loadFailed = true }
    }
}
