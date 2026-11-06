import { jobWorkerResponse } from "@/server/job-worker.ts";

export const runtime = "nodejs";

export const maxDuration = 300;

/** Alias of `/api/jobs/worker`, kept for schedulers configured before the PRD name. */
export const GET = jobWorkerResponse;
export const POST = jobWorkerResponse;
