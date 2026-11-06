import { z } from "zod";
import { CURSOR_MAX_BYTES } from "./config.ts";

export const pointerMessageSchema = z.strictObject({
  type: z.enum(["pointer", "mark", "clear", "leave"]),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export type PointerMessage = z.infer<typeof pointerMessageSchema>;
export function readPointerMessage(bytes: Uint8Array): PointerMessage | null {
  if (bytes.byteLength > CURSOR_MAX_BYTES) return null;
  try {
    const result = pointerMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Coordinates inside the contained video image, excluding letterbox bars. */
export function videoPoint(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  video: { width: number; height: number },
): { x: number; y: number } | null {
  if (video.width <= 0 || video.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const scale = Math.min(box.width / video.width, box.height / video.height);
  const width = video.width * scale;
  const height = video.height * scale;
  const x = (clientX - box.left - (box.width - width) / 2) / width;
  const y = (clientY - box.top - (box.height - height) / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
