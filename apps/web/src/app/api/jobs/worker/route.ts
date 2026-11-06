import { jobWorkerResponse } from "@/server/job-worker.ts";

export const runtime = "nodejs";
export const maxDuration = 300;

// Vercel Cron issues GET; the PRD names POST for other schedulers and the Workflow runtime.
export const GET = jobWorkerResponse;
export const POST = jobWorkerResponse;
