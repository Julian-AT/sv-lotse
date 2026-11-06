import { TokenVerifier } from "livekit-server-sdk";
import { expect, test } from "vitest";
import { mintRelativeToken } from "@/server/relatives.ts";

// Synthetic signing material is test-only; product tokens use validated server configuration.
const config = {
  LIVEKIT_API_KEY: "test-key",
  LIVEKIT_API_SECRET: "test-signing-material-for-relative-tokens",
};
test("FR-R1 tokens bind room and identity and helpers can only publish microphone and data", async () => {
  const jwt = await mintRelativeToken(
    { room: "relative-test", identity: "helper-test", role: "helper" },
    config,
  );
  const claims = await new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET).verify(
    jwt,
  );
  expect(claims.sub).toBe("helper-test");
  expect(claims.video).toMatchObject({
    room: "relative-test",
    roomJoin: true,
    canPublishData: true,
    canSubscribe: true,
    canPublishSources: ["microphone"],
    canUpdateOwnMetadata: false,
  });
  if (claims.exp === undefined || claims.nbf === undefined) throw new Error("MISSING_EXPIRY");
  expect(claims.exp - claims.nbf).toBeLessThanOrEqual(15);
});
test("FR-R2 subject token allows shared-screen audio and excludes camera publishing", async () => {
  const jwt = await mintRelativeToken(
    { room: "relative-test", identity: "subject-test", role: "subject" },
    config,
  );
  const claims = await new TokenVerifier(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET).verify(
    jwt,
  );
  expect(claims.video?.canPublishSources).toEqual([
    "microphone",
    "screen_share",
    "screen_share_audio",
  ]);
});
