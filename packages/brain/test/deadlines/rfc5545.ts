import assert from "node:assert/strict";

// Dependency-free test parser for RFC 5545 content lines/components and the
// DATE, DATE-TIME, TEXT and UTC-OFFSET values emitted by this export. It rejects
// unsupported time-zone recurrence rules rather than pretending to expand them.
export type Property = { name: string; parameters: Map<string, string>; value: string };
export type Component = { name: string; properties: Property[]; children: Component[] };

function property(line: string): Property {
  const match = /^([A-Z0-9-]+)((?:;[A-Z0-9-]+=(?:"[^"\r\n]*"|[^:;"\r\n]+))*):(.*)$/i.exec(line);
  assert(match, "Invalid RFC 5545 content line");
  const [, name = "", params = "", value = ""] = match;
  const parameters = new Map<string, string>();
  for (const param of params.matchAll(/;([A-Z0-9-]+)=("[^"]*"|[^;]+)/gi)) {
    parameters.set((param[1] ?? "").toUpperCase(), (param[2] ?? "").replace(/^"|"$/g, ""));
  }
  return { name: name.toUpperCase(), parameters, value };
}

export function getProperty(component: Component, name: string): Property {
  const matches = component.properties.filter((entry) => entry.name === name);
  assert.equal(matches.length, 1, `Expected one ${name}`);
  const [result] = matches;
  assert(result);
  return result;
}

export function parseCalendar(input: string): Component {
  assert(input.endsWith("\r\n"), "Calendar must end with CRLF");
  assert(!input.replaceAll("\r\n", "").includes("\n"), "Bare LF");
  const lines = input.replace(/\r\n[ \t]/g, "").split("\r\n");
  lines.pop();
  const root: Component = { name: "ROOT", properties: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    const field = property(line);
    const current = stack.at(-1);
    assert(current, "Unexpected component end");
    if (field.name === "BEGIN") {
      const child = { name: field.value, properties: [], children: [] };
      current.children.push(child);
      stack.push(child);
    } else if (field.name === "END") {
      assert.equal(current.name, field.value, "Mismatched component end");
      stack.pop();
    } else current.properties.push(field);
  }
  assert.equal(stack.length, 1, "Unclosed component");
  assert.equal(root.children.length, 1);
  const [calendar] = root.children;
  assert(calendar);
  assert.equal(calendar.name, "VCALENDAR");
  assert.equal(getProperty(calendar, "VERSION").value, "2.0");
  assert(getProperty(calendar, "PRODID").value);
  const uids = new Set<string>();
  for (const event of calendar.children.filter((child) => child.name === "VEVENT")) {
    const uid = getProperty(event, "UID").value;
    assert(uid && !uids.has(uid), "Duplicate or empty UID");
    uids.add(uid);
    assert.match(getProperty(event, "DTSTAMP").value, /^\d{8}T\d{6}Z$/);
    parseStart(calendar, event);
  }
  return calendar;
}

function timestamp(value: string): number {
  assert.match(value, /^\d{8}T\d{6}Z?$/);
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
  const result = Date.parse(iso);
  assert(Number.isFinite(result), "Invalid calendar date");
  return result;
}

function offset(value: string): number {
  assert.match(value, /^[+-]\d{4}(?:\d{2})?$/);
  return (
    (value.startsWith("-") ? -1 : 1) *
    (Number(value.slice(1, 3)) * 3600 +
      Number(value.slice(3, 5)) * 60 +
      Number(value.slice(5) || 0))
  );
}

/** Resolve local times using the exported observances, independently of Intl. */
export function parseStart(calendar: Component, event: Component): Date | string {
  const start = getProperty(event, "DTSTART");
  if (start.parameters.get("VALUE") === "DATE") {
    assert.match(start.value, /^\d{8}$/);
    return start.value;
  }
  if (start.value.endsWith("Z")) return new Date(timestamp(start.value));
  const tzid = start.parameters.get("TZID");
  assert(tzid, "Floating date-time is not supported by this export");
  const zone = calendar.children.find(
    (child) => child.name === "VTIMEZONE" && getProperty(child, "TZID").value === tzid,
  );
  assert(zone, "Missing VTIMEZONE");
  const local = timestamp(start.value);
  const transitions = zone.children
    .map((observance) => {
      assert(["STANDARD", "DAYLIGHT"].includes(observance.name));
      assert(!observance.properties.some((entry) => entry.name === "RRULE"));
      const from = offset(getProperty(observance, "TZOFFSETFROM").value);
      const to = offset(getProperty(observance, "TZOFFSETTO").value);
      return { local: timestamp(getProperty(observance, "DTSTART").value), from, to };
    })
    .sort((left, right) => left.local - right.local);
  const transition = transitions.findLast((entry) => entry.local <= local);
  assert(transition, "No applicable time-zone observance");
  return new Date(local - transition.to * 1000);
}

export function textValue(value: string): string {
  assert(!/(^|[^\\])(?:\\\\)*\\[^nN,;\\]/.test(value), "Invalid TEXT escape");
  return value.replace(/\\([nN,;\\])/g, (_, escaped: string) =>
    /[nN]/.test(escaped) ? "\n" : escaped,
  );
}
