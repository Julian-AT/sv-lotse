import { TokenVerifier } from "livekit-server-sdk";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createRelativesToken } from "../../src/relatives/index.ts";
import { createSubjectService } from "../../src/subjects/index.ts";
import { identity, isolatedDatabase } from "../runtime/helpers.ts";

const config = {
  LIVEKIT_URL: "wss://livekit.test",
  LIVEKIT_API_KEY: "unit-key",
  LIVEKIT_API_SECRET: "unit-secret-for-local-jwt-verification",
};
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
beforeAll(async () => {
  database = await isolatedDatabase();
});
afterAll(async () => {
  await database?.cleanup();
});

test("FR-R2 real case ownership and accepted helper membership determine LiveKit grants", async () => {
  const owner = await identity(database.db);
  const helper = await identity(database.db);
  const outsider = await identity(database.db);
  const ownerService = createSubjectService(database, owner.userId);
  const subject = await ownerService.createSubject({
    displayName: "Test subject",
    relationToUser: "relative",
  });
  const created = await ownerService.createCase({
    subjectId: subject.id,
    confirmedGoal: "Administrative support",
  });
  const input = { caseId: created.case.id, consent: true as const };
  const verifier = new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET);
  // The owner's actor role is helper because the case concerns a dependent, but ownership permits sharing.
  expect(created.actor.role).toBe("helper");
  const ownerToken = await createRelativesToken(database, config, owner, input);
  expect((await verifier.verify(ownerToken.participantToken)).sub).toBe(
    `subject:${owner.sessionId}`,
  );
  await expect(createRelativesToken(database, config, helper, input)).rejects.toMatchObject({
    code: "RELATIVES_FORBIDDEN",
  });
  const invite = await ownerService.inviteHelper({
    caseId: created.case.id,
    shareScope: { mode: "restricted", factTypes: [] },
    expiresAt: new Date(Date.now() + 60_000),
  });
  await createSubjectService(database, helper.userId).acceptHelperInvite(invite.token);
  const helperToken = await createRelativesToken(database, config, helper, input);
  expect((await verifier.verify(helperToken.participantToken)).sub).toBe(
    `helper:${helper.sessionId}`,
  );
  await expect(createRelativesToken(database, config, outsider, input)).rejects.toMatchObject({
    code: "RELATIVES_FORBIDDEN",
  });
});
