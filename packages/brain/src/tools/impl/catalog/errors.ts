export class CatalogError extends Error {
  constructor(readonly code: "CATALOG_DATABASE_REQUIRED" | "CATALOG_BENEFIT_NOT_FOUND") {
    super(code);
    this.name = "CatalogError";
  }
}
