import { randomUUID } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { expect, test } from "vitest";
import { loadLocalEnvironment } from "../../src/db/environment.ts";
import { createObjectStorage, storageEnvironment } from "../../src/storage/s3.ts";

loadLocalEnvironment();

test("NFR-15 puts, gets and deletes an object under S3_PREFIX in real MinIO", async () => {
  const prefix = `tests/${randomUUID()}/`;
  const environment = { ...process.env, S3_PREFIX: prefix };
  const config = storageEnvironment.parse(environment);
  const storage = createObjectStorage(environment);
  const raw = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const key = `${randomUUID()}.txt`;
  const body = Buffer.from("Speicherprüfung");
  try {
    await storage.headBucket();
    await storage.put(key, body, "text/plain; charset=utf-8");
    expect(await storage.get(key)).toEqual(body);
    const physicalObject = await raw.send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: `${prefix}${key}` }),
    );
    expect(await physicalObject.Body?.transformToString()).toBe(body.toString());
    await expect(
      raw.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key })),
    ).rejects.toMatchObject({ name: "NoSuchKey" });
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toMatchObject({ name: "NoSuchKey" });
    await expect(
      raw.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: `${prefix}${key}` })),
    ).rejects.toMatchObject({ name: "NoSuchKey" });
  } finally {
    await storage.delete(key).finally(() => {
      storage.close();
      raw.destroy();
    });
  }
});
