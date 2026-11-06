// Research-only tool server for the AT-Benefits gym (docs/research/lotse-rl.md §5.4).
// Not exported from @lotse/brain and never imported by apps. Start with
//   DATABASE_URL=postgres://… bun packages/brain/src/research/server.ts
// Contract: ml/README.md, section "Research tool server".
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createDatabase } from "@lotse/db";
import { caseActors, cases, subjects, turns, users } from "@lotse/db/schema";
import { z } from "zod";
import type { RuntimeContext } from "../agent/context.ts";
import { contracts, isToolName, type ToolName } from "../tools/contracts/index.ts";
import { buildTools } from "../tools/registry.ts";
import { computeGold, GoldError } from "./gold.ts";
import { catalogSummary } from "./summary.ts";
import { loadWorld, type World } from "./world.ts";

/** Tools whose implementation calls a language or embedding model. */
export const MODEL_TOOLS: ReadonlySet<ToolName> = new Set<ToolName>([
  "kb.search",
  "docs.extractStatements",
  "docs.explainLetter",
  "reminder.extract",
  "form.analyze",
  "form.getSchema",
]);
const MODEL_HOSTS = ["api.openai.com"];
const CASE_HEADER = "x-research-case";

// Belt and braces: the research server never reaches a model provider.
const originalFetch = globalThis.fetch;
globalThis.fetch = Object.assign(
  async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (MODEL_HOSTS.includes(url.hostname)) throw new ModelUnavailable();
    return originalFetch(input, init);
  },
  originalFetch,
);
class ModelUnavailable extends Error {
  constructor() {
    super("model tool not available in research server");
  }
}

const episodeInput = z
  .strictObject({ confirmedGoal: z.string().optional(), lifeSituation: z.string().optional() })
  .default({});

export type ResearchServer = { url: string; stop: () => Promise<void>; world: World };

export async function startResearchServer(
  options: { port?: number; hostname?: string } = {},
): Promise<ResearchServer> {
  const database = createDatabase({ ...process.env, DATABASE_POOL_SIZE: "10" });
  const db = database.db;
  let world = await loadWorld(db);
  let summary = catalogSummary(world);
  const contexts = new Map<string, RuntimeContext>();

  async function createEpisode(input: z.infer<typeof episodeInput>): Promise<RuntimeContext> {
    const userId = randomUUID();
    const subjectId = randomUUID();
    const caseId = randomUUID();
    const actorId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId });
      await tx.insert(subjects).values({
        id: subjectId,
        displayName: "Research subject",
        relationToUser: "self",
        createdBy: userId,
      });
      await tx.insert(cases).values({
        id: caseId,
        subjectId,
        confirmedGoal: input.confirmedGoal ?? "",
        ...(input.lifeSituation ? { lifeSituation: input.lifeSituation } : {}),
      });
      await tx
        .insert(caseActors)
        .values({ id: actorId, caseId, userId, role: "subject", shareScope: {} });
      await tx.insert(turns).values({ caseId });
    });
    const context: RuntimeContext = {
      caseId,
      subjectId,
      actorId,
      userId,
      sessionId: randomUUID(),
      actorRole: "subject",
      // L1: approval tools stay denied by the product's own permission rule.
      autonomyLevel: "L1",
      shareScope: {},
      sentenceIndex: 0,
    };
    contexts.set(caseId, context);
    return context;
  }
  const defaultContext = await createEpisode({});
  const tools = buildTools({ allowStubs: false, db, writer: { write: () => {} } });

  function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
  }
  function episodeView(context: RuntimeContext) {
    return { caseId: context.caseId, subjectId: context.subjectId };
  }
  async function body(request: Request): Promise<unknown> {
    const raw = await request.text();
    if (!raw.trim()) return {};
    return JSON.parse(raw) as unknown;
  }

  async function runTool(name: ToolName, request: Request): Promise<Response> {
    const contract = contracts[name];
    if (contract.location === "client")
      return json(
        { error: "client_tool", message: "client tool not available in research server" },
        501,
      );
    if (MODEL_TOOLS.has(name))
      return json(
        { error: "model_tool", message: "model tool not available in research server" },
        501,
      );
    const caseId = request.headers.get(CASE_HEADER);
    const context = caseId ? contexts.get(caseId) : defaultContext;
    if (!context) return json({ error: "unknown_case", message: `unknown ${CASE_HEADER}` }, 404);
    const input = contract.input.safeParse(await body(request));
    if (!input.success) return json({ error: "invalid_input", issues: input.error.issues }, 400);
    const tool = tools[name];
    if (!tool.execute) return json({ error: "client_tool" }, 501);
    try {
      const output = await tool.execute(input.data, {
        toolCallId: randomUUID(),
        messages: [],
        context,
      });
      return json(output);
    } catch (error) {
      return toolError(error);
    }
  }

  function toolError(error: unknown): Response {
    if (
      error instanceof ModelUnavailable ||
      (error instanceof Error && error.cause instanceof ModelUnavailable)
    )
      return json(
        { error: "model_tool", message: "model tool not available in research server" },
        501,
      );
    if (error instanceof z.ZodError)
      return json({ error: "invalid_output", issues: error.issues }, 500);
    if (error instanceof Error && error.message === "Tool permission denied")
      return json(
        { error: "permission_denied", message: "tool needs approval and is not run here" },
        403,
      );
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === "string" && error instanceof Error)
      // Domain errors carry stable codes the policy can react to (e.g. OFFICE_CONTEXT_REQUIRED).
      return json({ error: code, message: error.message }, 422);
    return json(
      { error: "tool_failed", message: error instanceof Error ? error.name : "unknown" },
      500,
    );
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health")
        return json({
          ok: true,
          benefits: world.benefits.length,
          processes: world.processes.length,
          offices: world.offices.size,
          defaultCase: episodeView(defaultContext),
        });
      if (request.method === "GET" && url.pathname === "/catalog/summary") return json(summary);
      if (request.method === "GET" && url.pathname === "/tools")
        return json(
          Object.entries(contracts).map(([name, contract]) => ({
            name,
            description: contract.description,
            location: contract.location,
            approval: contract.approval,
            available:
              contract.location !== "client" &&
              !MODEL_TOOLS.has(name as ToolName) &&
              !contract.approval,
            input: z.toJSONSchema(contract.input, { unrepresentable: "any" }),
          })),
        );
      if (request.method === "POST" && url.pathname === "/reload") {
        // After `bun run catalog:load`, pick up the new catalog without restarting.
        world = await loadWorld(db);
        summary = catalogSummary(world);
        return json({
          ok: true,
          benefits: world.benefits.length,
          processes: world.processes.length,
        });
      }
      if (request.method === "POST" && url.pathname === "/episodes") {
        const input = episodeInput.safeParse(await body(request));
        if (!input.success)
          return json({ error: "invalid_input", issues: input.error.issues }, 400);
        return json(episodeView(await createEpisode(input.data)), 201);
      }
      if (request.method === "POST" && url.pathname === "/gold") {
        const payload = (await body(request)) as { persona?: unknown } | null;
        try {
          return json(await computeGold(world, payload?.persona ?? payload));
        } catch (error) {
          if (error instanceof z.ZodError)
            return json({ error: "invalid_persona", issues: error.issues }, 400);
          if (error instanceof GoldError)
            return json({ error: error.code, message: error.message }, 400);
          throw error;
        }
      }
      if (request.method === "POST" && url.pathname.startsWith("/tools/")) {
        const name = decodeURIComponent(url.pathname.slice("/tools/".length));
        if (!isToolName(name)) return json({ error: "unknown_tool", message: name }, 404);
        return await runTool(name, request);
      }
      return json({ error: "not_found" }, 404);
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: "invalid_json" }, 400);
      return json(
        { error: "server_error", message: error instanceof Error ? error.name : "unknown" },
        500,
      );
    }
  }

  const hostname = options.hostname ?? "127.0.0.1";
  const server = createServer((incoming, outgoing) => {
    void serve(incoming, outgoing, handle);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? Number(process.env.PORT ?? 4317), hostname, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${hostname}:${port}`,
    get world() {
      return world;
    },
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await database.close();
    },
  };
}

async function serve(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  handle: (request: Request) => Promise<Response>,
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const request = new Request(`http://localhost${incoming.url ?? "/"}`, {
    method: incoming.method ?? "GET",
    headers: Object.entries(incoming.headers).flatMap(([key, value]) =>
      value === undefined
        ? []
        : [[key, Array.isArray(value) ? value.join(", ") : value] as [string, string]],
    ),
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
  });
  const response = await handle(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

if (import.meta.main) {
  const server = await startResearchServer();
  process.stdout.write(`Research tool server listening on ${server.url}\n`);
}
