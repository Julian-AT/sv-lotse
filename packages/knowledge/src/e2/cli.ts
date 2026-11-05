import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeError, loadKnowledge } from "../loader/index.ts";
import { stubFlag } from "./config.ts";
import { scanRepository } from "./index.ts";

async function main(): Promise<void> {
  // "0" (or empty) is the brain's only accepted value and keeps stubs disabled.
  const flag = process.env[stubFlag];
  if (flag !== undefined && flag !== "" && flag !== "0") {
    process.stderr.write(`${stubFlag} must be unset or 0 for release validation.\n`);
    process.exitCode = 1;
    return;
  }
  const root = process.argv[2]
    ? resolve(process.argv[2])
    : fileURLToPath(new URL("../../../../", import.meta.url));
  const findings = await scanRepository(
    root,
    await loadKnowledge(resolve(root, "packages/knowledge")),
  );
  for (const finding of findings)
    process.stderr.write(`${finding.file}:${finding.line}: ${finding.rule}: ${finding.value}\n`);
  if (findings.length) process.exitCode = 1;
  else process.stdout.write("E2 generalization scan passed.\n");
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof KnowledgeError
      ? `${error.message}\n`
      : "E2 scan failed; check source paths and knowledge records.\n",
  );
  process.exitCode = 1;
});
