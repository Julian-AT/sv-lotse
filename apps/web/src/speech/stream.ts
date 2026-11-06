import { z } from "zod";

const streamPart = z.object({ type: z.string(), delta: z.string().optional() });
/** Consume the SDK's SSE transport without buffering speech until turn completion. */
export async function consumeGuidanceResponse(
  response: Response,
  receive: (part: unknown) => void,
  onText: (text: string) => void,
): Promise<void> {
  if (!response.ok || !response.body) throw new Error("TURN_UNAVAILABLE");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      buffer += next.value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const raw: unknown = JSON.parse(line.slice(6));
        const part = streamPart.parse(raw);
        if (part.type === "error") throw new Error("TURN_FAILED");
        if (part.type === "text-delta" && part.delta) onText(part.delta);
        receive(raw);
      }
    }
  } finally {
    reader.releaseLock();
  }
}
