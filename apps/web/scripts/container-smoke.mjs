import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { parseEnvironment, resourceEnvironment } from "../src/server/env.ts";
import { serverEnvironmentNames } from "./check-client-env.mjs";
import { loadLocalEnvironment } from "./load-env.mjs";

loadLocalEnvironment();
const env = { ...process.env, ...resourceEnvironment(parseEnvironment(process.env)) };
const name = `lotse-web-smoke-${randomUUID()}`;
const image = "lotse-web:wp-005";
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
  databaseUrl.hostname = "db";
  databaseUrl.port = "5432";
  const endpoint = new URL(env.S3_ENDPOINT);
  endpoint.hostname = "minio";
  endpoint.port = "9000";
  const runtimeEnv = {
    ...env,
    DATABASE_URL: databaseUrl.href,
    S3_ENDPOINT: endpoint.href,
    LOTSE_WORKSPACE_URL: "http://localhost:3000",
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
  if (docker(["exec", name, "id", "-u"]) === "0")
    throw new Error("Container must run as a non-root user");
  process.stdout.write(
    "Standalone container: migrations, non-root runtime and both dependencies healthy.\n",
  );
} catch (error) {
  // Never dump container logs, environment, driver errors or command arguments.
  process.stderr.write(error instanceof Error ? `${error.message}\n` : "Container smoke failed\n");
  process.exitCode = 1;
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
}
