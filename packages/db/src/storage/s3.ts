import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";

export const storageEnvironment = z.object({
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
  S3_REGION: z.string().min(1).default("auto"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  S3_PREFIX: z.string().default(""),
});

const objectKey = z.string().min(1);

export function createObjectStorage(environment: NodeJS.ProcessEnv = process.env) {
  const config = storageEnvironment.parse(environment);
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    // Use the common S3 subset supported by MinIO and R2.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const prefix = config.S3_PREFIX.replace(/^\/+|\/+$/g, "");
  const prefixedKey = (key: string): string => {
    const relativeKey = objectKey.parse(key.replace(/^\/+/, ""));
    return prefix ? `${prefix}/${relativeKey}` : relativeKey;
  };

  return {
    async put(
      key: string,
      body: Uint8Array,
      contentType = "application/octet-stream",
    ): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: prefixedKey(key),
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async get(key: string): Promise<Buffer> {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: prefixedKey(key) }),
      );
      if (!response.Body) throw new Error("Object storage returned an empty response body");
      return Buffer.from(await response.Body.transformToByteArray());
    },
    async delete(key: string): Promise<void> {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: prefixedKey(key) }),
      );
    },
    async headBucket(): Promise<void> {
      await client.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
    },
    close: () => client.destroy(),
  };
}
