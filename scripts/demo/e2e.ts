import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { createDatabase } from "@lotse/db";
import { z } from "zod";
import { DEMO_ROOT } from "./config.ts";

async function run(args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  const code = await new Promise<number>((resolve) => {
    const child = spawn("bun", args, { cwd: DEMO_ROOT, env: environment, stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) throw new Error("DEMO_COMMAND_FAILED");
}

async function main(): Promise<void> {
  if (existsSync(`${DEMO_ROOT}/.env.local`)) loadEnvFile(`${DEMO_ROOT}/.env.local`);
  z.literal("1").parse(process.env.RUN_LIVE);
  z.string().min(1).parse(process.env.OPENAI_API_KEY);
  const admin = createDatabase();
  const name = `lotse_demo_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(admin.config.DATABASE_URL);
  url.pathname = `/${name}`;
  const environment = { ...process.env, DATABASE_URL: url.href };
  try {
    await admin.sql`CREATE DATABASE ${admin.sql(name)}`;
    await run(["run", "demo:seed", "--catalog-only"], environment);
    await run(["run", "--filter", "@lotse/web", "e2e:demo", ...process.argv.slice(2)], environment);
  } finally {
    await admin.sql`DROP DATABASE IF EXISTS ${admin.sql(name)} WITH (FORCE)`;
    await admin.close();
  }
}
main().catch(() => {
  process.stderr.write('{"event":"demo_e2e_failed","code":"DEMO_RUN_FAILED"}\n');
  process.exitCode = 1;
});
