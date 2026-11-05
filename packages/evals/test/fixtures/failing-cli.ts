import { runCli } from "../../src/cli.ts";
import { createDemoSuite } from "../../src/demo.ts";
import { Registry } from "../../src/runner/index.ts";

const registry = new Registry();
const suite = createDemoSuite();
suite.execute = async () => ({ passed: false, metrics: {} });
registry.register(suite);
process.exitCode = await runCli(process.argv.slice(2), registry);
