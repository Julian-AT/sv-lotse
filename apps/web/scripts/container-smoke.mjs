import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createDatabase } from "@lotse/db";
import { parseEnvironment, resourceEnvironment } from "../src/server/env.ts";
import { serverEnvironmentNames } from "./check-client-env.mjs";
import { loadLocalEnvironment } from "./load-env.mjs";

loadLocalEnvironment();
const env = { ...process.env, ...resourceEnvironment(parseEnvironment(process.env)) };
const name = `lotse-web-smoke-${randomUUID()}`;
const image = "lotse-web:release";
const databaseName = `lotse_smoke_${randomUUID().replaceAll("-", "")}`;
let databaseCreated = false;
const admin = createDatabase(env);
function docker(args, options = {}) {
  const result = spawnSync("docker", args, { env, encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(`Docker operation failed: ${args[0]}`);
  return result.stdout?.trim() ?? "";
}

try {
  docker(["build", "-f", "apps/web/Dockerfile", "-t", image, "."], { stdio: "inherit" });
  // Find the actual Compose network and service aliases rather than assuming a project name.
  const dbId = docker(["compose", "ps", "-q", "db"]);
  const storageId = docker(["compose", "ps", "-q", "minio"]);
  if (!dbId || !storageId)
    throw new Error("Start the Compose services before the container smoke test");
  const dbInfo = JSON.parse(
    docker(["inspect", "--format", "{{json .NetworkSettings.Networks}}", dbId]),
  );
  const storageInfo = JSON.parse(
    docker(["inspect", "--format", "{{json .NetworkSettings.Networks}}", storageId]),
  );
  const network = Object.keys(dbInfo).find((key) => storageInfo[key]);
  if (!network) throw new Error("Compose services do not share a network");
  const databaseUrl = new URL(env.DATABASE_URL);
  await admin.sql`CREATE DATABASE ${admin.sql(databaseName)}`;
  databaseCreated = true;
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.hostname = "db";
  databaseUrl.port = "5432";
  const endpoint = new URL(env.S3_ENDPOINT);
  endpoint.hostname = "minio";
  endpoint.port = "9000";
  const runtimeEnv = {
    ...env,
    DATABASE_URL: databaseUrl.href,
    S3_ENDPOINT: endpoint.href,
    LOTSE_WORKSPACE_URL: "https://lotse.example",
    SVBOX_DIR: "/data/svbox",
  };
  const envFlags = serverEnvironmentNames
    .filter((key) => runtimeEnv[key] !== undefined)
    .flatMap((key) => ["--env", key]);
  docker(
    [
      "run",
      "-d",
      "--name",
      name,
      "--network",
      network,
      ...envFlags,
      "-p",
      "127.0.0.1::3000",
      image,
    ],
    { env: runtimeEnv },
  );
  const binding = docker(["port", name, "3000/tcp"]);
  const address = `http://${binding}`;
  const deadline = Date.now() + 90_000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${address}/api/health`, { signal: AbortSignal.timeout(5000) });
      const body = await response.json();
      if (
        response.status === 200 &&
        body.dependencies?.database === "up" &&
        body.dependencies?.objectStorage === "up"
      ) {
        healthy = true;
        break;
      }
    } catch {
      /* The container may still be applying migrations or starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!healthy) throw new Error("Container health did not become ready before the timeout");
  const page = await fetch(address, {
    headers: { host: "lotse.example", "x-forwarded-proto": "https" },
    signal: AbortSignal.timeout(15_000),
  });
  const hasSession = page.headers.has("set-cookie");
  const hasWorkspace = (await page.text()).includes("<main");
  if (!page.ok || !hasSession || !hasWorkspace)
    throw new Error(
      `Container workspace failed: status=${page.status}, session=${hasSession}, main=${hasWorkspace}`,
    );
  const runtime = await fetch(`${address}/api/guide/runtime`);
  if (!runtime.ok || !(await runtime.text()).includes("__lotseGuide"))
    throw new Error("Container guide asset is missing");
  const booking = await fetch(`${address}/guided`);
  if (!booking.ok) throw new Error("Container knowledge assets are missing");
  if (docker(["exec", name, "id", "-u"]) === "0")
    throw new Error("Container must run as a non-root user");
  process.stdout.write(
    "Standalone container: isolated migrations, workspace, sessions, guide, knowledge, non-root runtime and both dependencies healthy.\n",
  );
} catch (error) {
  // Never dump container logs, environment, driver errors or command arguments.
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "Container smoke failed\n");
  const logs = spawnSync("docker", ["logs", name], { encoding: "utf8" });
  const diagnostics = `${logs.stdout ?? ""} ${logs.stderr ?? ""}`;
  const codes = [
    "SESSION_REQUIRED",
    "ENOENT",
    "MODULE_NOT_FOUND",
    "ERR_MODULE_NOT_FOUND",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "SessionUnauthorized",
  ].filter((code) => diagnostics.includes(code));
  process.stderr.write(`Container diagnostic codes: ${codes.join(", ")}\n`);
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  try {
    if (databaseCreated) await admin.sql`DROP DATABASE ${admin.sql(databaseName)} WITH (FORCE)`;
  } finally {
    await admin.close();
  }
}
