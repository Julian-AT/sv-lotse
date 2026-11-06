import type { DatabaseClient } from "@lotse/db";
import { detectTurnControl } from "@lotse/knowledge/turn-controls";
import type { RuntimeContext } from "../agent/context.ts";
import { createAutonomyService } from "../autonomy/index.ts";
import { autonomyConfirmationMetadata } from "../autonomy/schema.ts";
import { createHelperSessionService } from "../subjects/helper-sessions.ts";
import type { LotseMessage } from "../tools/types.ts";
import { controlCopy } from "./control-copy.ts";

export interface ControlReply {
  reply: string;
  language: string;
  metadata?: ReturnType<typeof autonomyConfirmationMetadata.parse>;
}

/** Intercept explicit user controls before language classification, retrieval or model execution. */
export async function handleTurnControl(options: {
  db: DatabaseClient;
  context: RuntimeContext;
  latest: LotseMessage;
  history: LotseMessage[];
  language?: string;
}): Promise<ControlReply | undefined> {
  const { db, context, latest, history } = options;
  if (latest.role !== "user") return undefined;
  const text = latest.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  const intent = detectTurnControl(text);
  if (!intent) return undefined;
  const language = options.language ?? context.profileSettings?.language ?? "de";
  const copy = language.startsWith("en") ? controlCopy.en : controlCopy.de;
  const result = (reply: string): ControlReply => ({ reply, language });
  const previous = history.at(-2);
  const metadata = autonomyConfirmationMetadata.safeParse(previous?.metadata);
  const pending =
    previous?.role === "assistant" &&
    metadata.success &&
    metadata.data.autonomyConfirmation.actorId === context.actorId &&
    metadata.data.autonomyConfirmation.sessionId === context.sessionId
      ? metadata.data.autonomyConfirmation
      : undefined;
  // Generic yes/no belongs to normal goal/tool processing unless a server-owned card is pending.
  if ((intent.kind === "confirm" || intent.kind === "decline") && !pending) return undefined;
  if (context.actorRole !== "subject") return result(copy.forbidden);
  if (intent.kind === "pause") {
    const service = createHelperSessionService(
      { sql: db.$client },
      context.userId,
      context.sessionId,
    );
    const active = (await service.listHelperSessions(context.caseId)).filter(
      (join) => join.status === "active",
    );
    for (const join of active)
      await service.controlHelperSession({ joinId: join.id, action: "pause" });
    return result(active.length ? copy.paused : copy.noSharing);
  }
  if (intent.kind === "autonomy")
    return {
      ...result(copy.propose(intent.level)),
      metadata: {
        autonomyConfirmation: {
          level: intent.level,
          actorId: context.actorId,
          sessionId: context.sessionId,
        },
      },
    };
  if (intent.kind === "decline") return result(copy.declined);
  if (pending) {
    const changed = await createAutonomyService(db, context.userId).change({
      autonomyLevel: pending.level,
      confirmed: true,
    });
    return result(copy.changed(changed.autonomyLevel));
  }
  return result(copy.noPending);
}
