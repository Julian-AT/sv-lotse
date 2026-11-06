import { randomUUID } from "node:crypto";
import { TokenVerifier } from "livekit-server-sdk";
import { expect, test } from "vitest";
import { relativesConfigurationSchema } from "../../src/relatives/config.ts";
import { mintRelativesToken, relativesTokenInput } from "../../src/relatives/index.ts";

// Test-only credentials sign real SDK tokens; no provider connection is simulated in product code.
const config = {
  LIVEKIT_URL: "wss://livekit.test",
  LIVEKIT_API_KEY: "unit-key",
  LIVEKIT_API_SECRET: "unit-secret-for-local-jwt-verification",
};

test("FR-R2 subject tokens permit only microphone and screen in the selected room", async () => {
  const caseId = randomUUID();
  const sessionId = randomUUID();
  const result = await mintRelativesToken(
    config,
    { userId: randomUUID(), sessionId, role: "subject" },
    caseId,
  );
  const claims = await new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET).verify(
    result.participantToken,
  );
  expect(claims.sub).toBe(`subject:${sessionId}`);
  expect(claims.video).toMatchObject({
    room: `lotse-relatives-${caseId}`,
    roomJoin: true,
    canPublishSources: ["microphone", "screen_share"],
    canPublishData: false,
    roomAdmin: false,
    roomRecord: false,
    recorder: false,
  });
  expect(Date.parse(result.expiresAt) - Date.now()).toBeLessThanOrEqual(900_000);
  expect(JSON.stringify(result)).not.toContain(config.LIVEKIT_API_SECRET);
});

test("FR-R3 helper tokens allow voice and pointer data but cannot publish a screen or change identity metadata", async () => {
  const sessionId = randomUUID();
  const result = await mintRelativesToken(
    config,
    { userId: randomUUID(), sessionId, role: "helper", displayName: "Daniel" },
    randomUUID(),
  );
  const claims = await new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET).verify(
    result.participantToken,
  );
  expect(claims.sub).toBe(`helper:${sessionId}`);
  expect(claims.name).toBe("Daniel");
  expect(claims.video).toMatchObject({
    canPublishSources: ["microphone"],
    canPublishData: true,
    canUpdateOwnMetadata: false,
    canSubscribe: true,
    roomAdmin: false,
    roomRecord: false,
  });
});

test("FR-R2 tokens require explicit consent and reject caller-selected roles and room ids", () => {
  for (const input of [
    { caseId: randomUUID() },
    { caseId: randomUUID(), consent: false },
    { caseId: randomUUID(), consent: true, role: "subject" },
    { caseId: randomUUID(), consent: true, room: "other-room" },
  ])
    expect(relativesTokenInput.safeParse(input).success).toBe(false);
  expect(relativesTokenInput.safeParse({ caseId: randomUUID(), consent: true }).success).toBe(true);
});

test("FR-R2 permits insecure LiveKit transport only on loopback", () => {
  for (const url of ["ws://livekit.test", "https://livekit.test", "wss://user:pass@livekit.test"])
    expect(relativesConfigurationSchema.safeParse({ ...config, LIVEKIT_URL: url }).success).toBe(
      false,
    );
  expect(
    relativesConfigurationSchema.safeParse({ ...config, LIVEKIT_URL: "ws://localhost:7880" })
      .success,
  ).toBe(true);
});
