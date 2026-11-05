const state = globalThis as typeof globalThis & { lotseTelemetry?: Promise<void> };

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build")
    return;
  state.lotseTelemetry ??= import("./server/telemetry.ts").then(({ initializeTelemetry }) =>
    initializeTelemetry(),
  );
  await state.lotseTelemetry;
}
