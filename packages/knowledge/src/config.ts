export const INGESTION_CONFIG = {
  representationVersion: 3,
  chunkMinCharacters: 1600,
  chunkMaxCharacters: 3200,
  chunkOverlapCharacters: 800,
} as const;

export const VOICE_VOCABULARY_CONFIG = {
  maximumKeyterms: 50,
  maximumKeytermCharacters: 20,
} as const;
