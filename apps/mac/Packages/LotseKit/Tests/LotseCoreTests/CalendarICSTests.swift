import Foundation
import LotseBridge
import Testing

@testable import LotseCore

@Test("FR-R3 calendar.createEvent reads the brain's UTC, TZID and all-day VEVENTs")
func calendarEvents() throws {
    // Shapes mirror packages/brain/src/workspace/appointments.ts and deadlines/calendar.ts.
    let ics = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "BEGIN:VTIMEZONE", "TZID:Europe/Vienna", "BEGIN:STANDARD", "DTSTART:19701025T030000", "END:STANDARD", "END:VTIMEZONE",
        "BEGIN:VEVENT", "UID:a@sv-ki-lotse", "DTSTART:20261110T080000Z", "DTEND:20261110T083000Z",
        "SUMMARY:Termin vormerken: Gesundheitszentrum", "LOCATION:Wienerbergstraße 15\\, 1100 Wien",
        "DESCRIPTION:Kein Termin gebucht.\\nBitte selbst best", " ätigen.", "END:VEVENT",
        "BEGIN:VEVENT", "UID:b@sv-ki-lotse", "DTSTART;TZID=Europe/Vienna:20261201T090000", "SUMMARY:Frist", "END:VEVENT",
        "BEGIN:VEVENT", "UID:c@sv-ki-lotse", "DTSTART;VALUE=DATE:20261215", "SUMMARY:Antrag", "END:VEVENT",
        "END:VCALENDAR"
    ].joined(separator: "\r\n")
    let events = try CalendarICS.events(in: ics)
    try #require(events.count == 3)
    #expect(events[0].title == "Termin vormerken: Gesundheitszentrum")
    #expect(events[0].start == Date(timeIntervalSince1970: 1_794_297_600))
    #expect(events[0].end.timeIntervalSince(events[0].start) == 1_800)
    #expect(events[0].location == "Wienerbergstraße 15, 1100 Wien")
    #expect(events[0].notes == "Kein Termin gebucht.\nBitte selbst bestätigen.")
    #expect(events[1].start == Date(timeIntervalSince1970: 1_796_112_000))
    #expect(events[1].end.timeIntervalSince(events[1].start) == 3_600)
    #expect(events[2].allDay)
}

@Test("FR-R3 calendar.createEvent rejects files without a usable event")
func calendarRejectsInvalid() {
    #expect(throws: NativeToolError("INVALID_CALENDAR_EVENT")) { try CalendarICS.events(in: "BEGIN:VCALENDAR\r\nEND:VCALENDAR") }
    #expect(throws: NativeToolError("INVALID_CALENDAR_EVENT")) {
        try CalendarICS.events(in: "BEGIN:VEVENT\r\nDTSTART:20261110T080000Z\r\nEND:VEVENT")
    }
    #expect(throws: NativeToolError("INVALID_CALENDAR_EVENT")) {
        try CalendarICS.events(in: "BEGIN:VEVENT\r\nSUMMARY:x\r\nDTSTART:20261110T080000Z\r\nDTEND:20261110T070000Z\r\nEND:VEVENT")
    }
}
