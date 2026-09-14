let previousOperation: Promise<void> = Promise.resolve();

/** Keep automatic archive creation serial so two ZIP jobs cannot compete for memory. */
export async function withBackupOperation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = previousOperation;
  let release = () => {};
  previousOperation = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try { return await operation(); }
  finally { release(); }
}
