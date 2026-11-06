import AppKit
import Foundation
import Testing

@testable import LotseCore

@Test("Dashboard groups by local calendar days across daylight saving transitions")
func dashboardDateGroups() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = try #require(TimeZone(identifier: "Europe/Vienna"))
    let now = try #require(ISO8601DateFormatter().date(from: "2026-10-26T09:00:00Z"))
    let yesterday = try #require(ISO8601DateFormatter().date(from: "2026-10-25T01:30:00Z"))
    let week = try #require(ISO8601DateFormatter().date(from: "2026-10-20T12:00:00Z"))
    let older = try #require(ISO8601DateFormatter().date(from: "2026-10-19T12:00:00Z"))
    #expect(ConversationDateGroup.group(for: now, now: now, calendar: calendar) == .today)
    #expect(ConversationDateGroup.group(for: yesterday, now: now, calendar: calendar) == .yesterday)
    #expect(ConversationDateGroup.group(for: week, now: now, calendar: calendar) == .week)
    #expect(ConversationDateGroup.group(for: older, now: now, calendar: calendar) == .older)
}

@Test("Dashboard decodes server timestamps with and without fractional seconds")
func dashboardTimestamps() throws {
    for timestamp in ["2026-11-06T08:00:00.123Z", "2026-11-06T08:00:00Z"] {
        let data = Data("{\"id\":\"327d1109-6e72-42e7-a2cc-8b62cc8acdf8\",\"title\":\"Unterlagen\",\"lastActivity\":\"\(timestamp)\"}".utf8)
        let conversation = try DashboardModel.decoder().decode(DashboardCase.self, from: data)
        #expect(conversation.title == "Unterlagen")
        #expect(conversation.lastActivity.timeIntervalSince1970 > 0)
    }
}

@Suite(.serialized) @MainActor
struct NativeMenuTests {
    @Test("Menu chrome is a native menu with the requested order, shortcuts and a disabled status row")
    func nativeMenu() throws {
        _ = NSApplication.shared
        let controller = MenuBarController()
        controller.setLanguage(.german)
        let menu = try #require(controller.nativeMenu)
        let rows = menu.items.filter { !$0.isSeparatorItem }
        #expect(rows.map(\.title).dropFirst() == [
            "Dashboard öffnen", "Neuer Chat", "Einstellungen…", "Einrichtung prüfen", "Feedback geben",
            "Über SV KI-Lotse", "Hilfe", "Zuhören fortsetzen", "Aktivierungswort „Meine SV“", "Neu starten", "SV KI-Lotse beenden"
        ])
        #expect(menu.items.filter(\.isSeparatorItem).count == 4)
        #expect(rows.first?.isEnabled == false)
        #expect(rows.allSatisfy { $0.view == nil })
        #expect(rows.first(where: { $0.title == "Einstellungen…" })?.keyEquivalent == ",")
        #expect(rows.first(where: { $0.title == "Neu starten" })?.keyEquivalent == "r")
        controller.updateStatus(workspace: .connected, voiceEnabled: true, voiceAvailable: true, recording: false)
        #expect(controller.statusItem.title == "SV KI-Lotse läuft")
        controller.updateStatus(workspace: .connected, voiceEnabled: false, voiceAvailable: false, recording: false)
        #expect(controller.statusItem.title == "SV KI-Lotse pausiert")
        controller.updateStatus(workspace: .unavailable, voiceEnabled: true, voiceAvailable: false, recording: false)
        #expect(controller.statusItem.title == "SV KI-Lotse nicht verbunden")
    }

    @Test("Status logo uses a monochrome template while the regular brand image remains full colour")
    func templateLogo() throws {
        let image = try #require(LotseBrand.statusImage(description: "SV KI-Lotse"))
        #expect(image.isTemplate)
        #expect(image.size == NSSize(width: 18, height: 18))
        #expect(LotseBrand.image(size: 32, description: "SV KI-Lotse")?.isTemplate == false)
    }
}
