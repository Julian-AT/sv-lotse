import { createDatabase } from "@lotse/brain/db";
import { createObjectStorage } from "@lotse/brain/storage/s3";
import { getEnvironment, resourceEnvironment } from "./env.ts";

const resources = globalThis as typeof globalThis & {
  lotseDatabase?: ReturnType<typeof createDatabase>;
  lotseStorage?: ReturnType<typeof createObjectStorage>;
};

export function getDatabase() {
  resources.lotseDatabase ??= createDatabase(resourceEnvironment(getEnvironment()));
  return resources.lotseDatabase;
}

export function getStorage() {
  resources.lotseStorage ??= createObjectStorage(resourceEnvironment(getEnvironment()));
  return resources.lotseStorage;
}
