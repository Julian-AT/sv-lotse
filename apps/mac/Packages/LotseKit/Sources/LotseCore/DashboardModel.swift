import Foundation
import LotseBridge
import Observation
import WebKit

struct DashboardCase: Decodable, Identifiable, Equatable {
    let id: UUID
    let title: String
    let lastActivity: Date
}

enum ConversationDateGroup: Int, CaseIterable, Identifiable {
    case today, yesterday, week, older
    var id: Int { rawValue }

    static func group(for date: Date, now: Date, calendar: Calendar = .current) -> Self {
        let start = calendar.startOfDay(for: now)
        if date >= start { return .today }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: start), date >= yesterday { return .yesterday }
        if let week = calendar.date(byAdding: .day, value: -6, to: start), date >= week { return .week }
        return .older
    }

    func title(_ copy: ChromeCopy) -> String {
        switch self {
        case .today: copy.today
        case .yesterday: copy.yesterday
        case .week: copy.week
        case .older: copy.older
        }
    }
}

@MainActor @Observable
public final class DashboardModel {
    var cases: [DashboardCase] = []
    var selectedID: UUID?
    var search = ""
    var failed = false
    var loading = false
    var mutating = false
    var profile: BrainProfile?
    var profileFailed = false
    var health: BrainHealth?
    var workspaceReady = false
    @ObservationIgnored let workspace: WorkspaceWindowController
    @ObservationIgnored private var saveTask: Task<Void, Never>?
    @ObservationIgnored private var profileRevision = 0
    @ObservationIgnored private var profileDirty = false
    @ObservationIgnored private var pendingLanguage: String?

    init(workspace: WorkspaceWindowController) { self.workspace = workspace }

    var visibleCases: [DashboardCase] {
        cases.filter { search.isEmpty || $0.title.localizedStandardContains(search) }
    }

    func refresh() async {
        workspaceReady = workspace.isReady
        guard workspaceReady, !loading else { return }
        loading = true
        defer { loading = false }
        do {
            struct Response: Decodable { let cases: [DashboardCase] }
            let data = try await workspace.requestChrome(.cases)
            cases = try Self.decoder().decode(Response.self, from: data).cases
            failed = false
            if selectedID == nil, let first = cases.first { select(first.id) }
        } catch { failed = true }
    }

    func select(_ id: UUID) {
        guard cases.contains(where: { $0.id == id }) else { return }
        selectedID = id
        workspace.navigateToCase(id)
    }

    func create() async {
        guard !mutating else { return }
        mutating = true
        defer { mutating = false }
        do {
            let data = try await workspace.requestChrome(.createCase, method: "POST")
            let id = try JSONDecoder().decode(CreatedDashboardCase.self, from: data).case.id
            selectedID = id
            workspace.navigateToCase(id)
            workspace.showWorkspace()
        } catch { failed = true }
    }

    func rename(_ conversation: DashboardCase, title: String) async {
        guard !mutating else { return }
        mutating = true
        defer { mutating = false }
        do {
            let body = try JSONEncoder().encode(["title": title])
            _ = try await workspace.requestChrome(
                .conversation(conversation.id), method: "PATCH", body: String(data: body, encoding: .utf8)
            )
            await refresh()
        } catch { failed = true }
    }

    func delete(_ conversation: DashboardCase) async {
        guard !mutating else { return }
        mutating = true
        defer { mutating = false }
        do {
            _ = try await workspace.requestChrome(.conversation(conversation.id), method: "DELETE")
            cases.removeAll { $0.id == conversation.id }
            if selectedID == conversation.id {
                selectedID = nil
                if let next = cases.first { select(next.id) } else { await createAfterDeletion() }
            }
            failed = false
        } catch { failed = true }
    }

    private func createAfterDeletion() async {
        mutating = false
        await create()
    }

    func refreshServices() async {
        workspaceReady = workspace.isReady
        guard workspaceReady else { health = nil; return }
        do { health = try JSONDecoder().decode(BrainHealth.self, from: await workspace.requestChrome(.health))
        } catch { health = nil }
        guard saveTask == nil, !profileDirty else { return }
        do {
            profile = try JSONDecoder().decode(BrainProfile.self, from: await workspace.requestChrome(.profile))
            profileFailed = false
            if let language = pendingLanguage, var updated = profile {
                pendingLanguage = nil
                updated.language = language
                updateProfile(updated)
            }
        } catch { profileFailed = true }
    }

    func setLanguage(_ language: CompanionLanguage) {
        let value = language == .english ? "en" : "de"
        guard var updated = profile else { pendingLanguage = value; return }
        guard updated.language != value else { return }
        updated.language = value
        updateProfile(updated)
    }

    func updateProfile(_ updated: BrainProfile) {
        guard profile != nil else { return }
        profile = updated
        profileDirty = true
        profileRevision += 1
        let revision = profileRevision
        let previous = saveTask
        saveTask = Task { @MainActor [weak self] in
            await previous?.value
            guard let self else { return }
            defer { if revision == profileRevision { saveTask = nil } }
            do {
                let body = try JSONEncoder().encode(updated)
                _ = try await workspace.requestChrome(.profile, method: "PATCH", body: String(data: body, encoding: .utf8))
                if revision == profileRevision {
                    profileFailed = false
                    profileDirty = false
                }
            } catch { if revision == profileRevision { profileFailed = true } }
        }
    }

    nonisolated static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { value in
            let text = try value.singleValueContainer().decode(String.self)
            let format = ISO8601DateFormatter()
            format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = format.date(from: text) { return date }
            format.formatOptions = [.withInternetDateTime]
            guard let date = format.date(from: text) else {
                throw DecodingError.dataCorruptedError(in: try value.singleValueContainer(), debugDescription: "INVALID_DATE")
            }
            return date
        }
        return decoder
    }
}

struct BrainProfile: Codable, Equatable {
    var language: String
    var simpleLanguage: Bool
    var register: String
    var detailLevel: String
}

struct BrainHealth: Decodable {
    struct Dependencies: Decodable { let database: String; let objectStorage: String }
    let dependencies: Dependencies
}

private struct CreatedDashboardCase: Decodable {
    struct Record: Decodable { let id: UUID }
    let `case`: Record
}
