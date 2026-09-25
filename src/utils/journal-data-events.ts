export type JournalDataDomain = 'entries' | 'metadata' | 'media' | 'drafts';

type JournalDataListener = (domains: ReadonlySet<JournalDataDomain>) => void;

const listeners = new Set<JournalDataListener>();

export function publishJournalDataChange(...domains: JournalDataDomain[]) {
  if (!domains.length) return;
  const changed = new Set(domains);
  listeners.forEach((listener) => {
    try { listener(changed); }
    catch { /* A refresh listener must never turn a committed database write into a reported failure. */ }
  });
}

export function subscribeToJournalDataChanges(listener: JournalDataListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
