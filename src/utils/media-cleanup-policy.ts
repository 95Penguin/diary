export type StoredMediaFile = {
  uri: string;
  modificationTime: number | null;
};

export function shouldDeleteUnusedMedia(
  file: StoredMediaFile,
  referencedUris: ReadonlySet<string>,
  now: number,
  gracePeriodMs: number,
) {
  if (referencedUris.has(file.uri)) return false;
  const modifiedAt = file.modificationTime ?? now;
  return now - modifiedAt >= gracePeriodMs;
}
