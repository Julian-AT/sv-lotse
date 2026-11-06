import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@lotse/db";
import { migrateDatabase } from "@lotse/db/migrations";
import { sessions, subjects, users } from "@lotse/db/schema";
import { signCookie } from "../src/server/session-cookie.ts";
import { loadLocalEnvironment } from "./load-env.mjs";

loadLocalEnvironment();
const root = fileURLToPath(new URL("../../../", import.meta.url));
const admin = createDatabase();
const name = `lotse_document_smoke_${randomUUID().replaceAll("-", "")}`;
const url = new URL(admin.config.DATABASE_URL);
url.pathname = `/${name}`;
const database = createDatabase({ ...process.env, DATABASE_URL: url.toString() });
const userId = randomUUID();
const sessionId = randomUUID();
const subjectId = randomUUID();
let child;
let created = false;
let documentId;
let base;
let cookie;

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
async function request(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { cookie, origin: base, ...options.headers },
  });
}
async function json(path, body) {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const failure = await response.json();
    assert.fail(
      `HTTP check failed: ${response.status} (${String(failure.error).replace(/[^A-Za-z_]/gu, "")})`,
    );
  }
  return response.json();
}

try {
  await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
  created = true;
  await migrateDatabase(database);
  await database.db.insert(users).values({ id: userId });
  await database.db.insert(sessions).values({
    id: sessionId,
    userId,
    clientKind: "web",
    expiresAt: new Date(Date.now() + 3600000),
  });
  await database.db.insert(subjects).values({
    id: subjectId,
    createdBy: userId,
    relationToUser: "self",
    displayName: "Document smoke test",
  });
  const port = await availablePort();
  base = `http://127.0.0.1:${port}`;
  cookie = `lotse_session=${signCookie(sessionId, process.env.SESSION_SECRET)}`;
  child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./start-standalone.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        PORT: String(port),
        LOTSE_WORKSPACE_URL: base,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SERVER_START_TIMEOUT")), 20000);
    child.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("Ready")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("SERVER_START_FAILED"));
    });
  });
  const bytes = await readFile(
    resolve(root, process.env.SVBOX_DIR ?? "data/svbox", "Befunde/Entlassungsbefund.pdf"),
  );
  const body = new FormData();
  body.set("file", new File([bytes], "document.pdf", { type: "application/pdf" }));
  body.set("subjectId", subjectId);
  const uploaded = await request("/api/documents", { method: "POST", body });
  assert.equal(uploaded.status, 201, "UPLOAD_FAILED");
  const receipt = await uploaded.json();
  documentId = receipt.documentId;
  assert.equal(receipt.pageCount, 7);
  const original = await request(`/api/documents/${documentId}?subjectId=${subjectId}`);
  assert.equal(original.status, 200);
  assert(Buffer.from(await original.arrayBuffer()).equals(bytes));
  const extracted = await json(`/api/documents/${documentId}/extract`, { subjectId });
  assert(extracted.proposals.length > 0, "NO_PROPOSALS");
  const before = await (await request(`/api/facts?subjectId=${subjectId}`)).json();
  assert.equal(before.facts.length, 0);
  const confirmed = await json("/api/facts", {
    proposalToken: extracted.proposals[0].proposalToken,
    confirmed: true,
  });
  assert.equal(confirmed.fact.confirmed, true);
  const after = await (await request(`/api/facts?subjectId=${subjectId}`)).json();
  assert.equal(after.facts.length, 1);
  const deleted = await request(`/api/documents/${documentId}?subjectId=${subjectId}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  documentId = undefined;
  const remaining = await (await request(`/api/facts?subjectId=${subjectId}`)).json();
  assert.equal(remaining.facts.length, 0);
  console.info(
    "Production document flow passed: upload, original, extraction, confirmation, scoped facts, deletion.",
  );
} finally {
  if (documentId && base && cookie)
    await request(`/api/documents/${documentId}?subjectId=${subjectId}`, {
      method: "DELETE",
    }).catch(() => undefined);
  if (child && child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await stopped;
  }
  await database.close();
  if (created) await admin.sql`DROP DATABASE ${admin.sql(name)} WITH (FORCE)`;
  await admin.close();
}
