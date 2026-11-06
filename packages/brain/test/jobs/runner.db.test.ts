import { randomUUID } from "node:crypto";
import { jobs } from "@lotse/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleTurn } from "../../src/conversation/index.ts";
import { resolveContext } from "../../src/conversation/store.ts";
import { enqueueJob, getJob, runJobs } from "../../src/jobs/index.ts";
import { jobStateSchema } from "../../src/jobs/schema.ts";
import { claimJob, saveJobClaim } from "../../src/jobs/store.ts";
import {
  chunks,
  config,
  forcedModel,
  identity,
  isolatedDatabase,
  turn,
  userMessage,
} from "../runtime/helpers.ts";

describe("FR-C10 / NFR-4 durable jobs on real Postgres", () => {
  let database: Awaited<ReturnType<typeof isolatedDatabase>>;
  beforeAll(async () => {
    database = await isolatedDatabase();
  });
  afterAll(async () => {
    if (database) await database.cleanup();
  });
  async function fixture(count = 2) {
    const session = await identity(database.db);
    const context = await database.db.transaction((tx) => resolveContext(tx, turn, session));
    const part = await enqueueJob(
      database.db,
      {
        caseId: context.caseId,
        tasks: Array.from({ length: count }, () => ({
          toolName: "reminder.list",
          input: { caseId: context.caseId },
        })),
      },
      session,
    );
    return { session, context, id: part.data.jobId };
  }
  async function row(id: string) {
    const [job] = await database.db.select().from(jobs).where(eq(jobs.id, id));
    if (!job) throw new Error("Missing test job");
    return job;
  }
  async function retryNow(id: string) {
    const job = await row(id);
    await database.db
      .update(jobs)
      .set({ stepState: { ...job.stepState, retryAt: 0 } })
      .where(eq(jobs.id, id));
  }
  it("executes real authorized reminder reads and returns protocol progress and persisted results", async () => {
    const flow = await fixture();
    const parts = await runJobs(database.db);
    expect(parts).toContainEqual(
      expect.objectContaining({
        type: "data-job-progress",
        data: expect.objectContaining({ jobId: flow.id, state: "completed", progress: 1 }),
      }),
    );
    expect(await getJob(database.db, flow.id, flow.session)).toMatchObject({
      status: "completed",
      attempts: 1,
      results: [[], []],
    });
    expect(await runJobs(database.db)).toEqual([]);
    const stream = await chunks(
      await handleTurn({ ...turn, caseId: flow.context.caseId }, userMessage(), flow.session, {
        db: database.db,
        config,
        model: forcedModel(),
      }),
    );
    expect(stream).toContainEqual(
      expect.objectContaining({
        type: "data-job-progress",
        id: flow.id,
        data: expect.objectContaining({ state: "completed", progress: 1 }),
      }),
    );
  });
  it("checkpoints each completed step before the next begins and resumes only unfinished work", async () => {
    const flow = await fixture();
    const executed: number[] = [];
    // Test-only failing executor exercises crash boundaries without a provider call.
    await runJobs(database.db, async (step) => {
      executed.push(step.index);
      if (step.index === 1) {
        expect((await row(flow.id)).stepState).toMatchObject({
          nextStep: 1,
          results: [{ saved: true }],
        });
        throw new Error("sensitive-provider-error-sentinel");
      }
      return { saved: true };
    });
    expect(await row(flow.id)).toMatchObject({
      status: "pending",
      attempts: 1,
      stepState: { nextStep: 1, error: "JOB_STEP_FAILED" },
    });
    expect(JSON.stringify(await row(flow.id))).not.toContain("sensitive-provider-error-sentinel");
    await retryNow(flow.id);
    await runJobs(database.db, async (step) => {
      executed.push(step.index);
      return { resumed: true };
    });
    expect(executed).toEqual([0, 1, 1]);
    expect(await row(flow.id)).toMatchObject({
      status: "completed",
      attempts: 2,
      stepState: { results: [{ saved: true }, { resumed: true }] },
    });
  });
  it("reclaims an expired crash lease and fences the old process", async () => {
    const flow = await fixture();
    const old = await claimJob(database.db);
    if (!old || old.failed) throw new Error("Missing claim");
    await database.db
      .update(jobs)
      .set({ stepState: { ...old.state, nextStep: 1, results: [[]], leaseUntil: 0 } })
      .where(eq(jobs.id, flow.id));
    const replacement = await claimJob(database.db);
    if (!replacement || replacement.failed) throw new Error("Missing replacement");
    expect(replacement.state).toMatchObject({ nextStep: 1, results: [[]] });
    expect(replacement.row.attempts).toBe(2);
    await expect(saveJobClaim(database.db, old, old.state, "completed")).rejects.toMatchObject({
      code: "JOB_LEASE_LOST",
    });
    await saveJobClaim(
      database.db,
      replacement,
      { ...replacement.state, leaseId: null, leaseUntil: 0 },
      "pending",
    );
    const executed: number[] = [];
    await runJobs(database.db, async (step) => {
      executed.push(step.index);
      return [];
    });
    expect(executed).toEqual([1]);
  });
  it("does not let simultaneous workers execute the same leased job", async () => {
    await fixture(1);
    let release = () => {};
    let enter = () => {};
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    let executions = 0;
    const first = runJobs(database.db, async () => {
      executions++;
      enter();
      await paused;
      return [];
    });
    await entered;
    try {
      expect(await runJobs(database.db)).toEqual([]);
    } finally {
      release();
      await first;
    }
    expect(executions).toBe(1);
  });
  it("bounds attempts, delays retries and never retries a terminal failure", async () => {
    const flow = await fixture(1);
    let executions = 0;
    const fail = async () => {
      executions++;
      throw new Error("isolated test failure");
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      await runJobs(database.db, fail);
      if (attempt < 2) {
        expect(await runJobs(database.db, fail)).toEqual([]);
        await retryNow(flow.id);
      }
    }
    expect(await row(flow.id)).toMatchObject({ status: "failed", attempts: 3 });
    expect(executions).toBe(3);
    expect(await runJobs(database.db, fail)).toEqual([]);
  });
  it("fails malformed state without poisoning the remaining queue", async () => {
    const flow = await fixture(1);
    await database.db
      .update(jobs)
      .set({ stepState: { leaseUntil: "invalid" } })
      .where(eq(jobs.id, flow.id));
    const next = await fixture(1);
    await runJobs(database.db);
    expect((await row(flow.id)).status).toBe("failed");
    expect((await row(next.id)).status).toBe("completed");
  });
  it("rejects client capabilities, approval tools, other cases and untrusted identities", async () => {
    const flow = await fixture(1);
    await runJobs(database.db);
    for (const toolName of ["ui.fill", "form.commitGroup", "case.update"])
      await expect(
        enqueueJob(
          database.db,
          { caseId: flow.context.caseId, tasks: [{ toolName, input: {} }] },
          flow.session,
        ),
      ).rejects.toMatchObject({ code: "INVALID_JOB" });
    await expect(
      enqueueJob(
        database.db,
        {
          caseId: flow.context.caseId,
          tasks: [{ toolName: "reminder.list", input: { caseId: randomUUID() } }],
        },
        flow.session,
      ),
    ).rejects.toMatchObject({ code: "INVALID_JOB" });
    await expect(getJob(database.db, flow.id, await identity(database.db))).rejects.toMatchObject({
      code: "CASE_ACCESS_DENIED",
    });
    expect(jobStateSchema.parse((await row(flow.id)).stepState).nextStep).toBe(1);
  });
});
