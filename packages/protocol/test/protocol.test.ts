import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  BridgeToNativeSchema,
  BridgeToWorkspaceSchema,
  DATA_PARTS,
  MESSAGE_SCHEMAS,
  PROTOCOL_VERSION,
  TargetSchema,
} from "../src/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const messageNames = [
  "BridgeHello",
  "ClientHello",
  "Transcript",
  "TurnRequest",
  "ContextCapsule",
  "SpeechSegment",
  "Action",
  "ToolInvocation",
  "ToolOutput",
  "ApprovalContext",
  "ApprovalDecision",
  "ActionResult",
  "SpeechControl",
  "TargetRect",
  "Fact",
  "CaseEvent",
  "JobProgress",
  "SafetyNotice",
];
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(
  JSON.parse(readFileSync(`${root}generated/json/protocol.schema.json`, "utf8")),
  "lotse-protocol",
);

it("AC1 exports exactly the PRD section 9 messages", () => {
  expect(Object.keys(MESSAGE_SCHEMAS).sort()).toEqual(messageNames.sort());
});

it("AC1 exports all six semantic target variants", () => {
  expect(TargetSchema.options.map((schema) => schema.shape.kind.value).sort()).toEqual(
    ["ui", "form", "dom", "ax", "text", "point"].sort(),
  );
});

it("FR-C3 maps exactly the six stream data parts plus the transient status line", () => {
  expect(Object.keys(DATA_PARTS).sort()).toEqual(
    [
      "speech-segment",
      "action",
      "case-event",
      "safety-notice",
      "job-progress",
      "approval-context",
      "status",
    ].sort(),
  );
});

for (const [name, schema] of Object.entries({ ...MESSAGE_SCHEMAS, Target: TargetSchema })) {
  describe(name, () => {
    const directory = `${root}fixtures/${name}`;
    const files = readdirSync(directory)
      .filter((file) => file.endsWith(".json"))
      .sort();
    it("AC2 has both valid and invalid contract examples", () => {
      expect(files.some((file) => file.startsWith("valid"))).toBe(true);
      expect(files.some((file) => file.startsWith("invalid"))).toBe(true);
    });
    for (const file of files) {
      it(`AC2 Zod and Ajv agree on ${file}`, () => {
        const fixture: unknown = JSON.parse(readFileSync(`${directory}/${file}`, "utf8"));
        const jsonSchema = JSON.parse(
          readFileSync(`${root}generated/json/${name}.schema.json`, "utf8"),
        );
        const validate = ajv.compile(jsonSchema);
        const expected = file.startsWith("valid");
        expect(schema.safeParse(fixture).success).toBe(expected);
        expect(validate(fixture), JSON.stringify(validate.errors)).toBe(expected);
        const validateBundled = ajv.compile({ $ref: `lotse-protocol#/$defs/${name}` });
        expect(validateBundled(fixture), JSON.stringify(validateBundled.errors)).toBe(expected);
      });
    }
  });
}

for (const [name, schema] of [
  ["BridgeToWorkspace", BridgeToWorkspaceSchema],
  ["BridgeToNative", BridgeToNativeSchema],
] as const) {
  describe(name, () => {
    const jsonSchema = JSON.parse(
      readFileSync(`${root}generated/json/${name}.schema.json`, "utf8"),
    );
    const validate = ajv.compile(jsonSchema);
    for (const option of schema.options) {
      const type = option.shape.type.value;
      const payload: unknown = JSON.parse(
        readFileSync(`${root}fixtures/${type}/valid.json`, "utf8"),
      );
      it(`FR-C5 accepts ${type} only with the matching payload and version`, () => {
        const envelope = { v: PROTOCOL_VERSION, type, id: "bridge-message-1", payload };
        expect(schema.safeParse(envelope).success).toBe(true);
        expect(validate(envelope)).toBe(true);
        for (const invalid of [
          { ...envelope, type: "UnknownMessage" },
          { ...envelope, v: "2.0.0" },
          { ...envelope, payload: null },
          { ...envelope, extra: true },
        ]) {
          expect(schema.safeParse(invalid).success).toBe(false);
          expect(validate(invalid)).toBe(false);
        }
      });
    }
  });
}

const messageFields = {
  BridgeHello: "appVersion protocolVersion capabilities",
  ClientHello: "clientKind appVersion protocolVersion capabilities locale",
  Transcript: "text language final capsule",
  TurnRequest: "caseId subjectId inputKind language capsule actionResults",
  ContextCapsule: "screen page focusedRegion",
  SpeechSegment: "turnId index text language citations actionIds",
  Action: "id kind target payload sentenceIndex",
  ToolInvocation: "toolCallId toolName input",
  ToolOutput: "toolCallId output error",
  ApprovalContext: "approvalId caseId toolCallId toolName inputHash provenance summary",
  ApprovalDecision: "approvalId approved reason via",
  ActionResult: "actionId resolvedBy confidence success failureReason",
  SpeechControl: "stop state segmentIndex",
  TargetRect: "targetId rect scale visible",
  Fact: "id subjectId type value source confidence confirmed",
  CaseEvent: "caseId kind payload",
  JobProgress: "jobId state progress message",
  SafetyNotice: "text numbers scopeAfter",
} as const;

for (const [name, schema] of Object.entries(MESSAGE_SCHEMAS)) {
  it(`AC1 ${name} has exactly the PRD fields on every variant`, () => {
    const shapes =
      "shape" in schema ? [schema.shape] : schema.options.map((option) => option.shape);
    for (const shape of shapes) {
      expect(Object.keys(shape).sort()).toEqual(
        messageFields[name as keyof typeof messageFields].split(" ").sort(),
      );
    }
  });
}

it("AC1 Target variants have exactly their semantic fields", () => {
  const fields = {
    ui: "kind elementId",
    form: "kind formInstanceId fieldId",
    dom: "kind handle url",
    ax: "kind role label path appBundleId",
    text: "kind quote documentId page",
    point: "kind x y screenIndex confidence",
  } as const;
  for (const option of TargetSchema.options) {
    expect(Object.keys(option.shape).sort()).toEqual(
      fields[option.shape.kind.value].split(" ").sort(),
    );
  }
});

it("FR-D5 requires a value, provenance and a positive pace for typing", () => {
  const schema = MESSAGE_SCHEMAS.Action;
  const action: unknown = JSON.parse(readFileSync(`${root}fixtures/Action/valid.json`, "utf8"));
  const valid = schema.parse(action);
  if (valid.kind !== "type") throw new Error("Expected a typing fixture");
  for (const payload of [
    { value: valid.payload.value, pace: valid.payload.pace },
    { value: valid.payload.value, provenance: valid.payload.provenance },
    { ...valid.payload, pace: 0 },
    { ...valid.payload, value: 42 },
  ]) {
    expect(schema.safeParse({ ...valid, payload }).success).toBe(false);
  }
});

it("FR-A2 never accepts a client autonomy level in TurnRequest", () => {
  const request = { inputKind: "text", capsule: {}, actionResults: [] };
  expect(MESSAGE_SCHEMAS.TurnRequest.safeParse(request).success).toBe(true);
  expect(MESSAGE_SCHEMAS.TurnRequest.safeParse({ ...request, autonomyLevel: "L3" }).success).toBe(
    false,
  );
});

for (const [name, field, value] of [
  ["ActionResult", "confidence", -0.01],
  ["ActionResult", "confidence", 1.01],
  ["JobProgress", "progress", 1.01],
  ["TargetRect", "scale", 0],
  ["SpeechSegment", "index", -1],
  ["SpeechSegment", "index", 0.5],
  ["BridgeHello", "protocolVersion", "2.0.0"],
  ["ClientHello", "clientKind", "robot"],
  ["ApprovalDecision", "via", "automatic"],
] as const) {
  it(`NFR-13 rejects invalid ${name}.${field}: ${value}`, () => {
    const schema = MESSAGE_SCHEMAS[name];
    const fixture: unknown = JSON.parse(readFileSync(`${root}fixtures/${name}/valid.json`, "utf8"));
    const invalid = { ...schema.parse(fixture), [field]: value };
    expect(schema.safeParse(invalid).success).toBe(false);
    const validate = ajv.compile({ $ref: `lotse-protocol#/$defs/${name}` });
    expect(validate(invalid)).toBe(false);
  });
}

it("FR-C5 keeps normalized source boxes distinct from window coordinates", () => {
  const target = MESSAGE_SCHEMAS.TargetRect.parse({
    targetId: "person-name",
    rect: { x: -20, y: 320, width: 280, height: 32 },
    scale: 2,
    visible: true,
  });
  expect(target.rect.x).toBe(-20);
  const validate = ajv.compile({ $ref: "lotse-protocol#/$defs/BoundingBox" });
  expect(validate({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
  for (const box of [
    { x: -0.1, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 1.1, height: 1 },
  ]) {
    expect(validate(box)).toBe(false);
  }
});
