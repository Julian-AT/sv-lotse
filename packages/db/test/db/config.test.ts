import { describe, expect, test } from "vitest";
import { createDatabase, databaseEnvironment } from "@lotse/db";
import { storageEnvironment } from "@lotse/db/storage/s3";

describe("NFR-15 validates portable storage configuration", () => {
  test("requires a Postgres URL and bounds the pool size", () => {
    expect(databaseEnvironment.safeParse({}).success).toBe(false);
    expect(databaseEnvironment.safeParse({ DATABASE_URL: "not-a-url" }).success).toBe(false);
    expect(databaseEnvironment.safeParse({ DATABASE_URL: "https://example.org" }).success).toBe(
      false,
    );
    for (const size of ["0", "1.5", "101", "invalid"]) {
      expect(
        databaseEnvironment.safeParse({
          DATABASE_URL: "postgres://localhost/lotse",
          DATABASE_POOL_SIZE: size,
        }).success,
      ).toBe(false);
    }
    expect(
      databaseEnvironment.parse({ DATABASE_URL: "postgres://localhost/lotse" }).DATABASE_POOL_SIZE,
    ).toBe(10);
  });

  test("honours sslmode=require without overriding the URL", async () => {
    const database = createDatabase({
      DATABASE_URL: "postgres://localhost/lotse?sslmode=require",
      DATABASE_POOL_SIZE: "2",
    });
    try {
      expect(database.sql.options.ssl).toBe("require");
      expect(database.sql.options.max).toBe(2);
    } finally {
      await database.close();
    }
  });

  test("defaults optional S3 settings and parses false as false", () => {
    const environment = {
      S3_ENDPOINT: "http://localhost:9000",
      S3_BUCKET: "lotse",
      S3_ACCESS_KEY_ID: "test-access",
      S3_SECRET_ACCESS_KEY: "test-secret",
    };
    expect(storageEnvironment.parse(environment)).toMatchObject({
      S3_REGION: "auto",
      S3_PREFIX: "",
      S3_FORCE_PATH_STYLE: true,
    });
    expect(
      storageEnvironment.parse({ ...environment, S3_FORCE_PATH_STYLE: "false" })
        .S3_FORCE_PATH_STYLE,
    ).toBe(false);
    expect(
      storageEnvironment.safeParse({ ...environment, S3_FORCE_PATH_STYLE: "invalid" }).success,
    ).toBe(false);
    expect(
      storageEnvironment.safeParse({ ...environment, S3_ENDPOINT: "ftp://example.org" }).success,
    ).toBe(false);
    expect(storageEnvironment.safeParse({ ...environment, S3_ENDPOINT: "not-a-url" }).success).toBe(
      false,
    );
  });
});
