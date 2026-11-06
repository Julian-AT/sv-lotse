import EventKit
import Foundation
import LotseBridge

/// One VEVENT of a reviewed RFC 5545 calendar file.
struct CalendarEventDraft: Equatable, Sendable {
    let title: String
    let start: Date
    let end: Date
    let allDay: Bool
    let location: String?
    let notes: String?
}

/// Reads the VEVENTs the brain generates (UTC, TZID and DATE starts, folded and escaped text).
enum CalendarICS {
    static func events(in ics: String) throws -> [CalendarEventDraft] {
        var events: [CalendarEventDraft] = []
        var properties: [String: ICSProperty]?
        var depth = 0
        for line in unfold(ics) {
            let parsed = property(line)
            let name = parsed.name, value = parsed.value
            if name == "BEGIN" {
                if value == "VEVENT", properties == nil { properties = [:] } else if properties != nil { depth += 1 }
                continue
            }
            if name == "END" {
                if depth > 0 { depth -= 1; continue }
                if value == "VEVENT", let current = properties {
                    events.append(try event(current))
                    properties = nil
                }
                continue
            }
            if depth == 0, properties != nil, properties?[name] == nil { properties?[name] = parsed }
        }
        guard events.isEmpty == false else { throw NativeToolError("INVALID_CALENDAR_EVENT") }
        return events
    }

    private static func event(_ properties: [String: ICSProperty]) throws -> CalendarEventDraft {
        guard let summary = properties["SUMMARY"].map({ text($0.value) }), summary.isEmpty == false,
            let startProperty = properties["DTSTART"],
            let (start, allDay) = date(startProperty.value, parameters: startProperty.parameters)
        else { throw NativeToolError("INVALID_CALENDAR_EVENT") }
        var end = allDay ? start.addingTimeInterval(86_400) : start.addingTimeInterval(3_600)
        if let endProperty = properties["DTEND"] {
            guard let (value, _) = date(endProperty.value, parameters: endProperty.parameters), value >= start else {
                throw NativeToolError("INVALID_CALENDAR_EVENT")
            }
            end = value
        }
        let location = properties["LOCATION"].map { text($0.value) }.flatMap { $0.isEmpty ? nil : $0 }
        let notes = properties["DESCRIPTION"].map { text($0.value) }.flatMap { $0.isEmpty ? nil : $0 }
        return CalendarEventDraft(title: summary, start: start, end: end, allDay: allDay, location: location, notes: notes)
    }

    private static func unfold(_ ics: String) -> [String] {
        var lines: [String] = []
        for raw in ics.replacingOccurrences(of: "\r\n", with: "\n").split(separator: "\n", omittingEmptySubsequences: true) {
            if let first = raw.first, first == " " || first == "\t", lines.isEmpty == false {
                lines[lines.count - 1] += raw.dropFirst()
            } else {
                lines.append(String(raw))
            }
        }
        return lines
    }

    private struct ICSProperty {
        let name: String
        let parameters: [String: String]
        let value: String
    }

    private static func property(_ line: String) -> ICSProperty {
        guard let colon = line.firstIndex(of: ":") else { return ICSProperty(name: line.uppercased(), parameters: [:], value: "") }
        let head = line[..<colon].split(separator: ";").map(String.init)
        var parameters: [String: String] = [:]
        for parameter in head.dropFirst() {
            let pair = parameter.split(separator: "=", maxSplits: 1).map(String.init)
            if pair.count == 2 { parameters[pair[0].uppercased()] = pair[1].trimmingCharacters(in: CharacterSet(charactersIn: "\"")) }
        }
        return ICSProperty(name: (head.first ?? "").uppercased(), parameters: parameters, value: String(line[line.index(after: colon)...]))
    }

    private static func text(_ value: String) -> String {
        var result = ""
        var escaped = false
        for character in value {
            if escaped {
                result.append(character == "n" || character == "N" ? "\n" : character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else {
                result.append(character)
            }
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func date(_ value: String, parameters: [String: String]) -> (Date, Bool)? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        if parameters["VALUE"] == "DATE" || value.count == 8 {
            formatter.dateFormat = "yyyyMMdd"
            formatter.timeZone = .current
            return formatter.date(from: value).map { ($0, true) }
        }
        if value.hasSuffix("Z") {
            formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
            formatter.timeZone = TimeZone(identifier: "UTC")
        } else {
            formatter.dateFormat = "yyyyMMdd'T'HHmmss"
            guard let zone = parameters["TZID"].map({ TimeZone(identifier: $0) }) ?? .some(.current) else { return nil }
            formatter.timeZone = zone
        }
        return formatter.date(from: value).map { ($0, false) }
    }
}

/// Saves reviewed events with write-only calendar access, requested on first use.
@MainActor
final class CalendarEventWriter {
    private let store = EKEventStore()

    func save(ics: String) async throws -> Int {
        let drafts = try CalendarICS.events(in: ics)
        try await requestAccess()
        guard let calendar = store.defaultCalendarForNewEvents else { throw NativeToolError("CALENDAR_UNAVAILABLE") }
        for draft in drafts {
            let event = EKEvent(eventStore: store)
            event.calendar = calendar
            event.title = draft.title
            event.startDate = draft.start
            event.endDate = draft.end
            event.isAllDay = draft.allDay
            event.location = draft.location
            event.notes = draft.notes
            do { try store.save(event, span: .thisEvent, commit: false) } catch {
                store.reset()
                throw NativeToolError("CALENDAR_SAVE_FAILED")
            }
        }
        do { try store.commit() } catch {
            store.reset()
            throw NativeToolError("CALENDAR_SAVE_FAILED")
        }
        return drafts.count
    }

    private func requestAccess() async throws {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess, .writeOnly: return
        case .notDetermined:
            let granted = (try? await store.requestWriteOnlyAccessToEvents()) ?? false
            if granted == false { throw NativeToolError("CALENDAR_ACCESS_DENIED") }
        default: throw NativeToolError("CALENDAR_ACCESS_DENIED")
        }
    }
}
